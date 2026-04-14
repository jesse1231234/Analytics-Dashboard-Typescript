// lib/gradesAdapter.ts
// Port of processors/grades_adapter.py

import Papa from "papaparse";

export interface GradebookTables {
  gradebookDf: Record<string, any>[];
  /** Rows with Metric column: 'Average' | 'Average Excluding Zeros' | '% Turned In' */
  gradebookSummary: Record<string, any>[];
  moduleMetrics: Record<string, any>[];
}

const IDENTITY_OR_META = new Set([
  "student", "id", "sis user id", "sis login id", "integration id", "section",
  "final grade", "current grade", "unposted final grade",
  "final score", "current score", "unposted final score",
  "final points", "current points", "unposted current score",
]);

function isAssignmentCol(col: string): boolean {
  const c = col.trim().toLowerCase();
  if (c.startsWith("unnamed")) return false;
  return !IDENTITY_OR_META.has(c);
}

function cleanAssignmentHeader(name: string): string {
  let s = String(name ?? "").trim();
  if (!s) return s;
  // Remove trailing "(digits)"
  if (s.endsWith(")") && s.includes("(")) {
    const i = s.lastIndexOf("(");
    const inner = s.slice(i + 1, -1);
    if (/^\d+$/.test(inner) && inner.length >= 4) s = s.slice(0, i).trimEnd();
  }
  // Remove trailing "- digits"
  const dashIdx = s.lastIndexOf("-");
  if (dashIdx >= 0) {
    const right = s.slice(dashIdx + 1).trim();
    if (/^\d+$/.test(right) && right.length >= 4) s = s.slice(0, dashIdx).trimEnd();
  }
  return s;
}

// ---- Levenshtein ratio (mirrors rapidfuzz.fuzz.ratio) ----
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function fuzzyRatio(a: string, b: string): number {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  const al = a.toLowerCase(), bl = b.toLowerCase();
  if (al === bl) return 100;
  const dist = levenshtein(al, bl);
  return Math.round((1 - dist / (al.length + bl.length)) * 100);
}

function bestMatch(
  query: string,
  choices: string[],
  threshold: number
): string | null {
  let bestScore = 0, best: string | null = null;
  for (const c of choices) {
    const sc = fuzzyRatio(query, c);
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  return bestScore >= threshold ? best : null;
}

// ---- De-identification ----
function deidentify(rows: Record<string, any>[]): Record<string, any>[] {
  if (!rows.length) return rows;
  const DROP = new Set(["sis user id", "sis login id", "integration id", "id"]);
  const studentKey = Object.keys(rows[0]).find(
    (k) => k.toLowerCase() === "student"
  );
  return rows.map((r, i) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) {
      if (DROP.has(k.toLowerCase())) continue;
      out[k] = studentKey && k === studentKey ? `S${String(i + 1).padStart(4, "0")}` : v;
    }
    return out;
  });
}

// ---- Main builder ----
export function buildGradebookTables(
  csvText: string,
  canvasOrderRows: Record<string, any>[]
): GradebookTables {
  // PapaParse with header:true; first data row is "Points Possible"
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: false,
  });

  // Clean all headers
  const remap = (row: Record<string, string>): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(row))
      out[cleanAssignmentHeader(k)] = v;
    return out;
  };
  const cleanedData = parsed.data.map(remap);

  if (!cleanedData.length) {
    return { gradebookDf: [], gradebookSummary: [], moduleMetrics: [] };
  }

  const pointsRow = cleanedData[0];
  let studentsRaw = cleanedData.slice(1);

  // Drop meta rows (Points Possible header row sometimes duplicated, Test Student, etc.)
  const studentKey = Object.keys(studentsRaw[0] ?? {}).find(
    (k) => k.toLowerCase() === "student"
  );
  if (studentKey) {
    studentsRaw = studentsRaw.filter((r) => {
      const v = String(r[studentKey] ?? "").toLowerCase();
      return !v.includes("points possible") && !v.includes("student, test");
    });
  }

  const allCols = Object.keys(cleanedData[0]);
  const assignmentCols = allCols.filter(isAssignmentCol);

  if (!assignmentCols.length) {
    return {
      gradebookDf: deidentify(studentsRaw),
      gradebookSummary: [
        { Metric: "Average" },
        { Metric: "Average Excluding Zeros" },
        { Metric: "% Turned In" },
      ],
      moduleMetrics: [],
    };
  }

  // Points possible per assignment column
  const points: Record<string, number> = {};
  for (const col of assignmentCols) points[col] = Number(pointsRow[col]) || 0;

  // Per-student per-assignment fraction (0..1)
  const perStudentPerc: Record<string, number | null>[] = studentsRaw.map((r) => {
    const row: Record<string, number | null> = {};
    for (const col of assignmentCols) {
      const earned = Number(r[col]);
      const pts = points[col];
      row[col] = isNaN(earned) ? null : pts > 0 ? earned / pts : null;
    }
    return row;
  });

  // Summary rows
  const avg: Record<string, any>   = { Metric: "Average" };
  const excl0: Record<string, any> = { Metric: "Average Excluding Zeros" };
  const pctIn: Record<string, any> = { Metric: "% Turned In" };

  for (const col of assignmentCols) {
    const vals = perStudentPerc
      .map((r) => r[col])
      .filter((v): v is number => v !== null);
    const nonZero = vals.filter((v) => v > 0);
    avg[col]   = vals.length   ? vals.reduce((a, b) => a + b, 0) / vals.length       : null;
    excl0[col] = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : null;
    pctIn[col] = vals.length   ? nonZero.length / vals.length                         : null;
  }

  const gradebookSummary = [avg, excl0, pctIn];

  // Gradebook df — keep key grade columns only, de-identify
  const GRADE_COLS = [
    "Final Grade", "Current Grade", "Unposted Final Grade",
    "Final Score", "Current Score", "Unposted Final Score",
  ];
  const keepCols = GRADE_COLS.filter((c) => allCols.includes(c));
  const rawDf = keepCols.length
    ? studentsRaw.map((r) => Object.fromEntries(keepCols.map((c) => [c, r[c]])))
    : studentsRaw;
  const gradebookDf = deidentify(rawDf);

  // Module-level metrics via fuzzy title matching (threshold 90, like Python)
  const moduleMetrics: Record<string, any>[] = [];
  const hasModuleCols =
    canvasOrderRows.length > 0 &&
    canvasOrderRows[0].module !== undefined &&
    canvasOrderRows[0].item_type !== undefined &&
    canvasOrderRows[0].item_title_raw !== undefined;

  if (hasModuleCols) {
    const assignRows = canvasOrderRows.filter((r) =>
      String(r.item_type ?? "").toLowerCase().includes("assignment")
    );

    const byModule = new Map<string, string[]>();
    for (const r of assignRows) {
      const mod = String(r.module ?? "");
      const cleanTitle = cleanAssignmentHeader(String(r.item_title_raw ?? ""));
      const match = bestMatch(cleanTitle, assignmentCols, 90);
      if (!match) continue;
      if (!byModule.has(mod)) byModule.set(mod, []);
      byModule.get(mod)!.push(match);
    }

    for (const [mod, cols] of byModule) {
      const uniqueCols = [...new Set(cols)];
      if (!uniqueCols.length) continue;

      const meanOf = (summaryRow: Record<string, any>): number | null => {
        const vals = uniqueCols
          .map((c) => summaryRow[c])
          .filter((v): v is number => v !== null && !isNaN(Number(v)))
          .map(Number);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };

      moduleMetrics.push({
        Module: mod,
        "Avg % Turned In": meanOf(pctIn),
        "Module Average Excluding Zeros": meanOf(excl0),
        "# of Assignments": uniqueCols.length,
      });
    }
  }

  return { gradebookDf, gradebookSummary, moduleMetrics };
}

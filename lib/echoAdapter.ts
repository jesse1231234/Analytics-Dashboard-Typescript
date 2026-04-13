// lib/echoAdapter.ts
// Port of processors/echo_adapter.py
// Parses the Echo360 analytics CSV and joins it to Canvas module order.

import Papa from "papaparse";

export interface EchoTables {
  echoSummary: Record<string, any>[];
  moduleTable: Record<string, any>[];
  studentTable: Record<string, any>[];
}

// ---- Column candidates ----
const CANDIDATES: Record<string, string[]> = {
  media:    ["media name", "media title", "video title", "title", "name"],
  duration: ["duration", "video duration", "media duration", "length"],
  viewtime: ["total view time", "total viewtime", "total watch time", "view time"],
  avgview:  ["average view time", "avg view time", "avg watch time", "average watch time"],
  user:     ["user email", "user name", "email", "user", "viewer", "username"],
};

function findCol(headers: string[], want: string[], required = true): string | null {
  const low = new Map(headers.map((h) => [h.toLowerCase(), h]));
  for (const w of want) {
    if (low.has(w)) return low.get(w)!;
  }
  for (const [k, v] of low) {
    if (want.some((w) => k.includes(w))) return v;
  }
  if (required) {
    throw new Error(
      `Missing required column; need one of: ${want.join(", ")}\nAvailable: ${headers.join(", ")}`
    );
  }
  return null;
}

// ---- Time parsing ----
function toSeconds(x: any): number {
  if (x === null || x === undefined || x === "") return NaN;
  if (typeof x === "number") return Number.isFinite(x) ? x : NaN;
  const s = String(x).trim();
  if (!s) return NaN;
  const asNum = Number(s);
  if (!isNaN(asNum)) return asNum;
  const parts = s.split(":").map(Number);
  if (parts.some(isNaN)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}

// ---- Title cleaning ----
const DURATION_TAIL_RE = /\s*\((?:\d{1,2}:)?\d{1,2}:\d{2}\)\s*$/i;
const READONLY_RE = /\s*\(read only\)\s*$/i;
const NUM_ID_TAIL_RE = /\s*-\s*\d{4,}\s*$/;

function stripNoiseTail(title: string): string {
  let s = String(title ?? "").trim();
  s = s.replace(READONLY_RE, "");
  s = s.replace(DURATION_TAIL_RE, "");
  s = s.replace(NUM_ID_TAIL_RE, "");
  return s.trim();
}

function normText(text: string): string {
  const s = stripNoiseTail(text);
  return s
    .replace(/[^a-z0-9 ]/gi, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Fuzzy matching (port of rapidfuzz token_set_ratio) ----
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Use flat array for speed
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

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 100;
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return Math.round((1 - dist / (a.length + b.length)) * 100);
}

function tokenSetRatio(a: string, b: string): number {
  const tokA = a.split(/\s+/).filter(Boolean).sort();
  const tokB = b.split(/\s+/).filter(Boolean).sort();
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  const inter = tokA.filter((t) => setB.has(t));
  const onlyA = tokA.filter((t) => !setB.has(t));
  const onlyB = tokB.filter((t) => !setA.has(t));
  const t1 = inter.join(" ");
  const t2 = [...inter, ...onlyA].sort().join(" ");
  const t3 = [...inter, ...onlyB].sort().join(" ");
  return Math.max(
    levenshteinRatio(t1, t2),
    levenshteinRatio(t1, t3),
    levenshteinRatio(t2, t3)
  );
}

const THRESHOLD = 80;
const FALLBACK_MIN = 70;

/** Greedy one-to-one matching, returns [echoIdx, canvasIdx, score] triples. */
function greedyMatch(
  ekeys: string[],
  ckeys: string[]
): Array<[number, number, number]> {
  const candidates: Array<[number, number, number]> = [];

  for (let i = 0; i < ekeys.length; i++) {
    for (let j = 0; j < ckeys.length; j++) {
      const sc = tokenSetRatio(ekeys[i], ckeys[j]);
      if (sc >= THRESHOLD) candidates.push([i, j, sc]);
    }
  }

  if (candidates.length === 0) {
    for (let i = 0; i < ekeys.length; i++) {
      let bestSc = 0, bestJ = -1;
      for (let j = 0; j < ckeys.length; j++) {
        const sc = tokenSetRatio(ekeys[i], ckeys[j]);
        if (sc > bestSc) { bestSc = sc; bestJ = j; }
      }
      if (bestSc >= FALLBACK_MIN && bestJ >= 0) candidates.push([i, bestJ, bestSc]);
    }
  }

  candidates.sort((a, b) => b[2] - a[2]);
  const usedE = new Set<number>();
  const usedC = new Set<number>();
  const chosen: Array<[number, number, number]> = [];
  for (const [i, j, sc] of candidates) {
    if (usedE.has(i) || usedC.has(j)) continue;
    chosen.push([i, j, sc]);
    usedE.add(i);
    usedC.add(j);
  }
  return chosen;
}

// ---- Main builder ----
export function buildEchoTables(
  csvText: string,
  canvasOrderRows: Record<string, any>[],
  classTotalStudents?: number | null
): EchoTables {
  const parsed = Papa.parse<Record<string, any>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const df = parsed.data;
  if (!df.length) return { echoSummary: [], moduleTable: [], studentTable: [] };

  const headers = Object.keys(df[0]);
  const mediaCol = findCol(headers, CANDIDATES.media)!;
  const durCol   = findCol(headers, CANDIDATES.duration)!;
  const viewCol  = findCol(headers, CANDIDATES.viewtime)!;
  const uidCol   = findCol(headers, CANDIDATES.user, false);

  // Parse time columns and compute per-row true view fraction
  const rows = df.map((r) => {
    const dur  = toSeconds(r[durCol]);
    const view = toSeconds(r[viewCol]);
    const trueFrac = dur > 0 && !isNaN(view) ? view / dur : NaN;
    return { ...r, __dur: dur, __view: view, __trueFrac: trueFrac };
  });

  // ---- Per-media summary ----
  const byMedia = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = String(r[mediaCol] ?? "");
    if (!byMedia.has(key)) byMedia.set(key, []);
    byMedia.get(key)!.push(r);
  }

  const echoSummary: Record<string, any>[] = [];
  for (const [title, group] of byMedia) {
    const dur = group[0].__dur;

    const uniqViewers = uidCol
      ? new Set(group.map((r) => r[uidCol]).filter((v) => v != null && v !== "")).size
      : group.filter((r) => !isNaN(r.__view)).length;

    const fracs = group.map((r) => r.__trueFrac).filter((v) => !isNaN(v));
    const avgFrac =
      fracs.length > 0 ? fracs.reduce((a, b) => a + b, 0) / fracs.length : NaN;

    const sumViewSec = group.reduce(
      (acc, r) => acc + (isNaN(r.__view) ? 0 : r.__view),
      0
    );

    const row: Record<string, any> = {
      "Media Title": title,
      "Video Duration": isNaN(dur) ? null : dur,
      "# of Unique Viewers": uniqViewers,
      "Average View %": isNaN(avgFrac) ? null : avgFrac,
    };

    if (classTotalStudents && classTotalStudents > 0) {
      row["% of Students Viewing"] = uniqViewers / classTotalStudents;
      const denom = dur * classTotalStudents;
      row["% of Video Viewed Overall"] = denom > 0 ? sumViewSec / denom : null;
    } else {
      row["% of Students Viewing"] = null;
      row["% of Video Viewed Overall"] = null;
    }

    echoSummary.push(row);
  }

  // ---- Canvas join ----
  let moduleTable: Record<string, any>[] = [];

  const canvasTitleCol = ["video_title_raw", "item_title_raw", "item_title_normalized"].find(
    (c) => canvasOrderRows[0]?.[c] !== undefined
  );

  if (canvasOrderRows.length > 0 && canvasTitleCol) {
    const orderRows = canvasOrderRows
      .filter((r) => r.module != null && r[canvasTitleCol] != null)
      .map((r) => ({ ...r, _ckey: normText(String(r[canvasTitleCol])) }));

    const esWithKey = echoSummary.map((r) => ({
      ...r,
      _ekey: normText(String(r["Media Title"])),
    }));

    // 1) Exact match
    const exactLookup = new Map(esWithKey.map((r) => [r._ekey, r]));
    const joined: Record<string, any>[] = orderRows.map((or) => {
      const exact = exactLookup.get(or._ckey);
      return exact ? { ...or, ...exact } : { ...or };
    });

    // 2) Fuzzy match for rows still missing Average View %
    const unmatchedIdx = joined
      .map((r, i) => (r["Average View %"] == null ? i : -1))
      .filter((i) => i >= 0);

    if (unmatchedIdx.length > 0) {
      const ckeys = unmatchedIdx.map((i) => joined[i]._ckey);
      const ekeys = esWithKey.map((r) => r._ekey);
      const pairs = greedyMatch(ekeys, ckeys);
      for (const [ei, ci] of pairs) {
        const targetIdx = unmatchedIdx[ci];
        const esRow = esWithKey[ei];
        joined[targetIdx] = { ...joined[targetIdx], ...esRow };
      }
    }

    // Aggregate by module
    const withData = joined.filter((r) => r["Average View %"] != null);
    const byModule = new Map<
      string,
      { module: string; pos: number; items: typeof withData }
    >();
    for (const r of withData) {
      const mod = String(r.module ?? "");
      const pos = Number(r.module_position ?? 0);
      if (!byModule.has(mod)) byModule.set(mod, { module: mod, pos, items: [] });
      byModule.get(mod)!.items.push(r);
    }

    const mean = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    moduleTable = [...byModule.values()]
      .sort((a, b) => a.pos - b.pos)
      .map(({ module, items }) => {
        const avgViews = items
          .map((r) => Number(r["Average View %"]))
          .filter((n) => !isNaN(n));
        const avgUniq = items
          .map((r) => Number(r["# of Unique Viewers"]))
          .filter((n) => !isNaN(n));
        const avgOverall = items
          .map((r) => Number(r["% of Video Viewed Overall"]))
          .filter((n) => !isNaN(n));
        const viewers = mean(avgUniq);
        return {
          Module: module,
          "Average View %": mean(avgViews),
          "# of Students Viewing": viewers != null ? Math.round(viewers) : null,
          "Overall View %": mean(avgOverall),
          "# of Students": classTotalStudents ?? null,
        };
      });
  }

  // ---- Student table (de-identified) ----
  let studentTable: Record<string, any>[] = [];
  if (uidCol) {
    const byUser = new Map<string, number[]>();
    for (const r of rows) {
      const uid = String(r[uidCol] ?? "unknown");
      if (!byUser.has(uid)) byUser.set(uid, []);
      if (!isNaN(r.__trueFrac)) byUser.get(uid)!.push(r.__trueFrac);
    }
    let idx = 1;
    for (const [, fracs] of byUser) {
      const avg = fracs.length
        ? fracs.reduce((a, b) => a + b, 0) / fracs.length
        : null;
      studentTable.push({
        Student: `S${String(idx++).padStart(4, "0")}`,
        "Average View % When Watched": avg,
        "Final Grade": null,
      });
    }
  }

  return { echoSummary, moduleTable, studentTable };
}

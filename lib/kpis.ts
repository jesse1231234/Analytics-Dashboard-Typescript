// lib/kpis.ts
// Port of ui/kpis.py

export interface KPIs {
  "# Students": number | null;
  "Median Letter Grade": string | null;
  "Average Echo360 engagement": number | null;
  "# of Fs": number | null;
  "Avg Assignment Grade (class)": number | null;
}

const LETTER_ORDER = [
  "A+", "A", "A-",
  "B+", "B", "B-",
  "C+", "C", "C-",
  "D+", "D", "D-",
  "F",
];
const LETTER_RANK = new Map(LETTER_ORDER.map((g, i) => [g, i]));
const RANK_TO_LETTER = new Map(LETTER_ORDER.map((g, i) => [i, g]));

function medianLetterGrade(grades: string[]): string {
  const ranks = grades
    .map((g) => LETTER_RANK.get(g.trim().toUpperCase()))
    .filter((r): r is number => r !== undefined);
  if (!ranks.length) return "—";
  ranks.sort((a, b) => a - b);
  const mid = Math.floor(ranks.length / 2);
  const medRank =
    ranks.length % 2 === 0
      ? Math.round((ranks[mid - 1] + ranks[mid]) / 2)
      : ranks[mid];
  return RANK_TO_LETTER.get(medRank) ?? "—";
}

export function computeKpis(
  echoSummary: Record<string, any>[],
  gradebookDf: Record<string, any>[],
  gradebookSummary: Record<string, any>[],
  studentsFromCanvas: number | null
): KPIs {
  // # Students — prefer Canvas enrollment count, fall back to gradebook row count
  const nStudents = studentsFromCanvas ?? gradebookDf.length;

  // Median Letter Grade
  const gradeKey = ["Final Grade", "Current Grade", "Unposted Final Grade"].find(
    (k) => gradebookDf[0]?.[k] !== undefined
  );
  const medLetter = gradeKey
    ? medianLetterGrade(
        gradebookDf.map((r) => String(r[gradeKey] ?? "")).filter(Boolean)
      )
    : "—";

  // Average Echo360 engagement — mean of per-media "Average View %" (0..1), converted to 0..100
  let avgEchoPct: number | null = null;
  if (echoSummary.length > 0) {
    const vals = echoSummary
      .map((r) => Number(r["Average View %"]))
      .filter((v) => !isNaN(v));
    if (vals.length)
      avgEchoPct = (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
  }

  // # of Fs
  let numFs = 0;
  if (gradeKey) {
    numFs = gradebookDf.filter(
      (r) => String(r[gradeKey] ?? "").toUpperCase() === "F"
    ).length;
  }

  // Avg Assignment Grade (fraction 0..1) — from "Average Excluding Zeros" summary row
  let avgAssignFrac: number | null = null;
  const excl0Row = gradebookSummary.find(
    (r) => r.Metric === "Average Excluding Zeros"
  );
  if (excl0Row) {
    const vals = Object.entries(excl0Row)
      .filter(([k]) => k !== "Metric")
      .map(([, v]) => Number(v))
      .filter((v) => !isNaN(v));
    if (vals.length)
      avgAssignFrac = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  return {
    "# Students": nStudents,
    "Median Letter Grade": medLetter,
    "Average Echo360 engagement": avgEchoPct,
    "# of Fs": numFs,
    "Avg Assignment Grade (class)": avgAssignFrac,
  };
}

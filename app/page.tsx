"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import EchoComboChart from "./components/charts/EchoComboChart";
import GradebookComboChart from "./components/charts/GradebookComboChart";

type AnyRow = Record<string, any>;

// ---- Response shape from /api/analyze ----
type AIMetric = { label: string; value: string; tone: "good" | "warn" | "bad" | "neutral" };
type AICard   = { id: string; title: string; summary: string; bullets: string[]; metrics: AIMetric[] };
type AIAnalysisData = { version: string; cards: AICard[] };

type AnalyzeResponse = {
  kpis?: Record<string, any>;
  echo?: { summary?: AnyRow[]; modules?: AnyRow[] };
  grades?: { summary?: AnyRow[]; module_metrics?: AnyRow[] };
  analysis?: { text?: string | null; error?: string | null };
};

// ---- Column presets ----
const ECHO_SUMMARY_COLS = [
  "Media Title", "Video Duration", "# of Unique Views", "Total Views",
  "Total Watch Time (Min)", "Average View %", "% of Students Viewing", "% of Video Viewed Overall",
];
const ECHO_MODULE_COLS       = ["Module", "Average View %", "# of Students Viewing", "Overall View %", "# of Students"];
const GRADEBOOK_MODULE_COLS  = ["Module", "Avg % Turned In", "Avg Average Excluding Zeros", "n_assignments"];
const ECHO_SUMMARY_PERCENT_COLS   = ["Average View %", "% of Students Viewing", "% of Video Viewed Overall"];
const ECHO_MODULE_PERCENT_COLS    = ["Average View %", "Overall View %"];
const GRADEBOOK_MODULE_PERCENT_COLS = ["Avg % Turned In", "Avg Average Excluding Zeros"];

// ---- Column help text ----
const COLUMN_HELP_TEXT: Record<string, string> = {
  "Media Title":                  "Name of the Echo360 media item as published to students.",
  "Video Duration":               "Total runtime of the media in hours:minutes:seconds.",
  "# of Unique Views":            "Distinct students who watched this media at least once.",
  "# of Unique Viewers":          "Distinct students who watched this media at least once.",
  "Total Views":                  "Total number of views across all students.",
  "Total Watch Time (Min)":       "Total minutes watched across all viewers.",
  "Average View %":               "Average portion of the video watched per student viewer.",
  "% of Students Viewing":        "Percent of enrolled students who viewed this media.",
  "% of Video Viewed Overall":    "Share of total video minutes watched across all viewers.",
  "Module":                       "Canvas module that contains these Echo360 media items or assignments.",
  "# of Students Viewing":        "Students who watched any Echo360 media within this module.",
  "Overall View %":               "Combined percentage of media watched by the viewing students.",
  "# of Students":                "Total students in the course for comparison to viewers.",
  "Avg % Turned In":              "Average submission rate for assignments within the module.",
  "Avg Average Excluding Zeros":  "Mean assignment score ignoring missing (zero) submissions.",
  "n_assignments":                "Number of assignments mapped to the module.",
};

// ---- Tooltip ----
function Tooltip({
  text,
  children,
  position = "top",
}: {
  text: string;
  children: React.ReactNode;
  position?: "top" | "bottom";
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && position === "top" && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-slate-900 rounded-lg whitespace-nowrap shadow-lg pointer-events-none">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-900" />
        </span>
      )}
      {show && position === "bottom" && (
        <span className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 text-xs text-white bg-slate-900 rounded-lg whitespace-nowrap shadow-lg pointer-events-none">
          {text}
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 -mb-1 border-4 border-transparent border-b-slate-900" />
        </span>
      )}
    </span>
  );
}

// ---- Formatting helpers ----
function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/%/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatNumberCell(n: number) {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercentCell(v: any) {
  const n = toNumber(v);
  if (n === null) return "";
  return `${(n * 100).toFixed(1)}%`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatCell(key: string, value: any, percentCols?: string[]) {
  if (value === null || value === undefined) return "";
  if (percentCols?.includes(key)) return formatPercentCell(value);
  if (key === "Video Duration") {
    const n = toNumber(value);
    if (n !== null) return formatDuration(n);
  }
  const n = toNumber(value);
  if (key.includes("%") && n !== null && n >= 0 && n <= 1.5) return formatPercentCell(n);
  if (typeof value === "number") return formatNumberCell(value);
  if (n !== null && String(value).match(/^[\d,.\-]+%?$/)) return formatNumberCell(n);
  return String(value);
}

function isTextHeavyCol(col: string) {
  return /title|name|media|assignment|page|url|link|description/i.test(col);
}
function isNumericishCol(col: string) {
  return /%|count|views|time|duration|avg|total|n_/i.test(col);
}

function buildColWidths(
  rows: AnyRow[],
  cols: string[],
  percentCols?: string[],
  opts?: { sample?: number; font?: string; paddingPx?: number; minPx?: number; maxTextPx?: number; maxDefaultPx?: number }
) {
  const sample     = opts?.sample      ?? 80;
  const font       = opts?.font        ?? "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  const paddingPx  = opts?.paddingPx   ?? 22;
  const minPx      = opts?.minPx       ?? 70;
  const maxTextPx  = opts?.maxTextPx   ?? 520;
  const maxDefault = opts?.maxDefaultPx ?? 320;

  if (typeof document === "undefined") return {};
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return {};
  ctx.font = font;

  const widths: Record<string, number> = {};
  const take = rows.slice(0, sample);
  for (const c of cols) {
    let max = ctx.measureText(String(c)).width;
    for (const r of take) {
      const w = ctx.measureText(String(formatCell(c, r?.[c], percentCols) ?? "")).width;
      if (w > max) max = w;
    }
    const padded  = Math.ceil(max + paddingPx);
    const cap     = isTextHeavyCol(c) ? maxTextPx : maxDefault;
    const clamped = Math.max(minPx, Math.min(padded, cap));
    widths[c] = isNumericishCol(c) && !isTextHeavyCol(c) ? Math.min(clamped, 180) : clamped;
  }
  return widths;
}

// ---- Table component (with column sorting) ----
function Table({
  title,
  rows,
  columns,
  percentCols,
  maxRows = 50,
}: {
  title: string;
  rows: AnyRow[];
  columns?: string[];
  percentCols?: string[];
  maxRows?: number;
}) {
  const cols = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const keys = Object.keys(rows[0] ?? {});
    if (!columns || columns.length === 0) return keys;
    const set = new Set(keys);
    const picked = columns.filter((c) => set.has(c));
    if (picked.length <= 1 && keys.length > 1) return keys;
    return picked;
  }, [rows, columns]);

  // Sort state — null = default (Canvas order)
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleHeaderClick(col: string) {
    if (col === cols[0]) {
      // First column resets to default Canvas order
      setSortCol(null);
      setSortDir("desc");
    } else if (sortCol === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  const slice = useMemo(() => {
    let data = rows;
    if (sortCol) {
      data = [...rows].sort((a, b) => {
        const rawA = a[sortCol], rawB = b[sortCol];
        const numA = rawA === null || rawA === undefined ? NaN : Number(rawA);
        const numB = rawB === null || rawB === undefined ? NaN : Number(rawB);
        const bothNum = !isNaN(numA) && !isNaN(numB);
        const cmp = bothNum
          ? numA - numB
          : String(rawA ?? "").localeCompare(String(rawB ?? ""));
        return sortDir === "desc" ? -cmp : cmp;
      });
    }
    return data.slice(0, maxRows);
  }, [rows, sortCol, sortDir, maxRows]);

  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!slice.length || !cols.length) { setColWidths({}); return; }
    setColWidths(
      buildColWidths(rows, cols, percentCols, {
        sample: Math.min(120, rows.length),
        font: "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
        paddingPx: 20, minPx: 70, maxTextPx: 520, maxDefaultPx: 320,
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols.join("|"), (percentCols ?? []).join("|"), maxRows]);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 min-w-0">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">
          Showing {slice.length.toLocaleString()}
          {rows.length > slice.length ? ` of ${rows.length.toLocaleString()}` : ""} rows
        </div>
      </div>
      {slice.length === 0 ? (
        <div className="text-sm text-slate-600">No data.</div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="w-full max-h-[520px] overflow-x-auto overflow-y-auto" aria-label={`${title} table`}>
            <table className="w-max text-[13px] leading-5 table-fixed">
              <colgroup>
                {cols.map((c) => (
                  <col key={c} style={colWidths[c] ? { width: `${colWidths[c]}px` } : undefined} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 border-b-2 border-slate-300">
                <tr>
                  {cols.map((c, colIdx) => {
                    const textHeavy  = isTextHeavyCol(c);
                    const helpText   = COLUMN_HELP_TEXT[c];
                    const isOddCol   = colIdx % 2 === 1;
                    const isFirstCol = colIdx === 0;
                    const isActive   = sortCol === c;
                    const isDefault  = isFirstCol && sortCol === null;
                    return (
                      <th
                        key={c}
                        scope="col"
                        onClick={() => handleHeaderClick(c)}
                        title={
                          isFirstCol
                            ? "Click to reset to default (Canvas) order"
                            : isActive
                            ? `Sorted ${sortDir === "desc" ? "high → low" : "low → high"} — click to reverse`
                            : "Click to sort"
                        }
                        className={`text-left px-3 py-2.5 text-xs font-semibold text-slate-800 align-top border-r border-slate-300 last:border-r-0 select-none cursor-pointer ${
                          textHeavy ? "break-words" : "whitespace-nowrap"
                        } ${isOddCol ? "bg-slate-200 hover:bg-slate-300" : "bg-slate-100 hover:bg-slate-200"} ${
                          isActive ? "underline decoration-dotted underline-offset-2" : ""
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {c}
                          {isActive ? (sortDir === "desc" ? " ↓" : " ↑") : isDefault ? " ↕" : null}
                          {helpText && (
                            <Tooltip text={helpText} position="bottom">
                              <span
                                className="ml-1 text-slate-400 hover:text-slate-600 cursor-help"
                                onClick={(e) => e.stopPropagation()}
                              >
                                ⓘ
                              </span>
                            </Tooltip>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {slice.map((r, rowIdx) => (
                  <tr key={rowIdx} className="border-t border-slate-300">
                    {cols.map((c, colIdx) => {
                      const textHeavy = isTextHeavyCol(c);
                      const isOddCol  = colIdx % 2 === 1;
                      return (
                        <td
                          key={c}
                          className={`px-3 py-2 text-[13px] leading-5 text-slate-800 align-top border-r border-slate-200 last:border-r-0 ${
                            textHeavy ? "break-words" : "whitespace-nowrap"
                          } ${isOddCol ? "bg-slate-200" : "bg-white"}`}
                        >
                          {formatCell(c, r[c], percentCols)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Main page ----
export default function Home() {
  const [step, setStep]           = useState<1 | 2 | 3>(1);
  const [activeTab, setActiveTab] = useState<"tables" | "charts" | "ai">("tables");

  const [courseId, setCourseId] = useState("");
  const [courseTitle, setCourseTitle]         = useState<string | null>(null);
  const [courseTitleState, setCourseTitleState] = useState<"idle" | "loading" | "found" | "error">("idle");
  const [courseTitleError, setCourseTitleError] = useState<string | null>(null);
  const [canvasCsv, setCanvasCsv] = useState<File | null>(null);
  const [echoCsv, setEchoCsv]     = useState<File | null>(null);

  const [loading, setLoading]             = useState(false);
  const [progress, setProgress]           = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const progressStopped = useRef(false);

  const [error, setError]   = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  // Debounced course title lookup — fires 600ms after user stops typing
  useEffect(() => {
    const trimmed = courseId.trim();
    if (!trimmed || isNaN(Number(trimmed))) {
      setCourseTitle(null);
      setCourseTitleState("idle");
      setCourseTitleError(null);
      return;
    }
    setCourseTitleState("loading");
    setCourseTitle(null);
    setCourseTitleError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/course-name?course_id=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (!res.ok || data.error) {
          setCourseTitleState("error");
          setCourseTitleError(data.error ?? "Could not look up course");
        } else {
          setCourseTitle(data.name);
          setCourseTitleState("found");
        }
      } catch {
        setCourseTitleState("error");
        setCourseTitleError("Network error looking up course");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [courseId]);

  const [exportingPDF, setExportingPDF] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const echoSummary      = result?.echo?.summary         ?? [];
  const echoModules      = result?.echo?.modules         ?? [];
  const gradeSummary     = result?.grades?.summary       ?? [];
  const gradeModuleMetrics = result?.grades?.module_metrics ?? [];

  const gradeSummaryPercentCols = useMemo(() => {
    if (!gradeSummary?.[0]) return [];
    return Object.keys(gradeSummary[0]).filter((k) => k !== "Metric");
  }, [gradeSummary]);

  // gradeModuleMetrics arrives from the backend already in Canvas module order
  // (built by iterating canvasOrderRows sorted by module_position), so no re-sort needed.
  const sortedGradeModuleMetrics = gradeModuleMetrics;

  const kpis = useMemo(() => {
    const d = {
      studentsEnrolled:       null as number | null,
      averageViewPercent:     null as number | null,
      averageAssignmentGrade: null as number | null,
      medianLetterGrade:      null as string | null,
    };
    if (echoModules.length) {
      const first = echoModules[0];
      d.studentsEnrolled =
        toNumber(first["# of Students"]) ?? toNumber(first["# Students"]) ?? null;
    }
    if (echoSummary.length) {
      const vals = echoSummary
        .map((r) => toNumber(r["Average View %"] ?? r["Avg View %"]))
        .filter((v): v is number => v !== null);
      if (vals.length) d.averageViewPercent = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    if (gradeSummary.length) {
      const row = gradeSummary.find(
        (r) => r.Metric === "Average Excluding Zeros" || r.Metric === "Avg Average Excluding Zeros"
      );
      if (row) {
        const vals = Object.entries(row)
          .filter(([k]) => k !== "Metric")
          .map(([, v]) => toNumber(v))
          .filter((v): v is number => v !== null);
        if (vals.length) d.averageAssignmentGrade = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
    }
    if (result?.kpis?.["Median Letter Grade"]) d.medianLetterGrade = result.kpis["Median Letter Grade"];
    return d;
  }, [echoSummary, echoModules, gradeSummary, result?.kpis]);

  // ---- Run analysis ----
  async function runAnalysis() {
    setError(null);
    if (!courseId.trim()) { setError("Please enter a Canvas Course ID (number)."); return; }
    if (!canvasCsv || !echoCsv) { setError("Please upload both CSV files."); return; }

    // Staged progress bar — milestones mirror what the server is doing
    const STAGES = [
      { pct: 8,  label: "Connecting to Canvas...",        ms: 600   },
      { pct: 22, label: "Fetching course modules...",      ms: 2500  },
      { pct: 42, label: "Processing Echo360 data...",      ms: 5500  },
      { pct: 58, label: "Processing gradebook data...",    ms: 8500  },
      { pct: 76, label: "Generating AI analysis...",       ms: 12000 },
      { pct: 92, label: "Finalizing results...",           ms: 18000 },
    ];

    progressStopped.current = false;
    setProgress(0);
    setProgressLabel("Starting analysis...");

    const timers = STAGES.map(({ pct, label, ms }) =>
      window.setTimeout(() => {
        if (!progressStopped.current) { setProgress(pct); setProgressLabel(label); }
      }, ms)
    );

    try {
      setLoading(true);
      const form = new FormData();
      form.append("course_id",             courseId.trim());
      form.append("canvas_gradebook_csv",  canvasCsv);
      form.append("echo_analytics_csv",    echoCsv);

      const res = await fetch("/api/analyze", { method: "POST", body: form });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Server error (${res.status}): ${txt}`);
      }

      const json = (await res.json()) as AnalyzeResponse;

      progressStopped.current = true;
      timers.forEach(window.clearTimeout);
      setProgress(100);
      setProgressLabel("Done!");

      await new Promise((r) => setTimeout(r, 400));

      setResult(json);
      setStep(3);
      setActiveTab("tables");
    } catch (e: any) {
      progressStopped.current = true;
      timers.forEach(window.clearTimeout);
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // ---- PDF export (unchanged from V1) ----
  async function exportToPDF() {
    if (!printRef.current) return;
    setExportingPDF(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const jsPDF       = (await import("jspdf")).default;

      printRef.current.style.position = "absolute";
      printRef.current.style.left     = "-9999px";
      printRef.current.style.top      = "0";
      printRef.current.style.width    = "800px";
      printRef.current.style.display  = "block";

      const pdfWidth   = 210, pdfHeight = 297, margin = 10;
      const contentWidth      = pdfWidth - 2 * margin;
      const pageContentHeight = pdfHeight - 2 * margin;
      const pdf = new jsPDF("p", "mm", "a4");
      let yPosition = margin;

      const sections = printRef.current.querySelectorAll("[data-pdf-section]");
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i] as HTMLElement;
        const canvas  = await html2canvas(section, { scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff" });
        const imgData = canvas.toDataURL("image/png");
        const imgW    = contentWidth;
        const imgH    = (canvas.height * imgW) / canvas.width;
        const spaceLeft = pdfHeight - margin - yPosition;

        if (imgH <= spaceLeft) {
          pdf.addImage(imgData, "PNG", margin, yPosition, imgW, imgH);
          yPosition += imgH + 5;
        } else if (imgH <= pageContentHeight) {
          pdf.addPage(); yPosition = margin;
          pdf.addImage(imgData, "PNG", margin, yPosition, imgW, imgH);
          yPosition += imgH + 5;
        } else {
          if (yPosition > margin + 10) { pdf.addPage(); yPosition = margin; }
          const srcH = canvas.height, srcW = canvas.width;
          const pxPerMm = srcW / imgW;
          const pageHPx = pageContentHeight * pxPerMm;
          let srcY = 0;
          while (srcY < srcH) {
            const slicePx = Math.min(pageHPx, srcH - srcY);
            const sliceMm = slicePx / pxPerMm;
            const sc = document.createElement("canvas");
            sc.width = srcW; sc.height = slicePx;
            const sctx = sc.getContext("2d");
            if (sctx) {
              sctx.drawImage(canvas, 0, srcY, srcW, slicePx, 0, 0, srcW, slicePx);
              pdf.addImage(sc.toDataURL("image/png"), "PNG", margin, yPosition, imgW, sliceMm);
            }
            srcY += slicePx;
            if (srcY < srcH) { pdf.addPage(); yPosition = margin; }
            else yPosition += sliceMm + 5;
          }
        }
        if (yPosition > pdfHeight - margin - 20) yPosition = pdfHeight;
      }
      printRef.current.style.display = "none";
      pdf.save("analytics-report.pdf");
    } catch (err) {
      console.error("PDF export error:", err);
      alert("Failed to export PDF. Please try again.");
    } finally {
      if (printRef.current) printRef.current.style.display = "none";
      setExportingPDF(false);
    }
  }

  const steps = [
    { n: 1 as const, label: "Enter course" },
    { n: 2 as const, label: "Upload CSVs"  },
    { n: 3 as const, label: "Review insights" },
  ];
  const canGoToStep = (n: 1 | 2 | 3) => n <= step || (n === 3 && !!result);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-screen-2xl px-6 py-8">
        <header className="mb-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">CSU Online Analytics Dashboard</h1>
              <p className="mt-1 text-sm text-slate-600">Canvas Gradebook + Echo360 analytics</p>
            </div>
          </div>
          <div className="mt-5 border-t border-slate-200" />

          <nav aria-label="Progress" className="mt-5">
            <ol className="flex flex-wrap gap-2">
              {steps.map((s) => {
                const isActive   = s.n === step;
                const isComplete = s.n < step;
                const disabled   = !canGoToStep(s.n);
                return (
                  <li key={s.n} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => !disabled && setStep(s.n)}
                      disabled={disabled}
                      aria-current={isActive ? "step" : undefined}
                      className={
                        "group inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen disabled:opacity-50 disabled:cursor-not-allowed " +
                        (isActive   ? "border-slate-900 bg-slate-900 text-white"
                        : isComplete ? "border-slate-200 bg-white text-slate-800"
                        :              "border-slate-200 bg-white text-slate-700")
                      }
                    >
                      <span
                        className={
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold " +
                          (isActive   ? "bg-white/15 text-white"
                          : isComplete ? "bg-slate-100 text-slate-800"
                          :              "bg-slate-100 text-slate-700")
                        }
                        aria-hidden="true"
                      >
                        {s.n}
                      </span>
                      <span className="truncate">{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </header>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <section aria-label="Enter course" className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Step 1: Enter Course</h2>
            <div className="text-sm text-slate-600 mb-3">
              Use the numeric Canvas Course ID (the number in the course URL).
            </div>
            <label className="block text-sm font-medium text-slate-800 mb-1">Canvas Course ID</label>
            <input
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-csuGreen focus:border-csuGreen"
              placeholder="e.g., 123456"
            />

            {/* Course title confirmation */}
            <div className="mt-2 min-h-[1.5rem]">
              {courseTitleState === "loading" && (
                <p className="text-sm text-slate-500 flex items-center gap-1.5">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                  Looking up course…
                </p>
              )}
              {courseTitleState === "found" && courseTitle && (
                <p className="text-sm text-green-700 flex items-center gap-1.5">
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                  </svg>
                  <span><span className="font-medium">Course found:</span> {courseTitle}</span>
                </p>
              )}
              {courseTitleState === "error" && (
                <p className="text-sm text-red-600 flex items-center gap-1.5">
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                  </svg>
                  {courseTitleError}
                </p>
              )}
            </div>

            <div className="mt-4">
              <button
                onClick={() => setStep(2)}
                disabled={!courseId.trim()}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <section aria-label="Upload CSVs" className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Step 2: Upload CSVs</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-800 mb-1">Canvas Gradebook CSV</label>
                <input type="file" accept=".csv" onChange={(e) => setCanvasCsv(e.target.files?.[0] ?? null)} className="w-full" />
                <div className="text-xs text-slate-500 mt-1">{canvasCsv ? canvasCsv.name : "No file selected"}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-800 mb-1">Echo360 Analytics CSV</label>
                <input type="file" accept=".csv" onChange={(e) => setEchoCsv(e.target.files?.[0] ?? null)} className="w-full" />
                <div className="text-xs text-slate-500 mt-1">{echoCsv ? echoCsv.name : "No file selected"}</div>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => setStep(1)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen"
              >
                Back
              </button>
              <button
                onClick={runAnalysis}
                disabled={loading}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen disabled:opacity-60"
              >
                {loading ? "Running..." : "Run Analysis"}
              </button>
            </div>

            {loading && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-sm font-medium text-slate-700">{progressLabel}</div>
                  <div className="text-sm font-semibold text-slate-600 tabular-nums">{progress}%</div>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full bg-slate-800 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="text-xs text-slate-400 mt-1.5">This may take 15–30 seconds</div>
              </div>
            )}
          </section>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Review Insights</h2>
                {courseTitle && (
                  <p className="mt-0.5 text-sm text-slate-600">{courseTitle}</p>
                )}
              </div>
              <button
                onClick={exportToPDF}
                disabled={exportingPDF}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {exportingPDF ? "Generating PDF..." : "Export Full Report"}
              </button>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[
                {
                  label: "Students Enrolled",
                  tip: "Unique students with Canvas enrollments included in these metrics.",
                  value: kpis.studentsEnrolled !== null ? kpis.studentsEnrolled.toLocaleString() : "—",
                },
                {
                  label: "Average View %",
                  tip: "Average Echo360 engagement percentage across all published media.",
                  value: kpis.averageViewPercent !== null ? `${(kpis.averageViewPercent * 100).toFixed(1)}%` : "—",
                },
                {
                  label: "Average Assignment Grade",
                  tip: "Mean assignment score for the class, combining all available grades.",
                  value: kpis.averageAssignmentGrade !== null ? `${(kpis.averageAssignmentGrade * 100).toFixed(1)}%` : "—",
                },
                {
                  label: "Median Letter Grade",
                  tip: "Median letter grade calculated from current Canvas scores.",
                  value: kpis.medianLetterGrade ?? "—",
                },
              ].map(({ label, tip, value }) => (
                <div key={label} className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                  <div className="text-xs font-medium text-slate-500 tracking-wide mb-1 flex items-center gap-1">
                    {label}
                    <Tooltip text={tip}>
                      <span className="inline-block cursor-help text-slate-400 hover:text-slate-600">ⓘ</span>
                    </Tooltip>
                  </div>
                  <div className="text-2xl font-semibold text-slate-900">{value}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div role="tablist" aria-label="Insights" className="mb-4 inline-flex flex-wrap gap-2 rounded-2xl bg-white border border-slate-200 p-2">
              {(["tables", "charts", "ai"] as const).map((t, idx) => {
                const label    = t === "tables" ? "Tables" : t === "charts" ? "Charts" : "AI Analysis";
                const selected = activeTab === t;
                const tabs     = ["tables", "charts", "ai"] as const;
                const handleKeyDown = (e: React.KeyboardEvent) => {
                  if (e.key === "ArrowRight") { e.preventDefault(); const ni = (idx + 1) % tabs.length; setActiveTab(tabs[ni]); setTimeout(() => document.getElementById(`tab-${tabs[ni]}`)?.focus(), 0); }
                  else if (e.key === "ArrowLeft") { e.preventDefault(); const pi = (idx - 1 + tabs.length) % tabs.length; setActiveTab(tabs[pi]); setTimeout(() => document.getElementById(`tab-${tabs[pi]}`)?.focus(), 0); }
                };
                return (
                  <button
                    key={t} role="tab" id={`tab-${t}`}
                    aria-selected={selected} aria-controls={`panel-${t}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveTab(t)} onKeyDown={handleKeyDown}
                    className={
                      "rounded-xl px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen " +
                      (selected ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-900 hover:bg-slate-50")
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {activeTab === "tables" && (
              <div role="tabpanel" id="panel-tables" aria-labelledby="tab-tables" className="grid gap-4">
                <Table title="Echo Summary"           rows={echoSummary}              columns={ECHO_SUMMARY_COLS}       percentCols={ECHO_SUMMARY_PERCENT_COLS}   maxRows={200} />
                <Table title="Echo Module Table"      rows={echoModules}              columns={ECHO_MODULE_COLS}        percentCols={ECHO_MODULE_PERCENT_COLS}    maxRows={200} />
                <Table
                  title="Gradebook Summary Rows"
                  rows={gradeSummary}
                  columns={gradeSummary?.[0]?.Metric ? ["Metric", ...Object.keys(gradeSummary[0]).filter((k) => k !== "Metric")] : undefined}
                  percentCols={gradeSummaryPercentCols}
                  maxRows={50}
                />
                <Table title="Gradebook Module Metrics" rows={sortedGradeModuleMetrics} columns={GRADEBOOK_MODULE_COLS} percentCols={GRADEBOOK_MODULE_PERCENT_COLS} maxRows={200} />
              </div>
            )}

            {activeTab === "charts" && (
              <div role="tabpanel" id="panel-charts" aria-labelledby="tab-charts" className="grid gap-4">
                <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
                  <div className="text-lg font-semibold text-slate-900 mb-2">Echo Chart</div>
                  <EchoComboChart moduleRows={echoModules as any} />
                </div>
                <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
                  <div className="text-lg font-semibold text-slate-900 mb-2">Gradebook Chart</div>
                  <GradebookComboChart rows={sortedGradeModuleMetrics as any} />
                </div>
              </div>
            )}

            {activeTab === "ai" && (
              <div role="tabpanel" id="panel-ai" aria-labelledby="tab-ai" className="space-y-4">
                {result?.analysis?.error ? (
                  <div className="rounded-2xl bg-white border border-slate-200 shadow-md p-6">
                    <div className="text-sm text-red-700">{result.analysis.error}</div>
                  </div>
                ) : (() => {
                  let analysisData: AIAnalysisData | null = null;
                  try {
                    if (result?.analysis?.text) analysisData = JSON.parse(result.analysis.text);
                  } catch { /* fallback below */ }

                  if (analysisData?.cards?.length) {
                    return analysisData.cards.map((card) => (
                      <div key={card.id} className="rounded-2xl bg-white border border-slate-200 shadow-md p-6">
                        <div className="text-lg font-semibold text-slate-900 mb-3">{card.title}</div>
                        {card.summary && <p className="text-sm text-slate-700 mb-4">{card.summary}</p>}
                        {card.bullets?.length > 0 && (
                          <ul className="list-disc list-inside space-y-1 mb-4">
                            {card.bullets.map((b, i) => <li key={i} className="text-sm text-slate-700">{b}</li>)}
                          </ul>
                        )}
                        {card.metrics?.length > 0 && (
                          <div className="flex flex-wrap gap-4 pt-3 border-t border-slate-100">
                            {card.metrics.map((m, i) => (
                              <div key={i} className="text-sm">
                                <span className="text-slate-500">{m.label}:</span>{" "}
                                <span className="font-medium text-slate-800">{m.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ));
                  }

                  return (
                    <div className="rounded-2xl bg-white border border-slate-200 shadow-md p-6">
                      <div className="text-lg font-semibold text-slate-900 mb-2">AI Analysis</div>
                      <pre className="text-sm font-sans whitespace-pre-wrap text-slate-800">
                        {result?.analysis?.text ?? "No AI analysis returned."}
                      </pre>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hidden print container for PDF export */}
      <div ref={printRef} style={{ display: "none", width: "800px" }} className="bg-white">
        <div data-pdf-section="header-kpis" className="p-6">
          <div className="mb-6 pb-4 border-b-2 border-slate-300">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">CSU Online Analytics Report</h1>
            {courseTitle && (
              <p className="text-base font-medium text-slate-700 mb-1">{courseTitle}</p>
            )}
            <p className="text-sm text-slate-600">Course ID: {courseId}</p>
            <p className="text-sm text-slate-500">Generated: {new Date().toLocaleDateString()}</p>
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Key Performance Indicators</h2>
          <div className="grid grid-cols-4 gap-4">
            {[
              ["Students Enrolled",     kpis.studentsEnrolled ?? "—"],
              ["Average View %",        kpis.averageViewPercent !== null ? `${(kpis.averageViewPercent * 100).toFixed(1)}%` : "—"],
              ["Avg Assignment Grade",  kpis.averageAssignmentGrade !== null ? `${(kpis.averageAssignmentGrade * 100).toFixed(1)}%` : "—"],
              ["Median Letter Grade",   kpis.medianLetterGrade ?? "—"],
            ].map(([label, val]) => (
              <div key={String(label)} className="border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-500 mb-1">{label}</div>
                <div className="text-xl font-semibold">{val}</div>
              </div>
            ))}
          </div>
        </div>

        {echoSummary.length > 0 && (
          <div data-pdf-section="echo-summary" className="p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Echo Summary</h2>
            <table className="w-full text-xs border-collapse border border-slate-300">
              <thead><tr className="bg-slate-100">
                {ECHO_SUMMARY_COLS.filter((c) => echoSummary[0]?.[c] !== undefined).map((c) => (
                  <th key={c} className="border border-slate-300 px-2 py-1.5 text-left font-semibold">{c}</th>
                ))}
              </tr></thead>
              <tbody>
                {echoSummary.slice(0, 25).map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    {ECHO_SUMMARY_COLS.filter((c) => echoSummary[0]?.[c] !== undefined).map((c) => (
                      <td key={c} className="border border-slate-300 px-2 py-1.5">{formatCell(c, row[c], ECHO_SUMMARY_PERCENT_COLS)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {echoSummary.length > 25 && <p className="text-xs text-slate-500 mt-2">Showing 25 of {echoSummary.length} rows</p>}
          </div>
        )}

        <div data-pdf-section="module-tables" className="p-6">
          {echoModules.length > 0 && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-3">Echo Module Metrics</h2>
              <table className="w-full text-xs border-collapse border border-slate-300">
                <thead><tr className="bg-slate-100">
                  {ECHO_MODULE_COLS.filter((c) => echoModules[0]?.[c] !== undefined).map((c) => (
                    <th key={c} className="border border-slate-300 px-2 py-1.5 text-left font-semibold">{c}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {echoModules.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      {ECHO_MODULE_COLS.filter((c) => echoModules[0]?.[c] !== undefined).map((c) => (
                        <td key={c} className="border border-slate-300 px-2 py-1.5">{formatCell(c, row[c], ECHO_MODULE_PERCENT_COLS)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {gradeSummary.length > 0 && (() => {
            const allCols   = Object.keys(gradeSummary[0] ?? {});
            const metricCol = allCols.includes("Metric") ? "Metric" : null;
            const dataCols  = allCols.filter((c) => c !== "Metric");
            const chunks: string[][] = [];
            for (let i = 0; i < dataCols.length; i += 5)
              chunks.push(metricCol ? [metricCol, ...dataCols.slice(i, i + 5)] : dataCols.slice(i, i + 5));
            return (
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-3">Gradebook Summary</h2>
                {chunks.map((cols, ci) => (
                  <div key={ci} className={ci > 0 ? "mt-4" : ""}>
                    {chunks.length > 1 && <p className="text-xs text-slate-500 mb-1">Part {ci + 1} of {chunks.length}</p>}
                    <table className="w-full text-xs border-collapse border border-slate-300">
                      <thead><tr className="bg-slate-100">
                        {cols.map((col, ci2) => <th key={col} className={`border border-slate-300 px-2 py-1.5 text-left font-semibold ${ci2 % 2 === 1 ? "bg-slate-200" : "bg-slate-100"}`}>{col}</th>)}
                      </tr></thead>
                      <tbody>
                        {gradeSummary.map((row, i) => (
                          <tr key={i}>
                            {cols.map((col, ci2) => (
                              <td key={col} className={`border border-slate-300 px-2 py-1.5 ${ci2 % 2 === 1 ? "bg-slate-100" : "bg-white"}`}>
                                {formatCell(col, row[col], gradeSummaryPercentCols)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {sortedGradeModuleMetrics.length > 0 && (
          <div data-pdf-section="gradebook-module" className="p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Gradebook Module Metrics</h2>
            <table className="w-full text-xs border-collapse border border-slate-300">
              <thead><tr className="bg-slate-100">
                {GRADEBOOK_MODULE_COLS.filter((c) => sortedGradeModuleMetrics[0]?.[c] !== undefined).map((c) => (
                  <th key={c} className="border border-slate-300 px-2 py-1.5 text-left font-semibold">{c}</th>
                ))}
              </tr></thead>
              <tbody>
                {sortedGradeModuleMetrics.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    {GRADEBOOK_MODULE_COLS.filter((c) => sortedGradeModuleMetrics[0]?.[c] !== undefined).map((c) => (
                      <td key={c} className="border border-slate-300 px-2 py-1.5">{formatCell(c, row[c], GRADEBOOK_MODULE_PERCENT_COLS)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div data-pdf-section="echo-chart" className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">Echo Engagement Chart</h2>
          <div style={{ width: "750px", height: "480px" }}>
            <EchoComboChart moduleRows={echoModules as any} />
          </div>
        </div>

        <div data-pdf-section="gradebook-chart" className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">Gradebook Performance Chart</h2>
          <div style={{ width: "750px", height: "480px" }}>
            <GradebookComboChart rows={sortedGradeModuleMetrics as any} />
          </div>
        </div>

        <div data-pdf-section="ai-analysis" className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">AI Analysis</h2>
          {(() => {
            let analysisData: AIAnalysisData | null = null;
            try { if (result?.analysis?.text) analysisData = JSON.parse(result.analysis.text); } catch { /* */ }
            if (analysisData?.cards?.length) {
              return analysisData.cards.map((card) => (
                <div key={card.id} className="mb-4 border border-slate-200 rounded-lg p-4">
                  <div className="text-md font-semibold text-slate-900 mb-2">{card.title}</div>
                  {card.summary && <p className="text-sm text-slate-700 mb-3">{card.summary}</p>}
                  {card.bullets?.length > 0 && (
                    <ul className="list-disc list-inside space-y-1 mb-3">
                      {card.bullets.map((b, i) => <li key={i} className="text-sm text-slate-700">{b}</li>)}
                    </ul>
                  )}
                  {card.metrics?.length > 0 && (
                    <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-100">
                      {card.metrics.map((m, i) => (
                        <div key={i} className="text-sm">
                          <span className="text-slate-500">{m.label}:</span>{" "}
                          <span className="font-medium text-slate-800">{m.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ));
            }
            return (
              <div className="border border-slate-200 rounded-lg p-4">
                <pre className="text-sm whitespace-pre-wrap text-slate-700">
                  {result?.analysis?.text ?? "No AI analysis available."}
                </pre>
              </div>
            );
          })()}
        </div>
      </div>
    </main>
  );
}

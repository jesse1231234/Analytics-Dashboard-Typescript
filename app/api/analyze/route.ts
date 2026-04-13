// app/api/analyze/route.ts
// Replaces the Python FastAPI /analyze endpoint entirely.
// Runs server-side on Vercel (Node.js runtime).

import { NextRequest, NextResponse } from "next/server";
import { buildCanvasOrderDf, getStudentCount } from "@/lib/canvas";
import { buildEchoTables } from "@/lib/echoAdapter";
import { buildGradebookTables } from "@/lib/gradesAdapter";
import { computeKpis } from "@/lib/kpis";
import { generateAnalysis } from "@/lib/aiAnalysis";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes — Vercel Pro limit; enough for Canvas + AI

export async function POST(req: NextRequest) {
  // ---- 1. Parse multipart form data ----
  let courseIdStr: string;
  let canvasCsvText: string;
  let echoCsvText: string;

  try {
    const form = await req.formData();
    courseIdStr = String(form.get("course_id") ?? "").trim();
    const canvasFile = form.get("canvas_gradebook_csv") as File | null;
    const echoFile   = form.get("echo_analytics_csv") as File | null;

    if (!courseIdStr || !canvasFile || !echoFile) {
      return NextResponse.json(
        { error: "Missing required fields: course_id, canvas_gradebook_csv, echo_analytics_csv" },
        { status: 400 }
      );
    }

    canvasCsvText = await canvasFile.text();
    echoCsvText   = await echoFile.text();
  } catch (e: any) {
    return NextResponse.json(
      { error: `Failed to parse request: ${e?.message ?? e}` },
      { status: 400 }
    );
  }

  const courseId = parseInt(courseIdStr, 10);
  if (isNaN(courseId)) {
    return NextResponse.json({ error: "course_id must be a number" }, { status: 400 });
  }

  // ---- 2. Canvas context (module order + student count) ----
  let canvasOrderRows: Record<string, any>[] = [];
  let studentCount: number | null = null;

  try {
    [canvasOrderRows, studentCount] = await Promise.all([
      buildCanvasOrderDf(courseId),
      getStudentCount(courseId),
    ]);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Canvas error: ${e?.message ?? e}` },
      { status: 500 }
    );
  }

  // ---- 3. Process CSVs ----
  let echoTables, gradebookTables;

  try {
    echoTables = buildEchoTables(echoCsvText, canvasOrderRows, studentCount);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Echo360 processing error: ${e?.message ?? e}` },
      { status: 500 }
    );
  }

  try {
    gradebookTables = buildGradebookTables(canvasCsvText, canvasOrderRows);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Gradebook processing error: ${e?.message ?? e}` },
      { status: 500 }
    );
  }

  // ---- 4. KPIs ----
  const kpis = computeKpis(
    echoTables.echoSummary,
    gradebookTables.gradebookDf,
    gradebookTables.gradebookSummary,
    studentCount
  );

  // ---- 5. AI analysis (non-blocking: errors surface in response, not as 500) ----
  let analysisText: string | null = null;
  let analysisError: string | null = null;
  try {
    analysisText = await generateAnalysis(
      kpis,
      echoTables.moduleTable,
      gradebookTables.gradebookSummary,
      gradebookTables.moduleMetrics
    );
  } catch (e: any) {
    analysisError = String(e?.message ?? e);
  }

  // ---- 6. Response ----
  return NextResponse.json({
    kpis,
    echo: {
      summary: echoTables.echoSummary,
      modules: echoTables.moduleTable,
    },
    grades: {
      summary: gradebookTables.gradebookSummary,
      module_metrics: gradebookTables.moduleMetrics,
    },
    analysis: {
      text: analysisText,
      error: analysisError,
    },
  });
}

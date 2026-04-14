// app/api/course-name/route.ts
// Lightweight endpoint: returns the Canvas course name for a given course ID.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const courseIdStr = req.nextUrl.searchParams.get("course_id") ?? "";
  const courseId = parseInt(courseIdStr, 10);

  if (isNaN(courseId) || courseId <= 0) {
    return NextResponse.json({ error: "Invalid course_id" }, { status: 400 });
  }

  const baseUrl = (process.env.CANVAS_BASE_URL ?? "").replace(/\/$/, "");
  const token   = process.env.CANVAS_TOKEN ?? "";

  if (!baseUrl || !token) {
    return NextResponse.json(
      { error: "Canvas not configured on server" },
      { status: 500 }
    );
  }

  const res = await fetch(`${baseUrl}/api/v1/courses/${courseId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }
  if (res.status === 401 || res.status === 403) {
    return NextResponse.json(
      { error: "Canvas access denied — check your API token" },
      { status: res.status }
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: `Canvas error ${res.status}` },
      { status: 502 }
    );
  }

  const data = await res.json();
  const name: string = data.name ?? data.course_code ?? "";

  if (!name) {
    return NextResponse.json({ error: "Course found but has no name" }, { status: 200 });
  }

  return NextResponse.json({ name });
}

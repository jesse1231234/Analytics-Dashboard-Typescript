// lib/canvas.ts
// Server-only: Canvas LMS API client. Reads CANVAS_BASE_URL and CANVAS_TOKEN from env.

const CANVAS_BASE_URL = (process.env.CANVAS_BASE_URL ?? "").replace(/\/$/, "");
const CANVAS_TOKEN = process.env.CANVAS_TOKEN ?? "";

function authHeader() {
  return { Authorization: `Bearer ${CANVAS_TOKEN}` };
}

async function getAll<T>(url: string, params?: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let nextUrl: string | null =
    url + (params ? "?" + new URLSearchParams(params).toString() : "");

  while (nextUrl) {
    const res: Response = await fetch(nextUrl, { headers: authHeader() });
    if (!res.ok) {
      throw new Error(
        `Canvas API error ${res.status} at ${nextUrl}: ${await res.text()}`
      );
    }
    const data = await res.json();
    if (Array.isArray(data)) out.push(...data);
    else if (data && typeof data === "object") out.push(data as T);

    // Follow Link: rel="next"
    nextUrl = null;
    const link = res.headers.get("Link") ?? "";
    for (const part of link.split(",")) {
      if (part.includes('rel="next"')) {
        const m = part.match(/<([^>]+)>/);
        if (m) {
          nextUrl = m[1];
          break;
        }
      }
    }
  }

  return out;
}

// ---- Title cleaning (mirrors services/canvas.py) ----
const DURATION_TAIL_RE = /\s*\((?:\d{1,2}:)?\d{1,2}:\d{2}\)\s*$/i;
const READONLY_RE = /\s*\(read only\)\s*$/i;
const NUM_ID_TAIL_RE = /\s*-\s*\d{4,}\s*$/;

function stripNoise(title: string): string {
  let t = title.trim();
  t = t.replace(READONLY_RE, "");
  t = t.replace(DURATION_TAIL_RE, "");
  t = t.replace(NUM_ID_TAIL_RE, "");
  return t.trim();
}

// ---- Echo embed extraction from page HTML ----
function extractEchoEmbeds(html: string): string[] {
  if (!html) return [];
  const results: string[] = [];
  // Simple regex-based iframe parser (no DOM on server)
  const iframeRe = /<iframe[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = iframeRe.exec(html)) !== null) {
    const tag = match[0];
    const srcMatch = tag.match(/src=["']([^"']*)["']/i);
    const src = srcMatch?.[1] ?? "";
    if (!src.includes("echo360.org") && !src.includes("external_tools/retrieve")) continue;
    const titleMatch = tag.match(/title=["']([^"']*)["']/i);
    if (!titleMatch) continue;
    const cleaned = stripNoise(titleMatch[1].trim());
    if (cleaned) results.push(cleaned);
  }
  return results;
}

// ---- Public API ----

/**
 * Fetches all modules + items for a course and builds a flat row list
 * mirroring what CanvasService.build_order_df() returns in Python.
 */
export async function buildCanvasOrderDf(
  courseId: number
): Promise<Record<string, any>[]> {
  if (!CANVAS_BASE_URL || !CANVAS_TOKEN) {
    throw new Error(
      "Missing CANVAS_BASE_URL or CANVAS_TOKEN. Set them as environment variables in Vercel."
    );
  }

  const modules = await getAll<Record<string, any>>(
    `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/modules`,
    { per_page: "100", "include[]": "items" }
  );

  const rows: Record<string, any>[] = [];
  const sortedModules = [...modules].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );

  for (const m of sortedModules) {
    const modName: string = m.name ?? "";
    const modPos: number = m.position ?? 0;
    const items: Record<string, any>[] = (m.items ?? []).slice().sort(
      (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)
    );

    for (const it of items) {
      const itemType: string = it.type ?? "";
      const title: string = (it.title ?? "").trim();
      const itemPos: number = it.position ?? 0;
      const htmlUrl: string = it.html_url ?? "";
      const externalUrl: string = it.external_url ?? "";

      const base: Record<string, any> = {
        module: modName,
        module_position: modPos,
        item_type: itemType,
        item_position: itemPos,
        item_title_raw: title,
        item_title_normalized: title.toLowerCase(),
        video_title_raw: null,
        html_url: htmlUrl,
        external_url: externalUrl,
      };

      // Echo via ExternalTool / ExternalUrl
      if (
        (itemType === "ExternalTool" || itemType === "ExternalUrl") &&
        externalUrl.includes("echo360.org")
      ) {
        rows.push({ ...base, video_title_raw: stripNoise(title) });
        continue;
      }

      // Echo embedded inside a Canvas Page
      if (itemType === "Page") {
        const pageUrl: string = it.page_url ?? "";
        let body = "";
        if (pageUrl) {
          try {
            const res = await fetch(
              `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/pages/${pageUrl}`,
              { headers: authHeader() }
            );
            if (res.ok) body = (await res.json()).body ?? "";
          } catch {
            // ignore — treat as no embeds
          }
        }
        const embeds = extractEchoEmbeds(body);
        if (embeds.length) {
          for (const videoTitle of embeds) {
            rows.push({ ...base, video_title_raw: videoTitle });
          }
          continue;
        }
      }

      rows.push(base);
    }
  }

  return rows;
}

/**
 * Returns the count of active StudentEnrollment unique users,
 * or null if the API call fails / returns empty.
 */
export async function getStudentCount(courseId: number): Promise<number | null> {
  if (!CANVAS_BASE_URL || !CANVAS_TOKEN) return null;
  try {
    const enrollments = await getAll<Record<string, any>>(
      `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/enrollments`,
      { per_page: "100", "type[]": "StudentEnrollment", "state[]": "active" }
    );
    if (!enrollments.length) return null;
    const userIds = new Set(
      enrollments.map((e) => e.user_id).filter((id) => id != null)
    );
    return userIds.size || null;
  } catch {
    return null;
  }
}

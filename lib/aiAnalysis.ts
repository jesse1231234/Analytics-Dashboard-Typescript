// lib/aiAnalysis.ts
// Port of ai/analysis.py — calls Azure OpenAI and returns the cards JSON string.

const CARD_ORDER: Array<[string, string]> = [
  ["general_overview",      "General Overview"],
  ["echo360_engagement",    "Echo360 Engagement"],
  ["gradebook_trends",      "Gradebook Trends"],
  ["notable_trends",        "Notable Trends"],
  ["further_investigations","Further Investigations"],
];

const ALLOWED_TONES = new Set(["good", "warn", "bad", "neutral"]);

const SYSTEM_PROMPT = `You are an academic learning analytics assistant.
Write a concise, plain-English analysis for instructors teaching online asynchronous courses.

Content Rules (keep these exactly):
- Be specific: cite modules and metrics with percentages/counts.
- Call out trends and outliers.
- Focus on descriptions of the data.
- Do not make teaching recommendations. Only report on the data.
- Keep it under ~750 words unless asked for more.
- Always provide these same sections with these headings: "General Overview", "Echo360 Engagement", "Gradebook Trends", "Notable Trends", and "Further Investigations", in that order.

OUTPUT FORMAT (required):
Return ONLY valid JSON (no Markdown, no extra text) in this exact shape:

{
  "version": "1.0",
  "cards": [
    {
      "id": "general_overview",
      "title": "General Overview",
      "summary": "1-3 sentences, plain text.",
      "bullets": ["2-6 short bullet strings (plain text)"],
      "metrics": [{"label":"...", "value":"...", "tone":"good|warn|bad|neutral"}]
    }
  ]
}

Rules for JSON:
- cards MUST be exactly 5 objects in the order and ids/titles specified above.
- Each card must include: id, title, summary, bullets, metrics.
- bullets: 2-6 items (use [] only if truly nothing meaningful can be said).
- metrics: 0-4 items. If uncertain, leave metrics empty rather than inventing numbers.
- tone must be one of: good, warn, bad, neutral.
- No extra keys anywhere. No trailing commas. Must parse with JSON.parse.`;

function dfToMarkdown(rows: Record<string, any>[], maxRows = 30): string {
  if (!rows.length) return "(empty)";
  const sample = rows.slice(0, maxRows);
  const headers = Object.keys(sample[0]);
  const lines = [
    "| " + headers.join(" | ") + " |",
    "| " + headers.map(() => "---").join(" | ") + " |",
    ...sample.map((r) =>
      "| " +
      headers
        .map((h) => {
          const v = r[h];
          if (v === null || v === undefined) return "";
          const n = Number(v);
          if (!isNaN(n) && n >= 0 && n <= 1) return `${(n * 100).toFixed(1)}%`;
          return String(v);
        })
        .join(" | ") +
      " |"
    ),
  ];
  return lines.join("\n");
}

function blankReport(note: string) {
  return {
    version: "1.0",
    cards: CARD_ORDER.map(([id, title]) => ({
      id,
      title,
      summary: note,
      bullets: [] as string[],
      metrics: [] as any[],
    })),
  };
}

function normalizeReport(obj: any) {
  if (typeof obj !== "object" || !obj)
    return blankReport("AI analysis returned an invalid structure.");
  const cards = obj.cards;
  if (!Array.isArray(cards))
    return blankReport("AI analysis returned no 'cards' array.");

  const byId: Record<string, any> = {};
  for (const c of cards) {
    if (typeof c === "object" && typeof c?.id === "string") byId[c.id] = c;
  }

  const normalizedCards = CARD_ORDER.map(([id, title]) => {
    const src = byId[id] ?? {};
    let summary: string =
      typeof src.summary === "string" && src.summary.trim()
        ? src.summary.trim()
        : "No analysis returned for this section.";

    const bullets: string[] =
      Array.isArray(src.bullets) && src.bullets.every((b: any) => typeof b === "string")
        ? src.bullets.map((b: string) => b.trim()).filter(Boolean).slice(0, 6)
        : [];

    const metrics: any[] = [];
    if (Array.isArray(src.metrics)) {
      for (const m of src.metrics) {
        if (typeof m !== "object") continue;
        const { label, value } = m;
        let tone = m.tone ?? "neutral";
        if (!ALLOWED_TONES.has(tone)) tone = "neutral";
        if (typeof label !== "string" || typeof value !== "string") continue;
        metrics.push({ label: label.trim(), value: value.trim(), tone });
        if (metrics.length >= 4) break;
      }
    }

    return { id, title, summary, bullets, metrics };
  });

  return { version: "1.0", cards: normalizedCards };
}

export async function generateAnalysis(
  kpis: Record<string, any>,
  echoModules: Record<string, any>[],
  gradebookSummary: Record<string, any>[],
  moduleMetrics: Record<string, any>[]
): Promise<string> {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/$/, "");
  const apiKey   = process.env.AZURE_OPENAI_API_KEY ?? "";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o-mini";

  if (!endpoint || !apiKey) {
    return JSON.stringify(
      blankReport(
        "Azure OpenAI not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY in Vercel."
      )
    );
  }

  const kpiLines = Object.entries(kpis)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      if (typeof v === "number" && v >= 0 && v <= 1)
        return `- ${k}: ${(v * 100).toFixed(1)}%`;
      return `- ${k}: ${v}`;
    })
    .join("\n");

  const payload = `Data for analysis (de-identified):

# KPIs
${kpiLines || "(none)"}

# Echo Module Metrics (per-module)
${dfToMarkdown(echoModules)}

# Gradebook Summary Rows
${dfToMarkdown(gradebookSummary)}

# Gradebook Module Metrics (per-module)
${dfToMarkdown(moduleMetrics)}

Additional analysis rules:
- Identify general trends and data points worthy of further investigation.
- No need to list each section of the course individually. Call out aspects that seem important.
- Provide a short summary at the end of each section (put it into the card.summary field).
- In the "Notable Trends" section, compare overall patterns between Gradebook Module Metrics and Echo Module Metrics.`.trim();

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const callAzure = async (withJsonMode: boolean): Promise<Response> => {
    const body: Record<string, any> = {
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: payload },
      ],
    };
    if (withJsonMode) body.response_format = { type: "json_object" };
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify(body),
    });
  };

  try {
    let res = await callAzure(true);
    if (!res.ok) {
      // Retry without json_object mode (older deployments)
      res = await callAzure(false);
    }
    if (!res.ok) throw new Error(`Azure OpenAI error: ${res.status} ${await res.text()}`);

    const data = await res.json();
    const raw: string = (data.choices?.[0]?.message?.content ?? "").trim();
    const normalized = normalizeReport(JSON.parse(raw));
    return JSON.stringify(normalized);
  } catch (e: any) {
    return JSON.stringify(
      blankReport(`AI analysis failed: ${e?.message ?? String(e)}`)
    );
  }
}

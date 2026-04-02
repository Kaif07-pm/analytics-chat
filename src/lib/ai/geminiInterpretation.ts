import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SqlResultJson } from "../db/eventsDb";
import type { ChartModel } from "../chart/chartPicker";

function getGeminiApiKey(): string | null {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv) return fromEnv;

  // Your key may be stored in `data/.env.local` (based on what you opened).
  const filePath = path.join(process.cwd(), "data", ".env.local");
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m);
    return match?.[1] ? String(match[1]).trim() : null;
  } catch {
    return null;
  }
}

function toResultPreview(result: SqlResultJson, maxRows = 40) {
  return {
    columns: result.columns.map((c) => ({ name: c.name, type: c.type })),
    rows: result.rows.slice(0, maxRows)
  };
}

function inferMetricComparisonFacts(resultJson: SqlResultJson) {
  const xCandidates = resultJson.columns.map((c) => c.name);
  const numericCols = resultJson.columns
    .filter((c) => c.type === "integer" || c.type === "number")
    .map((c) => c.name);

  if (numericCols.length < 2) return null;

  // Prefer common time dimension names.
  const xKey =
    xCandidates.find((n) => n === "day" || n === "hour_of_day" || n === "week_start_date") ??
    xCandidates.find((n) => !numericCols.includes(n)) ??
    xCandidates[0];

  const y1 = numericCols[0];
  const y2 = numericCols[1];

  let total1 = 0;
  let total2 = 0;
  let max1 = -Infinity;
  let max2 = -Infinity;
  let max1At: string | null = null;
  let max2At: string | null = null;
  let higherRows = 0;
  let biggestGap = -Infinity;
  let biggestGapAt: string | null = null;

  const rows = resultJson.rows as Array<Record<string, unknown>>;
  for (const r of rows) {
    const v1 = Number((r as any)[y1] ?? 0);
    const v2 = Number((r as any)[y2] ?? 0);
    total1 += Number.isFinite(v1) ? v1 : 0;
    total2 += Number.isFinite(v2) ? v2 : 0;
    if (v1 > max1) {
      max1 = v1;
      max1At = String((r as any)[xKey] ?? "");
    }
    if (v2 > max2) {
      max2 = v2;
      max2At = String((r as any)[xKey] ?? "");
    }
    if (v1 > v2) higherRows += 1;
    const gap = Math.abs(v1 - v2);
    if (gap > biggestGap) {
      biggestGap = gap;
      biggestGapAt = String((r as any)[xKey] ?? "");
    }
  }

  return {
    xKey,
    y1,
    y2,
    total1,
    total2,
    max1,
    max1At,
    max2,
    max2At,
    higherRows,
    biggestGap,
    biggestGapAt
  };
}

export async function buildGeminiInterpretation(args: {
  question: string;
  sql: string;
  resultJson: SqlResultJson;
  chartModel?: ChartModel | null;
  previousInterpretation?: string | null;
}): Promise<string | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    const model = genAI.getGenerativeModel({ model: modelName });

    const preview = toResultPreview(args.resultJson, 60);
    const chartHint = args.chartModel
      ? args.chartModel.kind === "x_y"
        ? `x=${args.chartModel.xKey}, y=${args.chartModel.yKey}`
        : args.chartModel.kind === "x_y_multi"
          ? `x=${args.chartModel.xKey}, y=${args.chartModel.yKeys.join(", ")}`
          : "table/kpi"
      : "";

    const comparisonFacts = inferMetricComparisonFacts(args.resultJson);

    const prompt = `
You are an analytics interpreter.
Given:
- User question: ${args.question}
- SQL used (do not repeat it in the answer): ${args.sql}
- Query output (JSON preview; do not repeat JSON in the answer):
${JSON.stringify(preview, null, 2)}
- Chart hint: ${chartHint}

Precomputed comparison facts (use these exact values if you mention them; do not recompute):
${comparisonFacts ? JSON.stringify(comparisonFacts, null, 2) : "N/A"}

Write a clear, executive-friendly interpretation in natural language.
Constraints:
- Do NOT output JSON or SQL.
- Do NOT invent any numbers not present in the result.
- You may summarize trends, peaks, and counts exactly as they appear.
- Keep it more helpful for readers: include (1) overall trend, (2) key comparison between series/lines if 2 metrics exist, (3) at least one notable peak or standout point from the preview.
- Keep it concise (4-8 short sentences).
 
If the result contains multiple numeric metrics over time, explicitly compare which one is higher most of the time and call out the biggest gap row.
Avoid hedging like "possibly".
`.trim();

    const resp = await model.generateContent(prompt);
    const text = resp.response.text();
    if (!text) return null;
    return text.trim();
  } catch {
    return null;
  }
}

export async function buildGeminiCrossAnswer(args: {
  followUpQuestion: string;
  originalQuestion: string;
  lastSql: string;
  lastResult: SqlResultJson;
  lastInterpretation?: string | null;
}): Promise<string | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    const model = genAI.getGenerativeModel({ model: modelName });

    const preview = toResultPreview(args.lastResult, 60);

    const prompt = `
You are continuing an analytics chat.
Use ONLY the previously returned result output (JSON preview below) and the previous interpretation.

Original question: ${args.originalQuestion}
Previous interpretation (may include key insights):
${args.lastInterpretation ?? ""}

Previously executed SQL (do not repeat it):
${args.lastSql}

Previously returned query output (do not output JSON):
${JSON.stringify(preview, null, 2)}

Now the user asks follow-up:
${args.followUpQuestion}

Answer with natural language, using the earlier result.
Constraints:
- Do NOT output JSON or SQL.
- Do NOT invent new metrics not in the result preview.
- If the follow-up requires information not in the previous output, ask a short clarifying question.
- Keep it concise (1-5 short sentences).
`.trim();

    const resp = await model.generateContent(prompt);
    const text = resp.response.text();
    return text ? text.trim() : null;
  } catch {
    return null;
  }
}


import fs from "fs";
import path from "path";

/** Normalize keys pasted from Vercel UI (quotes / whitespace). */
export function normalizeGeminiApiKey(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const t = String(raw).trim().replace(/^["']|["']$/g, "");
  return t.length > 0 ? t : null;
}

export function getGeminiApiKeyFromEnv(): string | null {
  return normalizeGeminiApiKey(process.env.GEMINI_API_KEY);
}

/**
 * Env first, then optional `data/.env.local` for local dev (Next does not load nested env files).
 */
export function getGeminiApiKeyFromEnvOrFile(): string | null {
  const fromEnv = getGeminiApiKeyFromEnv();
  if (fromEnv) return fromEnv;

  const filePath = path.join(process.cwd(), "data", ".env.local");
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/m);
    return match?.[1] ? normalizeGeminiApiKey(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * On Vercel Hobby, functions are capped at ~10s. This app calls Gemini for SQL and again for
 * interpretation — often timing out. Skip the second call unless GEMINI_INTERPRET=1 (use with Pro + longer maxDuration).
 */
export function shouldUseGeminiInterpretation(): boolean {
  if (process.env.VERCEL !== "1") return true;
  return process.env.GEMINI_INTERPRET === "1";
}

import fs from "fs";
import Database from "better-sqlite3";
import { EVENTS_DB_PATH } from "./paths";
import { seedDbs } from "./seedDbs";

export type SqlResultColumn = { name: string; type: string };
export type SqlResultJson = {
  meta: { sql: string; params?: Record<string, unknown> };
  columns: SqlResultColumn[];
  rows: Array<Record<string, unknown>>;
};

function inferType(values: unknown[]): string {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (nonNull.length === 0) return "unknown";
  const sample = nonNull.slice(0, 50);
  const allNumbers = sample.every((v) => typeof v === "number" || (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))));
  if (allNumbers) {
    const nums = sample.map((v) => (typeof v === "number" ? v : Number(v)));
    const allIntegers = nums.every((n) => Math.abs(n - Math.round(n)) < 1e-9);
    return allIntegers ? "integer" : "number";
  }
  const allIsoLike = sample.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
  if (allIsoLike) return "date_or_timestamp";
  const allHourLike = sample.every((v) => typeof v === "string" && /^\d{1,2}$/.test(v));
  if (allHourLike) return "hour";
  return "text";
}

let eventsDbInitPromise: Promise<void> | null = null;

async function ensureEventsDb() {
  if (fs.existsSync(EVENTS_DB_PATH)) return;
  if (!eventsDbInitPromise) {
    // For prototype/serverless: create DBs automatically on first request.
    eventsDbInitPromise = seedDbs().then(() => undefined).finally(() => {
      eventsDbInitPromise = null;
    });
  }
  await eventsDbInitPromise;
}

export async function runEventsSql(sql: string, params?: Record<string, unknown>): Promise<SqlResultJson> {
  await ensureEventsDb();
  const db = new Database(EVENTS_DB_PATH, { readonly: true });
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all(params ?? {});
    const columnNames = stmt.columns().map((c: any) => (typeof c === "string" ? c : c.name));
    const cols: SqlResultColumn[] = columnNames.map((name: string) => {
      const values = rows.map((r: any) => r[name]);
      return { name, type: inferType(values) };
    });
    return { meta: { sql, params }, columns: cols, rows: rows as any };
  } finally {
    db.close();
  }
}


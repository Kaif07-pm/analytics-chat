import type { SqlResultJson } from "../db/eventsDb";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getGeminiApiKeyFromEnvOrFile } from "./geminiEnv";

export type SqlGenNeedsClarification = {
  message: string;
  missingFields: string[];
};

export type SqlGenOutput =
  | {
      kind: "ok";
      sql: string;
      params?: Record<string, unknown>;
      intent?:
        | "MOST_ACTION_DAILY"
        | "ONBOARDING_THIS_MONTH"
        | "ONBOARDING_THIS_MONTH_WEEK_WISE"
        | "BULK_UPLOADS_PEAK_HOUR"
        | "CHECKER_GROUP_APPROVES_MOST"
        | "AVG_WAIT_MAKER_TO_ADMIN"
        | "ELEVATED_ACCESS_PENDING_QUEUE";
    }
  | {
      kind: "out_of_scope";
      message: string;
    }
  | {
      kind: "needs_clarification";
      clarification: SqlGenNeedsClarification;
    };

function toISTSqlNowParam(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const p: Record<string, string> = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function monthMatchExpr(nowIsoParamName: string) {
  // Use IST timestamps stored as "YYYY-MM-DD HH:MM:SS".
  return `strftime('%Y-%m', timestamp_ist) = strftime('%Y-%m', ${nowIsoParamName})`;
}

function parseMonthOffset(question: string): number | null {
  const q = question.toLowerCase();
  if (q.includes("this month") || q.includes("current month")) return 0;
  if (q.includes("last month") || q.includes("previous month")) return -1;
  return null;
}

function stripCodeFences(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```[a-zA-Z0-9]*\n?/, "").replace(/```$/, "").trim();
  }
  return trimmed;
}

function extractJsonObject(text: string): any | null {
  const cleaned = stripCodeFences(text).trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to salvage: extract the first {...} block.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const candidate = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

function safeValidateSql(sql: string): { ok: true } | { ok: false; reason: string } {
  let trimmed = sql.trim();
  // Allow a single trailing semicolon (common in SQL generators).
  if (trimmed.endsWith(";")) trimmed = trimmed.slice(0, -1).trim();
  
  // Strip string literals before validation to avoid false positives out of them
  const sqlWithoutStrings = trimmed.replace(/'[^']*'/g, '');
  const compact = sqlWithoutStrings.toLowerCase();

  const forbidden = /\b(insert|update|delete|drop|alter|create|truncate|attach|detach|pragma)\b/i;
  if (forbidden.test(compact)) return { ok: false, reason: "SQL contains forbidden statement keywords." };
  const lowerTrimmed = trimmed.toLowerCase();
  if (!(lowerTrimmed.startsWith("select") || lowerTrimmed.startsWith("with"))) return { ok: false, reason: "Only SELECT/CTE queries are allowed." };
  // Block multiple statements (after stripping a possible trailing semicolon).
  if (compact.includes(";")) return { ok: false, reason: "Multiple SQL statements are not allowed." };
  // Must reference events data.
  if (!compact.includes("from events")) return { ok: false, reason: "SQL must read from the `events` table." };
  return { ok: true };
}

function buildEventsSchemaContext() {
  return `
You generate SQL for a SQLite database with a single analytics table: events.

Schema:
- events.event_id (TEXT, PK)
- events.event_name (TEXT)
- events.timestamp_ist (TEXT, format 'YYYY-MM-DD HH:MM:SS' in Asia/Kolkata)
- events.user_id (TEXT)
- events.user_role (TEXT)
- events.context_object (TEXT)
- events.properties_json (TEXT, JSON string)

Important:
- Access JSON fields via json_extract(events.properties_json, '$.<key>').
- Only generate safe read-only SQL: a single SELECT statement or a WITH/CTE followed by SELECT.
- Allowed table: events only. No other tables.
- Allowed output shapes:
  - Time/category + metric columns for charts (e.g., day/week_start_date/hour_of_day + count/average).
  - Or KPI shape (single-row single-metric column) for scalar answers.

Known properties_json keys by event_name (not exhaustive):
- create_custom_role: role_name, permissions, operator_count_impact
- submit_maker_draft/approve_maker_draft: draft_id, maker_user_id, signature_valid, action_taken, checker_group_id, checker_group_name
- initiate_screening: reference_id, field_screened, screening_category (ONBOARDING_* categories)
- bulk_upload_submit: request_type, file_name, row_count, template_valid
- upload_bulk_screening: file_name, record_count, template_version, upload_method
- request_elevated_access / approve_elevated_access / reject_elevated_access:
  elevated_access_request_id, target_resource, access_type, status
- approve_elevated_access / reject_elevated_access: status
- filter_evaluation_cases: assignment_status, case_status, custom_filter_applied

Time helpers (timestamp_ist is IST string):
- day: date(timestamp_ist)
- hour of day: cast(strftime('%H', timestamp_ist) as integer)
- month: strftime('%Y-%m', timestamp_ist)

For relative month phrases like "this month/last month/current month/previous month", use :nowIso param.
For example:
  strftime('%Y-%m', timestamp_ist) = strftime('%Y-%m', datetime(:nowIso, '-1 month'))

For any other date ranges, you may use literal dates in SQL if present in the question.
`.trim();
}

async function generateSqlViaOpenAI(args: {
  question: string;
  context?: { lastSql?: string; lastResult?: SqlResultJson | null };
}): Promise<SqlGenOutput | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const openai = new OpenAI({ apiKey });
  const model = process.env.OPENAI_SQL_MODEL ?? "gpt-4o-mini";

  const nowIso = toISTSqlNowParam(new Date());

  const schemaCtx = buildEventsSchemaContext();
  const contextForModel = args.context?.lastResult
    ? {
        lastSql: args.context?.lastSql ?? null,
        lastResultColumns: args.context.lastResult.columns,
        lastResultRowsPreview: args.context.lastResult.rows.slice(0, 20)
      }
    : { lastSql: args.context?.lastSql ?? null, lastResult: null };

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are an analytics assistant. Convert the user's question into a single safe SQLite SELECT query over the `events` table and its `properties_json` JSON fields. Return STRICT JSON only."
      },
      {
        role: "user",
        content: `
${schemaCtx}

User question:
${args.question}

nowIso (IST, 'YYYY-MM-DD HH:MM:SS'):
${nowIso}

Additional context (optional):
${JSON.stringify(contextForModel, null, 2)}

Return JSON with one of these shapes (no other text):
1) If you can answer:
{
  "type": "sql",
  "sql": "<single SELECT query string with no semicolons>",
  "params": { "nowIso": "<string>" } // include nowIso if you reference :nowIso, otherwise you can omit params
}
2) If the question is missing required info (e.g., unclear date range or which group/user):
{
  "type": "clarify",
  "message": "<ask one short follow-up question>",
  "missingFields": ["<field1>", "<field2>"]
}
3) If the question is out of scope for this database model:
{
  "type": "out_of_scope",
  "message": "<short out-of-scope message>"
}
`
      }
    ],
    response_format: { type: "json_object" }
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) return null;
  const parsed = JSON.parse(stripCodeFences(content));

  if (parsed.type === "out_of_scope") {
    return { kind: "out_of_scope", message: String(parsed.message ?? "Out of scope.") };
  }

  if (parsed.type === "clarify") {
    return {
      kind: "needs_clarification",
      clarification: {
        message: String(parsed.message ?? "I need one more detail to run this."),
        missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields.map(String) : []
      }
    };
  }

  if (parsed.type === "sql" && typeof parsed.sql === "string") {
    const sql = parsed.sql;
    const validated = safeValidateSql(sql);
    if (!validated.ok) {
      // If validation fails, fall back to rule-based (if possible).
      return null;
    }

    const params: Record<string, unknown> = {};
    if (parsed.params && typeof parsed.params === "object") Object.assign(params, parsed.params);
    if (sql.includes(":nowIso")) {
      params.nowIso = params.nowIso ?? nowIso;
    }

    return { kind: "ok", sql, params };
  }

  return null;
}

async function generateSqlViaGemini(args: {
  question: string;
  context?: { lastSql?: string; lastResult?: SqlResultJson | null };
}): Promise<SqlGenOutput | null> {
  const apiKey = getGeminiApiKeyFromEnvOrFile();
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const model = genAI.getGenerativeModel({ model: modelName });

  const nowIso = toISTSqlNowParam(new Date());
  const schemaCtx = buildEventsSchemaContext();
  const contextForModel = args.context?.lastResult
    ? {
        lastSql: args.context?.lastSql ?? null,
        lastResultColumns: args.context.lastResult.columns,
        lastResultRowsPreview: args.context.lastResult.rows.slice(0, 20)
      }
    : { lastSql: args.context?.lastSql ?? null, lastResult: null };

  const prompt = `
${schemaCtx}

User question:
${args.question}

nowIso (IST, 'YYYY-MM-DD HH:MM:SS'):
${nowIso}

Additional context (optional):
${JSON.stringify(contextForModel, null, 2)}

Return JSON ONLY with one of these shapes (no markdown, no extra text):
1) If you can answer:
{
  "type": "sql",
  "sql": "<single SELECT query string with no semicolons>",
  "params": { "nowIso": "<string>" } // include nowIso if you reference :nowIso, otherwise you can omit params
}
2) If the question is missing required info:
{
  "type": "clarify",
  "message": "<ask one short follow-up question>",
  "missingFields": ["<field1>", "<field2>"]
}
3) If the question is out of scope:
{
  "type": "out_of_scope",
  "message": "<short out-of-scope message>"
}
`.trim();

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" }
  });
  const text = result.response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = extractJsonObject(text);
  }
  if (!parsed) return null;

  if (parsed.type === "out_of_scope") {
    return { kind: "out_of_scope", message: String(parsed.message ?? "Out of scope.") };
  }

  if (parsed.type === "clarify") {
    return {
      kind: "needs_clarification",
      clarification: {
        message: String(parsed.message ?? "I need one more detail to run this."),
        missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields.map(String) : []
      }
    };
  }

  if (parsed.type === "sql" && typeof parsed.sql === "string") {
    const sql = String(parsed.sql);
    const validated = safeValidateSql(sql);
    if (!validated.ok) return null;

    const params: Record<string, unknown> = {};
    if (parsed.params && typeof parsed.params === "object") Object.assign(params, parsed.params);
    if (sql.includes(":nowIso")) {
      params.nowIso = params.nowIso ?? nowIso;
    }

    return { kind: "ok", sql, params };
  }

  return null;
}

async function generateSqlFromNaturalLanguageRules(args: {
  question: string;
  context?: {
    lastSql?: string;
    lastResult?: SqlResultJson | null;
  };
}): Promise<SqlGenOutput> {
  const question = args.question.trim();
  const q = question.toLowerCase();

  const offset = parseMonthOffset(question);
  const hasOnboarding = q.includes("onboarding");
  const hasBulkUpload = q.includes("bulk upload");
  const wantsWeekWise = (q.includes("week") && (q.includes("wise") || q.includes("weekly") || q.includes("every week")));
  const wantsDayWise = (q.includes("day") && (q.includes("wise") || q.includes("daily") || q.includes("every day")));
  const wantsHourWise = (q.includes("hour") && (q.includes("wise") || q.includes("hourly") || q.includes("time of day") || q.includes("every hour")));

  // Maker vs Checker approvals over time (daily volume).
  // Example: "daily volume of Maker drafts submitted versus Checker approvals over time"
  const makerDrafts = q.includes("maker") && q.includes("draft");
  const checkerApprovals = q.includes("checker") && (q.includes("approve") || q.includes("approval"));
  const wantsDaily = q.includes("daily") || q.includes("every day") || q.includes("over time") || q.includes("daily volume") || q.includes("day wise");
  const wantsMakerVsChecker = makerDrafts && checkerApprovals && wantsDaily;
  if (wantsMakerVsChecker) {
    const nowIso = toISTSqlNowParam(new Date());
    const nowIsoParam = ":nowIso";
    const whereDaySql =
      offset === null
        ? `date(timestamp_ist) >= date(datetime(${nowIsoParam}), '-60 day')`
        : monthMatchExpr(offset === 0 ? nowIsoParam : `datetime(${nowIsoParam}, '${offset} month')`);

    return {
      kind: "ok",
      sql: `
        SELECT
          date(timestamp_ist) AS day,
          SUM(CASE WHEN event_name = 'submit_maker_draft' THEN 1 ELSE 0 END) AS maker_drafts_submitted,
          SUM(CASE WHEN event_name = 'approve_maker_draft' THEN 1 ELSE 0 END) AS checker_approvals
        FROM events
        WHERE event_name IN ('submit_maker_draft', 'approve_maker_draft')
          AND ${whereDaySql}
        GROUP BY day
        ORDER BY day ASC;
      `,
      params: { nowIso }
    };
  }

  // Generic time-series count for onboarding events (count of initiate_screening with ONBOARDING_* categories).
  if (hasOnboarding && (wantsWeekWise || wantsDayWise || wantsHourWise)) {
    const nowIso = toISTSqlNowParam(new Date());
    const nowIsoParam = ":nowIso";
    const shiftedNowIso = offset === null ? nowIsoParam : offset === 0 ? nowIsoParam : `datetime(${nowIsoParam}, '${offset} month')`;
    const monthFilterSql = offset === null ? "1=1" : monthMatchExpr(shiftedNowIso);

    if (wantsWeekWise) {
      return {
        kind: "ok",
        sql: `
          WITH base AS (
            SELECT
              date(timestamp_ist) AS event_day,
              date(
                timestamp_ist,
                '-' || ((CAST(strftime('%w', timestamp_ist) AS INTEGER) + 6) % 7) || ' days'
              ) AS week_start_date
            FROM events
            WHERE event_name = 'initiate_screening'
              AND ${monthFilterSql}
              AND json_extract(properties_json, '$.screening_category') LIKE 'ONBOARDING_%'
          )
          SELECT
            week_start_date,
            COUNT(*) AS onboarding_cases_processed
          FROM base
          GROUP BY week_start_date
          ORDER BY week_start_date ASC;
        `,
        params: { nowIso }
      };
    }

    if (wantsDayWise) {
      return {
        kind: "ok",
        sql: `
          SELECT
            date(timestamp_ist) AS day,
            COUNT(*) AS onboarding_cases_processed
          FROM events
          WHERE event_name = 'initiate_screening'
            AND ${monthFilterSql}
            AND json_extract(properties_json, '$.screening_category') LIKE 'ONBOARDING_%'
          GROUP BY day
          ORDER BY day ASC;
        `,
        params: { nowIso }
      };
    }

    if (wantsHourWise) {
      return {
        kind: "ok",
        sql: `
          SELECT
            CAST(strftime('%H', timestamp_ist) AS INTEGER) AS hour_of_day,
            COUNT(*) AS onboarding_cases_processed
          FROM events
          WHERE event_name = 'initiate_screening'
            AND ${monthFilterSql}
            AND json_extract(properties_json, '$.screening_category') LIKE 'ONBOARDING_%'
          GROUP BY hour_of_day
          ORDER BY hour_of_day ASC;
        `,
        params: offset === null ? undefined : { nowIso }
      };
    }
  }

  // Generic time-series count for bulk upload events.
  if (hasBulkUpload && (wantsWeekWise || wantsDayWise || wantsHourWise)) {
    const nowIso = toISTSqlNowParam(new Date());
    const nowIsoParam = ":nowIso";
    const shiftedNowIso = offset === null ? nowIsoParam : offset === 0 ? nowIsoParam : `datetime(${nowIsoParam}, '${offset} month')`;
    const monthFilterSql = offset === null ? "1=1" : monthMatchExpr(shiftedNowIso);

    const bulkWhere = `event_name IN ('bulk_upload_submit', 'upload_bulk_screening')`;

    if (wantsWeekWise) {
      return {
        kind: "ok",
        sql: `
          WITH base AS (
            SELECT
              date(
                timestamp_ist,
                '-' || ((CAST(strftime('%w', timestamp_ist) AS INTEGER) + 6) % 7) || ' days'
              ) AS week_start_date
            FROM events
            WHERE ${bulkWhere}
              AND ${monthFilterSql}
          )
          SELECT
            week_start_date,
            COUNT(*) AS bulk_upload_count
          FROM base
          GROUP BY week_start_date
          ORDER BY week_start_date ASC;
        `,
        params: { nowIso }
      };
    }

    if (wantsDayWise) {
      return {
        kind: "ok",
        sql: `
          SELECT
            date(timestamp_ist) AS day,
            COUNT(*) AS bulk_upload_count
          FROM events
          WHERE ${bulkWhere}
            AND ${monthFilterSql}
          GROUP BY day
          ORDER BY day ASC;
        `,
        params: offset === null ? undefined : { nowIso }
      };
    }

    if (wantsHourWise) {
      return {
        kind: "ok",
        sql: `
          SELECT
            CAST(strftime('%H', timestamp_ist) AS INTEGER) AS hour_of_day,
            COUNT(*) AS bulk_upload_count
          FROM events
          WHERE ${bulkWhere}
            AND ${monthFilterSql}
          GROUP BY hour_of_day
          ORDER BY hour_of_day ASC;
        `,
        params: offset === null ? undefined : { nowIso }
      };
    }
  }

  // Generic time-series counts for maker submissions / admin approvals for drafts.
  const wantsDrafts = q.includes("draft") || q.includes("drafts");
  if (wantsDrafts && (wantsWeekWise || wantsDayWise) && (q.includes("approve") || q.includes("approval") || q.includes("approved"))) {
    const nowIso = toISTSqlNowParam(new Date());
    const nowIsoParam = ":nowIso";
    const shiftedNowIso = offset === null ? nowIsoParam : offset === 0 ? nowIsoParam : `datetime(${nowIsoParam}, '${offset} month')`;
    const monthFilterSql = offset === null ? "1=1" : monthMatchExpr(shiftedNowIso);
    const eventName = "approve_maker_draft";
    if (wantsWeekWise) {
      return {
        kind: "ok",
        sql: `
          WITH base AS (
            SELECT
              date(
                timestamp_ist,
                '-' || ((CAST(strftime('%w', timestamp_ist) AS INTEGER) + 6) % 7) || ' days'
              ) AS week_start_date
            FROM events
            WHERE event_name = '${eventName}'
              AND ${monthFilterSql}
          )
          SELECT
            week_start_date,
            COUNT(*) AS approvals_count
          FROM base
          GROUP BY week_start_date
          ORDER BY week_start_date ASC;
        `,
        params: { nowIso }
      };
    }
    if (wantsDayWise) {
      return {
        kind: "ok",
        sql: `
          SELECT
            date(timestamp_ist) AS day,
            COUNT(*) AS approvals_count
          FROM events
          WHERE event_name = '${eventName}'
            AND ${monthFilterSql}
          GROUP BY day
          ORDER BY day ASC;
        `,
        params: offset === null ? undefined : { nowIso }
      };
    }
  }

  // 1) Daily top action
  if ((q.includes("most") || q.includes("highest")) && q.includes("every day")) {
    return {
      kind: "ok",
      intent: "MOST_ACTION_DAILY",
      sql: `
        WITH daily AS (
          SELECT
            date(timestamp_ist) AS day,
            event_name,
            COUNT(*) AS action_count
          FROM events
          GROUP BY date(timestamp_ist), event_name
        ),
        ranked AS (
          SELECT
            day,
            event_name,
            action_count,
            ROW_NUMBER() OVER (PARTITION BY day ORDER BY action_count DESC, event_name ASC) AS rn
          FROM daily
        )
        SELECT
          day,
          event_name AS top_action,
          action_count
        FROM ranked
        WHERE rn = 1
        ORDER BY day ASC;
      `
    };
  }

  // 2) Onboarding this month
  if (q.includes("onboarding") && (q.includes("this month") || q.includes("current month") || q.includes("last month") || q.includes("previous month"))) {
    const offset = parseMonthOffset(question);
    if (offset === null) {
      return { kind: "needs_clarification", clarification: { message: "Which month should I use?", missingFields: ["month"] } };
    }

    const nowIso = toISTSqlNowParam(new Date());
    const nowIsoParam = ":nowIso";
    const shiftedNowIso = offset === 0 ? nowIsoParam : `datetime(${nowIsoParam}, '${offset} month')`;

    // 2a) Week-wise onboarding this month
    const wantsWeekWise = q.includes("week") && (q.includes("wise") || q.includes("weekly"));
    if (wantsWeekWise) {
      return {
        kind: "ok",
        intent: "ONBOARDING_THIS_MONTH_WEEK_WISE",
        sql: `
          WITH base AS (
            SELECT
              date(timestamp_ist) AS event_day,
              date(
                timestamp_ist,
                '-' || ((CAST(strftime('%w', timestamp_ist) AS INTEGER) + 6) % 7) || ' days'
              ) AS week_start_date,
              timestamp_ist
            FROM events
            WHERE event_name = 'initiate_screening'
              AND ${monthMatchExpr(shiftedNowIso)}
              AND json_extract(properties_json, '$.screening_category') LIKE 'ONBOARDING_%'
          )
          SELECT
            week_start_date,
            COUNT(*) AS onboarding_cases_processed
          FROM base
          GROUP BY week_start_date
          ORDER BY week_start_date ASC;
        `,
        params: { nowIso }
      };
    }

    // 2b) Total onboarding cases for the month
    return {
      kind: "ok",
      intent: "ONBOARDING_THIS_MONTH",
      sql: `
        SELECT
          strftime('%Y-%m', ${shiftedNowIso}) AS month,
          COUNT(*) AS onboarding_cases_processed
        FROM events
        WHERE event_name = 'initiate_screening'
          AND ${monthMatchExpr(shiftedNowIso)}
          AND json_extract(properties_json, '$.screening_category') LIKE 'ONBOARDING_%';
      `,
      params: { nowIso }
    };
  }

  // 3) Peak bulk upload hour
  if ((q.includes("time of day") || q.includes("peak") || q.includes("highest")) && q.includes("bulk")) {
    // Covers: "What time of day sees the highest volume of bulk uploads?"
    return {
      kind: "ok",
      intent: "BULK_UPLOADS_PEAK_HOUR",
      sql: `
        WITH counts AS (
          SELECT
            CAST(strftime('%H', timestamp_ist) AS INTEGER) AS hour_of_day,
            COUNT(*) AS bulk_upload_count
          FROM events
          WHERE event_name IN ('bulk_upload_submit', 'upload_bulk_screening')
          GROUP BY hour_of_day
        )
        SELECT
          hour_of_day,
          bulk_upload_count
        FROM counts
        ORDER BY bulk_upload_count DESC, hour_of_day ASC
        LIMIT 1;
      `
    };
  }

  // 4) Checker group approves most drafts
  if (q.includes("checker group") && (q.includes("approve") || q.includes("approves")) && q.includes("draft")) {
    return {
      kind: "ok",
      intent: "CHECKER_GROUP_APPROVES_MOST",
      sql: `
        SELECT
          json_extract(properties_json, '$.checker_group_name') AS checker_group_name,
          COUNT(*) AS approvals_count
        FROM events
        WHERE event_name = 'approve_maker_draft'
        GROUP BY checker_group_name
        ORDER BY approvals_count DESC, checker_group_name ASC
        LIMIT 1;
      `
    };
  }

  // 5) Avg wait time between maker submission and admin approval
  if ((q.includes("average") || q.includes("avg")) && q.includes("wait") && q.includes("maker") && (q.includes("admin") || q.includes("approval"))) {
    return {
      kind: "ok",
      intent: "AVG_WAIT_MAKER_TO_ADMIN",
      sql: `
        WITH submissions AS (
          SELECT
            json_extract(properties_json, '$.draft_id') AS draft_id,
            timestamp_ist AS submitted_at
          FROM events
          WHERE event_name = 'submit_maker_draft'
        ),
        approvals AS (
          SELECT
            json_extract(properties_json, '$.draft_id') AS draft_id,
            timestamp_ist AS approved_at
          FROM events
          WHERE event_name = 'approve_maker_draft'
        )
        SELECT
          ROUND(AVG((strftime('%s', approved_at) - strftime('%s', submitted_at)) / 3600.0), 2) AS avg_wait_hours,
          ROUND(AVG((strftime('%s', approved_at) - strftime('%s', submitted_at)) / 60.0), 2) AS avg_wait_minutes
        FROM submissions s
        JOIN approvals a ON a.draft_id = s.draft_id
        WHERE s.draft_id IS NOT NULL AND a.draft_id IS NOT NULL;
      `
    };
  }

  // 6) Elevated access pending queue
  if ((q.includes("elevated") || q.includes("write access")) && (q.includes("pending") || q.includes("queue") || q.includes("sitting"))) {
    return {
      kind: "ok",
      intent: "ELEVATED_ACCESS_PENDING_QUEUE",
      sql: `
        WITH ranked AS (
          SELECT
            json_extract(properties_json, '$.elevated_access_request_id') AS request_id,
            json_extract(properties_json, '$.status') AS status,
            ROW_NUMBER() OVER (
              PARTITION BY json_extract(properties_json, '$.elevated_access_request_id')
              ORDER BY timestamp_ist DESC
            ) AS rn
          FROM events
          WHERE event_name IN (
            'request_elevated_access',
            'approve_elevated_access',
            'reject_elevated_access'
          )
        )
        SELECT
          COUNT(*) AS pending_requests_count
        FROM ranked
        WHERE rn = 1
          AND status = 'PENDING_SUPERIOR_APPROVAL';
      `
    };
  }

  return {
    kind: "out_of_scope",
    message: "Out of scope for this prototype. Try one of the quick access questions (or ask about system actions, onboarding this month, bulk upload volume by hour, checker group approvals, maker-to-admin wait time, or elevated access pending queue)."
  };
}

export async function generateSqlFromNaturalLanguage(args: {
  question: string;
  context?: {
    lastSql?: string;
    lastResult?: SqlResultJson | null;
  };
}): Promise<SqlGenOutput> {
  // Prefer Gemini (user provided GEMINI_API_KEY). Fall back to OpenAI (if configured).
  let gemini: SqlGenOutput | null = null;
  try {
    gemini = await generateSqlViaGemini({ question: args.question.trim(), context: args.context });
  } catch (error) {
    console.error("Gemini AI error:", error);
    gemini = null;
  }
  if (gemini) return gemini;

  let ai: SqlGenOutput | null = null;
  try {
    ai = await generateSqlViaOpenAI({ question: args.question.trim(), context: args.context });
  } catch (error) {
    console.error("OpenAI error:", error);
    ai = null;
  }
  if (ai) return ai;
  
  // Fall back to rule-based parser if AI models are disabled or fail.
  return generateSqlFromNaturalLanguageRules(args);
}


import fs from "fs";
import Database from "better-sqlite3";
import { addDays } from "date-fns";
import { EVENTS_DB_PATH, QUICK_ACCESS_DB_PATH, CHAT_DB_PATH, DB_DIR } from "./paths";

type UserRole = "Super Admin" | "General Admin" | "Portal Operator";

const USER_ROLES: UserRole[] = ["Super Admin", "General Admin", "Portal Operator"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toISTString(d: Date) {
  // Store an "IST local time" string without timezone label.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 19).replace("T", " ");
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choice<T>(arr: T[]) {
  return arr[randInt(0, arr.length - 1)];
}

function makeUserId(prefix: string) {
  return `${prefix}-${pad2(randInt(0, 99))}${pad2(randInt(0, 99))}`.replace("--", "-");
}

function uuidLike(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 6)}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
}

function makeDraftId() {
  return `DRF-${randInt(1000, 9999)}`;
}

function makeCheckerGroup() {
  const groups = [
    { id: "G-CHK-01", name: "Checker Group A" },
    { id: "G-CHK-02", name: "Checker Group B" },
    { id: "G-CHK-03", name: "Checker Group C" }
  ];
  return choice(groups);
}

function makeDeviceContext() {
  const devicePool = [
    { device: "Device: Desktop", os: "Windows 11", ip: `192.168.${randInt(0, 10)}.${randInt(1, 254)}` },
    { device: "Device: Laptop", os: "macOS 14", ip: `10.0.${randInt(0, 10)}.${randInt(1, 254)}` },
    { device: "Device: Tablet", os: "iPadOS 17", ip: `198.51.100.${randInt(1, 254)}` },
    { device: "Device: Desktop", os: "Ubuntu 22.04", ip: `192.168.1.${randInt(1, 254)}` },
    { device: "Device: Desktop", os: "Windows 10", ip: `172.16.${randInt(0, 20)}.${randInt(1, 254)}` }
  ];
  const picked = choice(devicePool);
  return `Device: ${picked.device.split(": ")[1]}\nOS: ${picked.os}\nIP: ${picked.ip}\nTZ: Asia/Kolkata`;
}

function makeBaseUsers() {
  // Make a stable enough pool for joins/joins-by-ids.
  const superAdminIds = ["U-991A", "U-993A", "U-990A"];
  const generalAdminIds = ["U-402B", "U-404B", "U-405B", "U-406B"];
  const operatorIds = ["U-114C", "U-110C", "U-229C", "U-310C", "U-311C"];
  return {
    superAdminIds,
    generalAdminIds,
    operatorIds
  };
}

function ensureDirExists() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function recreateDb(dbPath: string) {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  return dbPath;
}

function initEventsSchema(db: any) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      timestamp_ist TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_role TEXT NOT NULL,
      context_object TEXT,
      properties_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp_ist);
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
  `);
}

function initQuickAccessSchema(db: any) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS quick_access_questions (
      id TEXT PRIMARY KEY,
      question_text TEXT NOT NULL,
      sql_template TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function initChatSchema(db: any) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
  `);
}

function isoNowIstString() {
  return toISTString(new Date());
}

function seedQuickAccess(db: any) {
  const nowIsoIst = isoNowIstString();

  // Note: these templates use SQLite named parameters.
  const nowIsoParam = `:nowIso`;
  const monthMatch = `strftime('%Y-%m', timestamp_ist) = strftime('%Y-%m', ${nowIsoParam})`;

  const items: Array<{ id: string; question: string; sql: string }> = [
    {
      id: "qa_most_action_daily",
      question: "Which system action is performed the most every day?",
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
    },
    {
      id: "qa_onboarding_this_month",
      question: "How many total onboarding cases were processed this month?",
      sql: `
        SELECT
          strftime('%Y-%m', ${nowIsoParam}) AS month,
          COUNT(*) AS onboarding_cases_processed
        FROM events
        WHERE event_name = 'initiate_screening'
          AND ${monthMatch}
          AND json_extract(properties_json, '$.screening_category') LIKE 'ONBOARDING_%';
      `
    },
    {
      id: "qa_bulk_uploads_peak_hour",
      question: "What time of day sees the highest volume of bulk uploads?",
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
    },
    {
      id: "qa_checker_group_approves_most",
      question: "Which specific Checker Group approves the most drafts?",
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
    },
    {
      id: "qa_avg_wait_maker_to_admin",
      question: "What is the average wait time between a Maker's submission and an Admin's approval?",
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
    },
    {
      id: "qa_elevated_access_pending",
      question: "How many elevated access requests are currently sitting in the pending queue?",
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
    }
  ];

  const createdAt = isoNowIstString();
  const insert = db.prepare(`
    INSERT INTO quick_access_questions (id, question_text, sql_template, created_at)
    VALUES (@id, @question_text, @sql_template, @created_at)
  `);

  const existing = db.prepare(`SELECT COUNT(*) AS c FROM quick_access_questions`).get() as { c: number };
  if (existing.c > 0) return;

  for (const item of items) {
    insert.run({
      id: item.id,
      question_text: item.question,
      sql_template: item.sql.trim(),
      created_at: createdAt
    });
  }
}

function seedEvents(db: any, opts?: { eventCount?: number }) {
  const eventCount = opts?.eventCount ?? 60000;

  const users = makeBaseUsers();
  const checkerGroups = [
    { id: "G-CHK-01", name: "Checker Group A" },
    { id: "G-CHK-02", name: "Checker Group B" },
    { id: "G-CHK-03", name: "Checker Group C" }
  ];
  const resources = ["High_Net_Worth_Widget", "Regulatory_Dashboard_Widget", "Risk_Scoring_Widget"];

  const eventNames = [
    "create_custom_role",
    "approve_maker_draft",
    "submit_maker_draft",
    "search_user_profile",
    "initiate_screening",
    "revert_transaction",
    "bulk_upload_submit",
    "generate_report",
    "request_elevated_access",
    "create_data_filter_group",
    "disable_system_role",
    "fetch_access_logs",
    "search_ringfenced_txns",
    "search_dispute_intents",
    "update_monitoring_scenario",
    "filter_evaluation_cases",
    "assign_user_group",
    "upload_bulk_screening",
    "submit_widget_update"
  ];

  const seedStartDays = 65;
  const now = new Date();
  const start = addDays(now, -seedStartDays);

  // Pre-generate maker drafts so we can create realistic joins for wait-time computation.
  const makerUsers = users.operatorIds;
  const adminUsers = [...users.generalAdminIds, ...users.superAdminIds];
  const draftCount = Math.max(900, Math.floor(eventCount * 0.03));

  const draftIds = Array.from({ length: draftCount }, () => makeDraftId());
  const draftToMaker = new Map<string, string>();
  for (const draftId of draftIds) draftToMaker.set(draftId, choice(makerUsers));

  let nextEventNum = 1042;
  const genEventId = () => {
    const id = `EVT-${nextEventNum}`;
    nextEventNum += 1;
    return id;
  };

  const insert = db.prepare(`
    INSERT INTO events (
      event_id,
      event_name,
      timestamp_ist,
      user_id,
      user_role,
      context_object,
      properties_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const randomTimestamp = () => {
    const spanMs = now.getTime() - start.getTime();
    const t = start.getTime() + Math.random() * spanMs;
    return new Date(t);
  };

  const makeEventRow = (p: {
    event_name: string;
    timestamp: Date;
    user_id: string;
    user_role: UserRole;
    properties: Record<string, unknown>;
  }) => {
    return {
      event_id: genEventId(),
      event_name: p.event_name,
      timestamp_ist: toISTString(p.timestamp),
      user_id: p.user_id,
      user_role: p.user_role,
      context_object: makeDeviceContext(),
      properties_json: JSON.stringify(p.properties)
    };
  };

  const rows: any[] = [];

  // Maker submissions + admin approvals (for average wait-time, checker group approvals).
  for (const draftId of draftIds) {
    const makerUserId = draftToMaker.get(draftId)!;
    const makerRole: UserRole = "Portal Operator";
    const checkerGroup = choice(checkerGroups);
    const adminUser = choice(adminUsers);
    const adminRole: UserRole = adminUser.startsWith("U-991A") || adminUser.startsWith("U-990A") ? "Super Admin" : "General Admin";

    const submitTs = randomTimestamp();
    const waitHours = randInt(1, 72) + Math.random();
    const approveTs = new Date(submitTs.getTime() + waitHours * 60 * 60 * 1000);

    rows.push(
      makeEventRow({
        event_name: "submit_maker_draft",
        timestamp: submitTs,
        user_id: makerUserId,
        user_role: makerRole,
        properties: {
          draft_id: draftId,
          maker_user_id: makerUserId
        }
      })
    );
    rows.push(
      makeEventRow({
        event_name: "approve_maker_draft",
        timestamp: approveTs,
        user_id: adminUser,
        user_role: adminRole,
        properties: {
          draft_id: draftId,
          maker_user_id: makerUserId,
          signature_valid: choice([true, true, false]),
          action_taken: "APPROVED",
          checker_group_id: checkerGroup.id,
          checker_group_name: checkerGroup.name
        }
      })
    );
  }

  // Elevated access request lifecycle for pending-queue metric.
  const elevatedCount = Math.max(250, Math.floor(eventCount * 0.01));
  const elevatedRequestIds = Array.from({ length: elevatedCount }, () => uuidLike("REQ"));
  for (const requestId of elevatedRequestIds) {
    const operatorUser = choice(makerUsers);
    const pendingTs = randomTimestamp();
    const adminUser = choice(adminUsers);
    const adminRole: UserRole = adminUser.startsWith("U-991A") ? "Super Admin" : "General Admin";
    const resource = choice(resources);
    const access_type = choice(["WRITE_LIMITED", "WRITE_LIMITED", "READ_ONLY"]);
    const queue_name = "Pending queue";

    rows.push(
      makeEventRow({
        event_name: "request_elevated_access",
        timestamp: pendingTs,
        user_id: operatorUser,
        user_role: "Portal Operator",
        properties: {
          elevated_access_request_id: requestId,
          target_resource: resource,
          access_type,
          status: "PENDING_SUPERIOR_APPROVAL"
        }
      })
    );

    // For some requests, approve; for others, reject; but keep some pending-only
    const fate = choice(["APPROVE", "REJECT", "STAY_PENDING"] as const);
    if (fate !== "STAY_PENDING") {
      const decisionTs = new Date(pendingTs.getTime() + randInt(2, 48) * 60 * 60 * 1000);
      rows.push(
        makeEventRow({
          event_name: fate === "APPROVE" ? "approve_elevated_access" : "reject_elevated_access",
          timestamp: decisionTs,
          user_id: adminUser,
          user_role: adminRole,
          properties: {
            elevated_access_request_id: requestId,
            status: fate === "APPROVE" ? "APPROVED" : "REJECTED",
            queue_name
          }
        })
      );
    }
  }

  // Rest of random events to drive "most action", bulk upload peak hour, onboarding this month, etc.
  const otherCount = Math.max(0, eventCount - rows.length);
  for (let i = 0; i < otherCount; i++) {
    const ts = randomTimestamp();
    const event_name = choice(eventNames);

    let user_id: string;
    let user_role: UserRole;
    if (event_name === "create_custom_role" || event_name === "generate_report" || event_name === "disable_system_role") {
      user_id = choice([...users.generalAdminIds, ...users.superAdminIds]);
      user_role = user_id.startsWith("U-991A") || user_id.startsWith("U-990A") ? "Super Admin" : "General Admin";
    } else if (event_name === "approve_maker_draft") {
      user_id = choice(adminUsers);
      user_role = user_id.startsWith("U-991A") ? "Super Admin" : "General Admin";
    } else if (event_name.startsWith("submit_") || event_name.startsWith("bulk_") || event_name.startsWith("upload_")) {
      user_id = choice(makerUsers);
      user_role = "Portal Operator";
    } else if (event_name.includes("search") || event_name.includes("fetch") || event_name.includes("initiate_screening") || event_name.includes("filter")) {
      user_id = choice(makerUsers);
      user_role = "Portal Operator";
    } else {
      user_id = choice([...users.generalAdminIds, ...users.superAdminIds, ...makerUsers]);
      user_role = USER_ROLES[users.superAdminIds.includes(user_id) ? 0 : users.generalAdminIds.includes(user_id) ? 1 : 2] as UserRole;
    }

    const contextFor = makeDeviceContext();

    // Populate properties per event_name so the analytics queries can extract JSON fields.
    const properties: Record<string, unknown> = {};
    if (event_name === "create_custom_role") {
      properties.role_name = choice(["Senior Compliance", "Risk Reviewer", "Operations Admin"]);
      properties.permissions = choice([
        ["read_restricted", "write_limited"],
        ["read_limited", "write_limited"],
        ["read_restricted"]
      ]);
      properties.operator_count_impact = randInt(0, 12);
    } else if (event_name === "submit_maker_draft") {
      const draft_id = choice(draftIds);
      properties.draft_id = draft_id;
      properties.maker_user_id = draftToMaker.get(draft_id) ?? user_id;
    } else if (event_name === "approve_maker_draft") {
      const draft_id = choice(draftIds);
      const checkerGroup = choice(checkerGroups);
      properties.draft_id = draft_id;
      properties.maker_user_id = draftToMaker.get(draft_id) ?? user_id;
      properties.signature_valid = choice([true, true, false]);
      properties.action_taken = "APPROVED";
      properties.checker_group_id = checkerGroup.id;
      properties.checker_group_name = checkerGroup.name;
    } else if (event_name === "initiate_screening") {
      properties.reference_id = `REF-${randInt(1000, 9999)}`;
      properties.field_screened = choice(["DOB", "Passport", "Name", "Address"]);
      properties.screening_category = choice(["ONBOARDING_INDIVIDUAL", "ONBOARDING_CORPORATE", "TRANSACTION_MONITORING"]);
    } else if (event_name === "filter_evaluation_cases") {
      properties.assignment_status = choice(["UNASSIGNED", "ASSIGNED"]);
      properties.case_status = choice(["PENDING_REVIEW", "IN_PROGRESS", "COMPLETED"]);
      properties.custom_filter_applied = choice([true, false]);
    } else if (event_name === "bulk_upload_submit") {
      properties.request_type = "BULK_NOTIFICATION";
      properties.file_name = choice(["april_notifs_v2.csv", "customer_update_batch.csv", "bulk_notifications_q2.csv"]);
      properties.row_count = randInt(150, 1200);
      properties.template_valid = choice([true, true, false]);
    } else if (event_name === "upload_bulk_screening") {
      properties.file_name = choice(["q2_screening_batch.xlsx", "screening_batch_march.xlsx", "bulk_screening_may.xlsx"]);
      properties.record_count = randInt(50, 1000);
      properties.template_version = choice(["1.4", "1.5", "1.3"]);
      properties.upload_method = choice(["drag_and_drop", "file_picker"]);
    } else if (event_name === "request_elevated_access") {
      const requestId = choice(elevatedRequestIds);
      properties.elevated_access_request_id = requestId;
      properties.target_resource = choice(resources);
      properties.access_type = choice(["WRITE_LIMITED", "READ_ONLY"]);
      properties.status = "PENDING_SUPERIOR_APPROVAL";
    } else if (event_name === "approve_elevated_access") {
      const requestId = choice(elevatedRequestIds);
      properties.elevated_access_request_id = requestId;
      properties.status = "APPROVED";
    } else if (event_name === "reject_elevated_access") {
      const requestId = choice(elevatedRequestIds);
      properties.elevated_access_request_id = requestId;
      properties.status = "REJECTED";
    } else if (event_name === "assign_user_group") {
      properties.target_user_id = choice([...makerUsers, ...users.generalAdminIds]);
      properties.group_id = choice(["G-CHK-01", "G-OPS-01", "G-RPT-01"]);
      properties.group_type = choice(["CHECKER_GROUP", "OPS_GROUP", "REPORT_GROUP"]);
    } else if (event_name === "submit_widget_update") {
      properties.widget_id = choice(["W-CUST-PROFILE", "W-RISK-SCORES", "W-HNWI-DASH"]);
      properties.fields_modified = choice([
        ["phone_number", "address_line_2"],
        ["email", "address_line_1"],
        ["risk_band", "notes"]
      ]);
      properties.concurrent_modifications_detected = choice([false, true]);
    } else if (event_name === "search_user_profile") {
      properties.filter_on = choice(["email", "customer_id", "phone"]);
      properties.filter_value_hash = Math.random().toString(16).slice(2, 10);
      properties.profile_status = choice(["ACTIVE", "SUSPENDED"]);
      properties.records_returned = randInt(0, 20);
    } else {
      // Keep other event properties minimal.
      properties.misc = `v${randInt(1, 20)}.${randInt(0, 99)}`;
    }

    rows.push({
      event_id: genEventId(),
      event_name,
      timestamp_ist: toISTString(ts),
      user_id,
      user_role,
      context_object: contextFor,
      properties_json: JSON.stringify(properties)
    });
  }

  const tx = db.transaction((insertRows: any[]) => {
    for (const r of insertRows) {
      insert.run(r.event_id, r.event_name, r.timestamp_ist, r.user_id, r.user_role, r.context_object, r.properties_json);
    }
  });

  tx(rows);
}

type SeedDbOptions = {
  forceRecreate?: boolean;
  eventCount?: number;
};

function getDefaultEventCount() {
  const fromEnv = Number(process.env.SEED_EVENT_COUNT ?? "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  // Vercel/serverless: keep seeding light to avoid timeouts.
  // Keep Vercel cold starts under typical Hobby function time limits (seed + first API work).
  return process.env.VERCEL === "1" ? 800 : 60000;
}

function dbHasRows(dbPath: string, table: string): boolean {
  if (!fs.existsSync(dbPath)) return false;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

export async function seedDbs(opts?: SeedDbOptions) {
  const forceRecreate = opts?.forceRecreate ?? false;
  const eventCount = opts?.eventCount ?? getDefaultEventCount();
  ensureDirExists();

  if (forceRecreate) {
    recreateDb(EVENTS_DB_PATH);
    recreateDb(QUICK_ACCESS_DB_PATH);
    recreateDb(CHAT_DB_PATH);
  }

  const eventsDb = new Database(EVENTS_DB_PATH);
  const quickDb = new Database(QUICK_ACCESS_DB_PATH);
  const chatDb = new Database(CHAT_DB_PATH);

  initEventsSchema(eventsDb);
  initQuickAccessSchema(quickDb);
  initChatSchema(chatDb);

  seedQuickAccess(quickDb);
  if (!dbHasRows(EVENTS_DB_PATH, "events")) {
    seedEvents(eventsDb, { eventCount });
  }

  // Insert a default conversation only once.
  const existingConv = chatDb.prepare(`SELECT COUNT(*) AS c FROM conversations`).get() as { c: number };
  if ((existingConv?.c ?? 0) === 0) {
    const conversationId = `conv-${Date.now()}`;
    const createdAt = isoNowIstString();
    chatDb.prepare(`INSERT INTO conversations (conversation_id, title, created_at) VALUES (?, ?, ?)`).run(conversationId, "Analytics Prototype", createdAt);
  }

  // Close DBs
  eventsDb.close();
  quickDb.close();
  chatDb.close();
}


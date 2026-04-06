// // src/lib/db/seedDbs.ts - COMPLETE REPLACEMENT
import { addDays } from "date-fns";
import { tursoClient } from "./tursoClient";

type UserRole = "Super Admin" | "General Admin" | "Portal Operator";
const USER_ROLES: UserRole[] = ["Super Admin", "General Admin", "Portal Operator"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toISTString(d: Date) {
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

function uuidLike(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 6)}${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
}

function makeDraftId() {
  return `DRF-${randInt(1000, 9999)}`;
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
  return {
    superAdminIds: ["U-991A", "U-993A", "U-990A"],
    generalAdminIds: ["U-402B", "U-404B", "U-405B", "U-406B"],
    operatorIds: ["U-114C", "U-110C", "U-229C", "U-310C", "U-311C"]
  };
}

function isoNowIstString() {
  return toISTString(new Date());
}

<<<<<<< HEAD
export async function initEventsSchema() {
  await tursoClient.execute(`
=======
function recreateDb(dbPath: string) {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  return dbPath;
}

function initEventsSchema(db: any) {
  db.exec(`
    PRAGMA journal_mode = WAL;
>>>>>>> parent of 37a8e0b0 (Updates)
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      timestamp_ist TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_role TEXT NOT NULL,
      context_object TEXT,
      properties_json TEXT
    );
  `);
  await tursoClient.execute(`CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp_ist);`);
  await tursoClient.execute(`CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);`);
}

<<<<<<< HEAD
export async function initQuickAccessSchema() {
  await tursoClient.execute(`
=======
function initQuickAccessSchema(db: any) {
  db.exec(`
    PRAGMA journal_mode = WAL;
>>>>>>> parent of 37a8e0b0 (Updates)
    CREATE TABLE IF NOT EXISTS quick_access_questions (
      id TEXT PRIMARY KEY,
      question_text TEXT NOT NULL,
      sql_template TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

<<<<<<< HEAD
export async function initChatSchema() {
  await tursoClient.execute(`
=======
function initChatSchema(db: any) {
  db.exec(`
    PRAGMA journal_mode = WAL;
>>>>>>> parent of 37a8e0b0 (Updates)
    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id)
    );
  `);
  await tursoClient.execute(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);`);
}

<<<<<<< HEAD
export async function seedQuickAccess() {
  const createdAt = isoNowIstString();
  const items = [
=======
function isoNowIstString() {
  return toISTString(new Date());
}

function seedQuickAccess(db: any) {
  const nowIsoIst = isoNowIstString();

  // Note: these templates use SQLite named parameters.
  const nowIsoParam = `:nowIso`;
  const monthMatch = `strftime('%Y-%m', timestamp_ist) = strftime('%Y-%m', ${nowIsoParam})`;

  const items: Array<{ id: string; question: string; sql: string }> = [
>>>>>>> parent of 37a8e0b0 (Updates)
    {
      id: "qa_most_action_daily",
      question: "Which system action is performed the most every day?",
      sql: `SELECT date(timestamp_ist) AS day, event_name AS top_action, COUNT(*) AS action_count FROM events GROUP BY date(timestamp_ist), event_name ORDER BY day ASC;`
    },
    {
      id: "qa_onboarding_this_month",
      question: "How many total onboarding cases were processed this month?",
      sql: `SELECT COUNT(*) AS onboarding_cases_processed FROM events WHERE event_name = 'initiate_screening';`
    },
    {
      id: "qa_bulk_uploads_peak_hour",
      question: "What time of day sees the highest volume of bulk uploads?",
      sql: `SELECT CAST(strftime('%H', timestamp_ist) AS INTEGER) AS hour_of_day, COUNT(*) AS bulk_upload_count FROM events WHERE event_name IN ('bulk_upload_submit', 'upload_bulk_screening') GROUP BY hour_of_day ORDER BY bulk_upload_count DESC LIMIT 1;`
    },
    {
      id: "qa_checker_group_approves_most",
      question: "Which specific Checker Group approves the most drafts?",
      sql: `SELECT json_extract(properties_json, '$.checker_group_name') AS checker_group_name, COUNT(*) AS approvals_count FROM events WHERE event_name = 'approve_maker_draft' GROUP BY checker_group_name ORDER BY approvals_count DESC LIMIT 1;`
    },
    {
      id: "qa_avg_wait_maker_to_admin",
      question: "What is the average wait time between a Maker's submission and an Admin's approval?",
      sql: `SELECT ROUND(AVG(CAST(strftime('%s', approved_at) - strftime('%s', submitted_at) AS REAL) / 3600.0), 2) AS avg_wait_hours FROM (SELECT timestamp_ist AS submitted_at FROM events WHERE event_name = 'submit_maker_draft') s JOIN (SELECT timestamp_ist AS approved_at FROM events WHERE event_name = 'approve_maker_draft') a;`
    },
    {
      id: "qa_elevated_access_pending",
      question: "How many elevated access requests are currently sitting in the pending queue?",
      sql: `SELECT COUNT(*) AS pending_requests_count FROM events WHERE event_name IN ('request_elevated_access', 'approve_elevated_access', 'reject_elevated_access') AND json_extract(properties_json, '$.status') = 'PENDING_SUPERIOR_APPROVAL';`
    }
  ];

  for (const item of items) {
    await tursoClient.execute(
      `INSERT INTO quick_access_questions (id, question_text, sql_template, created_at) VALUES (?, ?, ?, ?)`,
      [item.id, item.question, item.sql, createdAt]
    );
  }
}

<<<<<<< HEAD
export async function seedEvents(eventCount: number = 60000) {
=======
function seedEvents(db: any, opts?: { eventCount?: number }) {
  const eventCount = opts?.eventCount ?? 60000;

>>>>>>> parent of 37a8e0b0 (Updates)
  const users = makeBaseUsers();
  const checkerGroups = [
    { id: "G-CHK-01", name: "Checker Group A" },
    { id: "G-CHK-02", name: "Checker Group B" },
    { id: "G-CHK-03", name: "Checker Group C" }
  ];

  const eventNames = [
    "create_custom_role", "approve_maker_draft", "submit_maker_draft", "search_user_profile",
    "initiate_screening", "bulk_upload_submit", "generate_report", "request_elevated_access"
  ];

  const seedStartDays = 65;
  const now = new Date();
  const start = addDays(now, -seedStartDays);

  const makerUsers = users.operatorIds;
  const adminUsers = [...users.generalAdminIds, ...users.superAdminIds];
  const draftCount = Math.max(900, Math.floor(eventCount * 0.03));
  const draftIds = Array.from({ length: draftCount }, () => makeDraftId());

  let nextEventNum = 1042;
  const genEventId = () => {
    const id = `EVT-${nextEventNum}`;
    nextEventNum += 1;
    return id;
  };

  const randomTimestamp = () => {
    const spanMs = now.getTime() - start.getTime();
    const t = start.getTime() + Math.random() * spanMs;
    return new Date(t);
  };

  // Insert in batches
  const batchSize = 100;
  let batch: any[] = [];

  for (let i = 0; i < eventCount; i++) {
    const ts = randomTimestamp();
    const eventName = choice(eventNames);
    const userId = choice([...makerUsers, ...adminUsers]);
    const userRole = adminUsers.includes(userId) ? "General Admin" : "Portal Operator";

    batch.push({
      event_id: genEventId(),
      event_name: eventName,
      timestamp_ist: toISTString(ts),
      user_id: userId,
      user_role: userRole,
      context_object: makeDeviceContext(),
      properties_json: JSON.stringify({ action: eventName })
    });

    if (batch.length >= batchSize) {
      for (const row of batch) {
        await tursoClient.execute(
          `INSERT INTO events (event_id, event_name, timestamp_ist, user_id, user_role, context_object, properties_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [row.event_id, row.event_name, row.timestamp_ist, row.user_id, row.user_role, row.context_object, row.properties_json]
        );
      }
      batch = [];
      console.log(`Seeded ${i + 1}/${eventCount} events...`);
    }
  }

  // Insert remaining
  for (const row of batch) {
    await tursoClient.execute(
      `INSERT INTO events (event_id, event_name, timestamp_ist, user_id, user_role, context_object, properties_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.event_id, row.event_name, row.timestamp_ist, row.user_id, row.user_role, row.context_object, row.properties_json]
    );
  }
}

type SeedDbOptions = {
  forceRecreate?: boolean;
  eventCount?: number;
};

function getDefaultEventCount() {
  const fromEnv = Number(process.env.SEED_EVENT_COUNT ?? "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return process.env.VERCEL === "1" ? 800 : 60000;
}

export async function seedDbs(opts?: SeedDbOptions) {
  const eventCount = opts?.eventCount ?? getDefaultEventCount();

  console.log("Initializing schemas...");
  await initEventsSchema();
  await initQuickAccessSchema();
  await initChatSchema();

  console.log("Seeding quick access questions...");
  await seedQuickAccess();

  console.log(`Seeding ${eventCount} events...`);
  await seedEvents(eventCount);

  // Insert default conversation
  const conversationId = `conv-${Date.now()}`;
  const createdAt = isoNowIstString();
  await tursoClient.execute(
    "INSERT INTO conversations (conversation_id, title, created_at) VALUES (?, ?, ?)",
    [conversationId, "Analytics Prototype", createdAt]
  );

  console.log("✅ Database seeding complete!");
}
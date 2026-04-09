import path from "path";

// Local dev: keep DBs under project ./data
// Vercel/serverless: write into /tmp (writable at runtime, but ephemeral)
const isVercel = process.env.VERCEL === "1";
const dbBaseDir = process.env.DB_DIR || (isVercel ? "/tmp/analytics-chat-data" : path.join(process.cwd(), "data"));

export const DB_DIR = dbBaseDir;

export const EVENTS_DB_PATH = path.join(DB_DIR, "analytics_events.sqlite");
export const QUICK_ACCESS_DB_PATH = path.join(DB_DIR, "analytics_quick_access.sqlite");
export const CHAT_DB_PATH = path.join(DB_DIR, "analytics_chat.sqlite");
export const DASHBOARD_DB_PATH = path.join(DB_DIR, "analytics_dashboard.sqlite");


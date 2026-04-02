import path from "path";

export const DB_DIR = path.join(process.cwd(), "data");

export const EVENTS_DB_PATH = path.join(DB_DIR, "analytics_events.sqlite");
export const QUICK_ACCESS_DB_PATH = path.join(DB_DIR, "analytics_quick_access.sqlite");
export const CHAT_DB_PATH = path.join(DB_DIR, "analytics_chat.sqlite");


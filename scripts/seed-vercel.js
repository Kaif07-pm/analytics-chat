#!/usr/bin/env node
/**
 * Push local events from analytics_events.sqlite to a remote /api/events/ingest endpoint.
 *
 * Usage:
 *   node scripts/seed-vercel.js
 *
 * Env (optional):
 *   SQLITE_PATH   - default: <cwd>/data/analytics_events.sqlite
 *   INGEST_URL    - default: https://analytics-chat-delta.vercel.app/api/events/ingest
 *   BATCH_SIZE    - events per POST (default: 500)
 *
 * Requires Node 18+ (global fetch).
 */

const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_SQLITE = path.join(process.cwd(), "data", "analytics_events.sqlite");
const DEFAULT_INGEST_URL = "https://analytics-chat-delta.vercel.app/api/events/ingest";
const DEFAULT_BATCH = 500;

function toEventPayload(row) {
  const event_id = row.event_id != null ? String(row.event_id) : "";
  const event_name = row.event_name != null ? String(row.event_name) : "";
  const timestamp_ist = row.timestamp_ist != null ? String(row.timestamp_ist) : "";
  const user_id = row.user_id != null ? String(row.user_id) : "";
  const user_role = row.user_role != null ? String(row.user_role) : "";

  const ev = {
    event_id,
    event_name,
    timestamp_ist,
    user_id,
    user_role
  };

  if (row.context_object != null && row.context_object !== "") {
    ev.context_object = String(row.context_object);
  }

  if (row.properties_json != null && row.properties_json !== "") {
    const p = row.properties_json;
    ev.properties_json = typeof p === "string" ? p : JSON.stringify(p);
  }

  return ev;
}

function isComplete(ev) {
  return !!(ev.event_id && ev.event_name && ev.timestamp_ist && ev.user_id && ev.user_role);
}

async function main() {
  const sqlitePath = process.env.SQLITE_PATH || DEFAULT_SQLITE;
  const ingestUrl = process.env.INGEST_URL || DEFAULT_INGEST_URL;
  const batchSize = Math.max(1, Number(process.env.BATCH_SIZE || DEFAULT_BATCH));

  const db = new Database(sqlitePath, { readonly: true });
  let rows;
  try {
    rows = db
      .prepare(
        `SELECT event_id, event_name, timestamp_ist, user_id, user_role, context_object, properties_json
         FROM events`
      )
      .all();
  } finally {
    db.close();
  }

  console.log(`Read ${rows.length} row(s) from:\n  ${sqlitePath}`);
  console.log(`Target:\n  ${ingestUrl}`);
  console.log(`Batch size: ${batchSize}\n`);

  let posted = 0;
  let skipped = 0;
  let sumInserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const events = [];
    for (const row of slice) {
      const ev = toEventPayload(row);
      if (!isComplete(ev)) {
        skipped += 1;
        console.warn("Skipping row missing required fields:", {
          event_id: ev.event_id,
          event_name: ev.event_name,
          timestamp_ist: ev.timestamp_ist,
          user_id: ev.user_id,
          user_role: ev.user_role
        });
        continue;
      }
      events.push(ev);
    }

    if (events.length === 0) continue;

    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events })
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      console.error(`HTTP ${res.status} for batch starting at index ${i}`);
      console.error(json);
      process.exit(1);
    }

    posted += events.length;
    if (typeof json.inserted === "number") sumInserted += json.inserted;
    console.log(
      `OK batch ${Math.floor(i / batchSize) + 1}: sent ${events.length} (progress ${posted}/${rows.length}); response inserted=${json.inserted ?? "?"}, attempted=${json.attempted ?? "?"}`
    );
  }

  console.log("\nFinished.");
  console.log(`  Rows read:       ${rows.length}`);
  console.log(`  Rows skipped:    ${skipped}`);
  console.log(`  Events posted:   ${posted}`);
  console.log(`  Inserted (sum):  ${sumInserted} (INSERT OR IGNORE skips duplicates)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

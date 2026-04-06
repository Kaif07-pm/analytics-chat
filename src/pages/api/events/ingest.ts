import type { NextApiRequest, NextApiResponse } from "next";
import Database from "better-sqlite3";
import { EVENTS_DB_PATH } from "@/lib/db/paths";
import { ensureEventsDb } from "@/lib/db/eventsDb";

type IngestEvent = {
  event_id: string;
  event_name: string;
  timestamp_ist: string;
  user_id: string;
  user_role: string;
  context_object?: string | null;
  properties_json?: unknown;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body as { events?: IngestEvent[]; event?: IngestEvent };
    const events = (body.events ?? (body.event ? [body.event] : [])) as IngestEvent[];

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: "Missing events. Send { events: [...] } or { event: {...} }" });
    }

    for (const e of events) {
      if (!e?.event_id || !e?.event_name || !e?.timestamp_ist || !e?.user_id || !e?.user_role) {
        return res.status(400).json({
          error: "Each event must include: event_id, event_name, timestamp_ist, user_id, user_role"
        });
      }
    }

    await ensureEventsDb();

    const db = new Database(EVENTS_DB_PATH);
    try {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO events (
          event_id,
          event_name,
          timestamp_ist,
          user_id,
          user_role,
          context_object,
          properties_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const tx = db.transaction((rows: IngestEvent[]) => {
        let attempted = 0;
        let inserted = 0;
        for (const e of rows) {
          attempted += 1;
          const context_object = e.context_object ?? null;
          const properties_json =
            e.properties_json === undefined || e.properties_json === null
              ? null
              : typeof e.properties_json === "string"
                ? e.properties_json
                : JSON.stringify(e.properties_json);

          const info = insert.run(
            e.event_id,
            e.event_name,
            e.timestamp_ist,
            e.user_id,
            e.user_role,
            context_object,
            properties_json
          );

          // better-sqlite3 doesn't expose inserted row count for OR IGNORE reliably,
          // but changes > 0 means it was inserted.
          inserted += (info.changes ?? 0) > 0 ? 1 : 0;
        }
        return { attempted, inserted };
      });

      const { attempted, inserted } = tx(events);
      return res.status(200).json({ ok: true, attempted, inserted });
    } finally {
      db.close();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/events/ingest]", err);
    return res.status(500).json({ error: "Failed to ingest events", detail: message });
  }
}


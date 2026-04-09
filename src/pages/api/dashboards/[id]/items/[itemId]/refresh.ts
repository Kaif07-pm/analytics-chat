import type { NextApiRequest, NextApiResponse } from "next";
import { getDashboardItem } from "@/lib/db/dashboardDb";
import { runEventsSql } from "@/lib/db/eventsDb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { itemId } = req.query;

  if (req.method === "POST") {
    try {
      const item = await getDashboardItem(itemId as string);
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      if (!item.sql_query) {
        return res.status(400).json({ error: "Item has no SQL query" });
      }

      const resultJson = await runEventsSql(item.sql_query);
      return res.status(200).json({ resultJson });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to refresh dashboard item" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

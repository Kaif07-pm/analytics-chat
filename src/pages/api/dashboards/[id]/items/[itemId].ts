import type { NextApiRequest, NextApiResponse } from "next";
import { removeDashboardItem, updateDashboardItemInterval } from "@/lib/db/dashboardDb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { itemId } = req.query;

  if (req.method === "DELETE") {
    try {
      await removeDashboardItem(itemId as string);
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to delete dashboard item" });
    }
  }

  if (req.method === "PUT") {
    try {
      const { refresh_interval } = req.body;
      if (typeof refresh_interval !== "number") {
        return res.status(400).json({ error: "Missing or invalid refresh_interval" });
      }
      await updateDashboardItemInterval(itemId as string, refresh_interval);
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to update item" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

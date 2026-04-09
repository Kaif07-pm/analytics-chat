import type { NextApiRequest, NextApiResponse } from "next";
import { updateDashboardItemLayout } from "@/lib/db/dashboardDb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { itemId } = req.query;

  if (req.method === "PUT") {
    try {
      const { x, y, w, h } = req.body;
      if (typeof x !== "number" || typeof y !== "number" || typeof w !== "number" || typeof h !== "number") {
        return res.status(400).json({ error: "Missing or invalid layout coordinates (x, y, w, h)" });
      }
      await updateDashboardItemLayout(itemId as string, { x, y, w, h });
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to update layout" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

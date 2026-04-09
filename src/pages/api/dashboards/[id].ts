import type { NextApiRequest, NextApiResponse } from "next";
import { getDashboard, listDashboardItems } from "@/lib/db/dashboardDb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (req.method === "GET") {
    try {
      const dashboard = await getDashboard(id as string);
      if (!dashboard) {
        return res.status(404).json({ error: "Dashboard not found" });
      }
      const items = await listDashboardItems(id as string);
      return res.status(200).json({ dashboard, items });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to fetch dashboard" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

import type { NextApiRequest, NextApiResponse } from "next";
import { listDashboards, createDashboard } from "@/lib/db/dashboardDb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const dashboards = await listDashboards();
      return res.status(200).json({ dashboards });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to list dashboards" });
    }
  }

  if (req.method === "POST") {
    try {
      const { title } = req.body;
      if (!title) {
        return res.status(400).json({ error: "Missing title" });
      }
      const dashboard = await createDashboard(title);
      return res.status(200).json({ dashboard });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to create dashboard" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

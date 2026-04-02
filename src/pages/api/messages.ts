import type { NextApiRequest, NextApiResponse } from "next";
import { listMessages } from "@/lib/db/chatDb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const conversationId = String(req.query.conversationId ?? "");
  if (!conversationId) return res.status(400).json({ error: "Missing conversationId" });
  const messages = await listMessages(conversationId);
  res.status(200).json({ messages });
}


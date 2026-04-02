import type { NextApiRequest, NextApiResponse } from "next";
import { listQuickQuestions } from "@/lib/db/quickAccessDb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const items = await listQuickQuestions();
  res.status(200).json({
    questions: items.map((q) => ({ id: q.id, question_text: q.question_text, sql_template: q.sql_template }))
  });
}


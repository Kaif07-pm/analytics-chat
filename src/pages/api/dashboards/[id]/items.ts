import type { NextApiRequest, NextApiResponse } from "next";
import { addDashboardItem } from "@/lib/db/dashboardDb";
import { generateSqlFromNaturalLanguage } from "@/lib/ai/sqlGenerator";
import { runEventsSql } from "@/lib/db/eventsDb";
import { autoPickChart } from "@/lib/chart/chartPicker";
import { buildGeminiInterpretation } from "@/lib/ai/geminiInterpretation";
import { shouldUseGeminiInterpretation } from "@/lib/ai/geminiEnv";
import { buildInterpretation } from "@/lib/ai/interpretation";
import { getQuickQuestionById } from "@/lib/db/quickAccessDb";

function nowIsoIstParam() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 19).replace("T", " ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (req.method === "POST") {
    try {
      const { question } = req.body;
      if (!question) {
        return res.status(400).json({ error: "Missing question" });
      }

      // First try to see if it perfectly matches a quick question text to reuse its template
      let sql: string | null = null;
      let params: Record<string, unknown> = {};

      const sqlGen = await generateSqlFromNaturalLanguage({ question });

      if (sqlGen.kind === "needs_clarification") {
        return res.status(400).json({ error: sqlGen.clarification.message });
      } else if (sqlGen.kind === "out_of_scope") {
        return res.status(400).json({ error: sqlGen.message });
      } else {
        sql = sqlGen.sql;
        params = sqlGen.params || {};
      }

      const resultJson = await runEventsSql(sql, params);
      const chartModel = autoPickChart(resultJson);
      
      let interpretation = "";
      const geminiText = shouldUseGeminiInterpretation()
        ? await buildGeminiInterpretation({ question, sql, resultJson, chartModel, previousInterpretation: null })
        : null;

      if (geminiText) {
        interpretation = geminiText;
      } else {
        interpretation = buildInterpretation({ question, sqlGen, sql, result: resultJson });
      }

      const item = await addDashboardItem({
        dashboardId: id as string,
        question,
        sqlQuery: sql,
        interpretation,
        chartModelJson: chartModel,
      });

      return res.status(200).json({ item, resultJson });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to add dashboard item" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

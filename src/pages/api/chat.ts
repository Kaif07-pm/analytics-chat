import type { NextApiRequest, NextApiResponse } from "next";
import { ensureConversation, storeMessage, updateMessageContent, deleteMessagesAfterMessage } from "@/lib/db/chatDb";
import { runEventsSql } from "@/lib/db/eventsDb";
import { getQuickQuestionById } from "@/lib/db/quickAccessDb";
import { generateSqlFromNaturalLanguage } from "@/lib/ai/sqlGenerator";
import { buildInterpretation } from "@/lib/ai/interpretation";
import { autoPickChart, type ChartModel } from "@/lib/chart/chartPicker";
import { buildGeminiInterpretation, buildGeminiCrossAnswer } from "@/lib/ai/geminiInterpretation";
import { shouldUseGeminiInterpretation } from "@/lib/ai/geminiEnv";

type ChatMode = "chat" | "quick_access" | "cross";

export const config = {
  // Helps on platforms that support configurable serverless duration (e.g. Vercel).
  maxDuration: 60
};

function nowIsoIstParam() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 19).replace("T", " ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    return await handleChatPost(req, res);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/chat]", err);
    return res.status(500).json({
      error: "Chat request failed. Check Vercel function logs and GEMINI_API_KEY / timeouts.",
      detail: process.env.NODE_ENV === "development" ? message : undefined
    });
  }
}

async function handleChatPost(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body as {
    conversationId?: string;
    message: string;
    mode?: ChatMode;
    quickQuestionId?: string;
    lastContext?: any;
    replaceUserMessageId?: string;
  };

  const mode: ChatMode = body.mode ?? "chat";
  const message = body.message?.trim();
  if (!message) return res.status(400).json({ error: "Missing message" });

  const conversation = await ensureConversation(body.conversationId);

  const replaceUserMessageId = body.replaceUserMessageId;
  if (replaceUserMessageId && mode !== "quick_access") {
    // Edit behavior: replace the existing user message, delete all messages after it,
    // then regenerate the assistant output (in the same conversation).
    await updateMessageContent({
      conversationId: conversation.conversation_id,
      messageId: replaceUserMessageId,
      content: message
    });
    await deleteMessagesAfterMessage({
      conversationId: conversation.conversation_id,
      messageId: replaceUserMessageId
    });
  } else {
    await storeMessage({
      conversationId: conversation.conversation_id,
      role: "user",
      content: message,
      payload: null
    });
  }

  // Resolve SQL + result.
  let sql: string | null = null;
  let resultJson: any | null = null;
  let chartModel: ChartModel | null = null;
  let interpretation = "";

  if (mode === "quick_access") {
    const qid = body.quickQuestionId;
    if (!qid) {
      interpretation = "Quick access question id missing.";
    } else {
      const quick = await getQuickQuestionById(qid);
      if (!quick) {
        interpretation = "I couldn't find that quick access question.";
      } else {
        sql = quick.sql_template;
        resultJson = await runEventsSql(sql, { nowIso: nowIsoIstParam() });
        chartModel = autoPickChart(resultJson);
        const geminiText = shouldUseGeminiInterpretation()
          ? await buildGeminiInterpretation({
              question: quick.question_text,
              sql,
              resultJson,
              chartModel,
              previousInterpretation: null
            })
          : null;
        if (geminiText) {
          interpretation = geminiText;
        } else {
          const intentByQuickId: Record<string, any> = {
            qa_most_action_daily: "MOST_ACTION_DAILY",
            qa_onboarding_this_month: "ONBOARDING_THIS_MONTH",
            qa_bulk_uploads_peak_hour: "BULK_UPLOADS_PEAK_HOUR",
            qa_checker_group_approves_most: "CHECKER_GROUP_APPROVES_MOST",
            qa_avg_wait_maker_to_admin: "AVG_WAIT_MAKER_TO_ADMIN",
            qa_elevated_access_pending: "ELEVATED_ACCESS_PENDING_QUEUE"
          };
          const intent = intentByQuickId[qid];
          interpretation = buildInterpretation({
            question: quick.question_text,
            sqlGen: intent ? ({ kind: "ok", intent } as any) : ({ kind: "out_of_scope", message: "Quick access mapping missing" } as any),
            sql,
            result: resultJson
          });
        }
      }
    }
  } else {
    // For cross-question mode, try Gemini interpretation using the previous result as context
    if (mode === "cross" && body.lastContext?.lastResult && body.lastContext?.lastSql) {
      const lastSql = body.lastContext.lastSql as string;
      const lastResult = body.lastContext.lastResult as any;
      const lastInterpretation = body.lastContext.lastInterpretation as string | null;
      const geminiCross = shouldUseGeminiInterpretation()
        ? await buildGeminiCrossAnswer({
            followUpQuestion: message,
            originalQuestion: body.lastContext.originalQuestion,
            lastSql,
            lastResult,
            lastInterpretation
          })
        : null;
      interpretation = geminiCross ?? `Based on the previous result, here’s the most relevant insight: ${lastInterpretation ?? ""}`.trim();

      // Still store payload-less response for now (prototype).
      await storeMessage({
        conversationId: conversation.conversation_id,
        role: "assistant",
        content: interpretation,
        payload: { sql: lastSql, resultJson: lastResult, chartModel: null }
      });

      res.status(200).json({
        conversationId: conversation.conversation_id,
        assistant: { content: interpretation, payload: { sql: lastSql, resultJson: lastResult, chartModel: null } }
      });
      return;
    }

    const sqlGen = await generateSqlFromNaturalLanguage({
      question: message,
      context: body.lastContext
    });

    if (sqlGen.kind === "needs_clarification") {
      interpretation = sqlGen.clarification.message;
    } else if (sqlGen.kind === "out_of_scope") {
      interpretation = sqlGen.message;
    } else {
      sql = sqlGen.sql;
      resultJson = await runEventsSql(sql, sqlGen.params);
      chartModel = autoPickChart(resultJson);
      const geminiText = shouldUseGeminiInterpretation()
        ? await buildGeminiInterpretation({
            question: message,
            sql,
            resultJson,
            chartModel,
            previousInterpretation: null
          })
        : null;
      if (geminiText) {
        interpretation = geminiText;
      } else {
        interpretation = buildInterpretation({
          question: message,
          sqlGen,
          sql,
          result: resultJson
        });
      }
    }
  }

  const payload = resultJson
    ? {
        sql,
        resultJson,
        chartModel
      }
    : { sql: null, resultJson: null, chartModel: null };

  const assistantContent = [
    interpretation,
    resultJson ? "" : ""
  ].filter(Boolean).join("\n");

  await storeMessage({
    conversationId: conversation.conversation_id,
    role: "assistant",
    content: assistantContent,
    payload
  });

  res.status(200).json({
    conversationId: conversation.conversation_id,
    assistant: {
      content: assistantContent,
      payload
    }
  });
}


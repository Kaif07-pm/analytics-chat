import fs from "fs";
import Database from "better-sqlite3";
import { CHAT_DB_PATH } from "./paths";
import { seedDbs } from "./seedDbs";

export type Conversation = {
  conversation_id: string;
  title: string;
  created_at: string;
};

export type ChatMessage = {
  message_id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  payload_json: any | null;
  created_at: string;
};

async function ensureChatDb() {
  if (fs.existsSync(CHAT_DB_PATH)) return;
  await seedDbs();
}

function uuidLike(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}-${Date.now()}`.toUpperCase();
}

export async function listConversations(limit = 10): Promise<Conversation[]> {
  await ensureChatDb();
  const db = new Database(CHAT_DB_PATH, { readonly: true });
  try {
    const conversations = db
      .prepare(`SELECT conversation_id, title, created_at FROM conversations ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Conversation[];

    return await Promise.all(
      conversations.map(async (c) => {
        const firstUser = db
          .prepare(
            `SELECT content
             FROM messages
             WHERE conversation_id = ?
               AND role = 'user'
             ORDER BY created_at ASC
             LIMIT 1`
          )
          .get(c.conversation_id) as { content: string } | undefined;
        if (!firstUser?.content) return c;
        return { ...c, title: firstUser.content.slice(0, 80) };
      })
    );
  } finally {
    db.close();
  }
}

export async function ensureConversation(conversationId?: string): Promise<Conversation> {
  await ensureChatDb();
  const db = new Database(CHAT_DB_PATH);
  try {
    if (conversationId) {
      const existing = db
        .prepare(`SELECT conversation_id, title, created_at FROM conversations WHERE conversation_id = ?`)
        .get(conversationId) as Conversation | undefined;
      if (existing) return existing;
    }
    const id = conversationId ?? uuidLike("conv").toLowerCase();
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO conversations (conversation_id, title, created_at) VALUES (?, ?, ?)`).run(id, "Analytics Prototype", createdAt);
    return { conversation_id: id, title: "Analytics Prototype", created_at: createdAt };
  } finally {
    db.close();
  }
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  await ensureChatDb();
  const db = new Database(CHAT_DB_PATH, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT message_id, conversation_id, role, content, payload_json, created_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC`
      )
      .all(conversationId) as any[];

    return rows.map((r) => ({
      message_id: r.message_id,
      conversation_id: r.conversation_id,
      role: r.role,
      content: r.content,
      payload_json: r.payload_json ? JSON.parse(r.payload_json) : null,
      created_at: r.created_at
    }));
  } finally {
    db.close();
  }
}

export async function storeMessage(params: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  payload?: any;
}): Promise<ChatMessage> {
  await ensureChatDb();
  const db = new Database(CHAT_DB_PATH);
  try {
    const messageId = uuidLike("msg").toUpperCase();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO messages (message_id, conversation_id, role, content, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(messageId, params.conversationId, params.role, params.content, params.payload ? JSON.stringify(params.payload) : null, createdAt);
    return {
      message_id: messageId,
      conversation_id: params.conversationId,
      role: params.role,
      content: params.content,
      payload_json: params.payload ?? null,
      created_at: createdAt
    };
  } finally {
    db.close();
  }
}

export async function updateMessageContent(params: {
  conversationId: string;
  messageId: string;
  content: string;
}) {
  await ensureChatDb();
  const db = new Database(CHAT_DB_PATH);
  try {
    db.prepare(`UPDATE messages SET content = ?, payload_json = NULL WHERE conversation_id = ? AND message_id = ?`).run(
      params.content,
      params.conversationId,
      params.messageId
    );
  } finally {
    db.close();
  }
}

export async function deleteMessagesAfterMessage(params: {
  conversationId: string;
  messageId: string;
}): Promise<number> {
  await ensureChatDb();
  const db = new Database(CHAT_DB_PATH);
  try {
    const createdAt = db
      .prepare(`SELECT created_at FROM messages WHERE conversation_id = ? AND message_id = ?`)
      .get(params.conversationId, params.messageId) as { created_at: string } | undefined;
    if (!createdAt?.created_at) return 0;

    const result = db
      .prepare(`DELETE FROM messages WHERE conversation_id = ? AND created_at > ?`)
      .run(params.conversationId, createdAt.created_at);

    return result.changes ?? 0;
  } finally {
    db.close();
  }
}


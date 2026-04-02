import fs from "fs";
import Database from "better-sqlite3";
import { QUICK_ACCESS_DB_PATH } from "./paths";
import { seedDbs } from "./seedDbs";

export type QuickQuestion = {
  id: string;
  question_text: string;
  sql_template: string;
};

async function ensureQuickDb() {
  if (fs.existsSync(QUICK_ACCESS_DB_PATH)) return;
  await seedDbs();
}

export async function listQuickQuestions(): Promise<QuickQuestion[]> {
  await ensureQuickDb();
  const db = new Database(QUICK_ACCESS_DB_PATH, { readonly: true });
  try {
    const rows = db.prepare(`SELECT id, question_text, sql_template FROM quick_access_questions ORDER BY created_at DESC`).all();
    return rows as QuickQuestion[];
  } finally {
    db.close();
  }
}

export async function getQuickQuestionById(id: string): Promise<QuickQuestion | null> {
  await ensureQuickDb();
  const db = new Database(QUICK_ACCESS_DB_PATH, { readonly: true });
  try {
    const row = db.prepare(`SELECT id, question_text, sql_template FROM quick_access_questions WHERE id = ?`).get(id);
    return (row as QuickQuestion) ?? null;
  } finally {
    db.close();
  }
}


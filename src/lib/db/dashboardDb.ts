import fs from "fs";
import Database from "better-sqlite3";
import { DASHBOARD_DB_PATH } from "./paths";
import { seedDbs } from "./seedDbs";
import type { ChartModel } from "../chart/chartPicker";

export type Dashboard = {
  dashboard_id: string;
  title: string;
  created_at: string;
};

export type DashboardItem = {
  item_id: string;
  dashboard_id: string;
  question: string;
  sql_query: string;
  interpretation: string;
  chart_model_json: ChartModel;
  refresh_interval: number; // 0 for off, else minutes
  layout_json: { x: number; y: number; w: number; h: number } | null;
  created_at: string;
};

let dashboardDbInitPromise: Promise<void> | null = null;

async function ensureDashboardDb() {
  if (fs.existsSync(DASHBOARD_DB_PATH)) return;
  if (!dashboardDbInitPromise) {
    dashboardDbInitPromise = seedDbs().then(() => undefined).finally(() => {
      dashboardDbInitPromise = null;
    });
  }
  await dashboardDbInitPromise;
}

function uuidLike(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}-${Date.now()}`.toUpperCase();
}

export async function listDashboards(): Promise<Dashboard[]> {
  await ensureDashboardDb();
  const db = new Database(DASHBOARD_DB_PATH, { readonly: true });
  try {
    return db.prepare(`SELECT dashboard_id, title, created_at FROM dashboards ORDER BY created_at DESC`).all() as Dashboard[];
  } finally {
    db.close();
  }
}

export async function createDashboard(title: string): Promise<Dashboard> {
  await ensureDashboardDb();
  const db = new Database(DASHBOARD_DB_PATH);
  try {
    const id = uuidLike("DASH").toLowerCase();
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO dashboards (dashboard_id, title, created_at) VALUES (?, ?, ?)`).run(id, title, createdAt);
    return { dashboard_id: id, title, created_at: createdAt };
  } finally {
    db.close();
  }
}

export async function getDashboard(dashboardId: string): Promise<Dashboard | null> {
  await ensureDashboardDb();
  const db = new Database(DASHBOARD_DB_PATH, { readonly: true });
  try {
    const d = db.prepare(`SELECT dashboard_id, title, created_at FROM dashboards WHERE dashboard_id = ?`).get(dashboardId) as Dashboard | undefined;
    return d || null;
  } finally {
    db.close();
  }
}

export async function listDashboardItems(dashboardId: string): Promise<DashboardItem[]> {
  await ensureDashboardDb();
  const db = new Database(DASHBOARD_DB_PATH, { readonly: true });
  try {
    const rows = db.prepare(`SELECT item_id, dashboard_id, question, sql_query, interpretation, chart_model_json, refresh_interval, layout_json, created_at FROM dashboard_items WHERE dashboard_id = ? ORDER BY created_at ASC`).all(dashboardId) as any[];
    return rows.map(r => ({
      ...r,
      chart_model_json: JSON.parse(r.chart_model_json),
      layout_json: r.layout_json ? JSON.parse(r.layout_json) : null
    }));
  } finally {
    db.close();
  }
}

export async function addDashboardItem(params: {
  dashboardId: string;
  question: string;
  sqlQuery: string;
  interpretation: string;
  chartModelJson: any;
  layoutJson?: any;
}): Promise<DashboardItem> {
  await ensureDashboardDb();
  const db = new Database(DASHBOARD_DB_PATH);
  try {
    const id = uuidLike("WIDGET").toLowerCase();
    const createdAt = new Date().toISOString();
    const interval = 0;
    const layout = params.layoutJson ?? null;
    db.prepare(`
      INSERT INTO dashboard_items (item_id, dashboard_id, question, sql_query, interpretation, chart_model_json, refresh_interval, layout_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.dashboardId, params.question, params.sqlQuery, params.interpretation, JSON.stringify(params.chartModelJson), interval, layout ? JSON.stringify(layout) : null, createdAt);
    
    return {
      item_id: id,
      dashboard_id: params.dashboardId,
      question: params.question,
      sql_query: params.sqlQuery,
      interpretation: params.interpretation,
      chart_model_json: params.chartModelJson,
      refresh_interval: interval,
      layout_json: layout,
      created_at: createdAt
    };
  } finally {
    db.close();
  }
}

export async function updateDashboardItemLayout(itemId: string, layout: { x: number; y: number; w: number; h: number }) {
  await ensureDashboardDb();
  const db = new Database(DASHBOARD_DB_PATH);
  try {
    db.prepare(`UPDATE dashboard_items SET layout_json = ? WHERE item_id = ?`).run(JSON.stringify(layout), itemId);
  } finally {
    db.close();
  }
}

export async function removeDashboardItem(itemId: string) {
  await ensureDashboardDb();
  const db = new Database(DASHBOARD_DB_PATH);
  try {
    db.prepare(`DELETE FROM dashboard_items WHERE item_id = ?`).run(itemId);
  } finally {
    db.close();
  }
}

export async function updateDashboardItemInterval(itemId: string, interval: number) {
  await ensureDashboardDb();
  const db = new Database(DASHBOARD_DB_PATH);
  try {
    db.prepare(`UPDATE dashboard_items SET refresh_interval = ? WHERE item_id = ?`).run(interval, itemId);
  } finally {
    db.close();
  }
}

export async function getDashboardItem(itemId: string): Promise<DashboardItem | null> {
  await ensureDashboardDb();
  const db = new Database(DASHBOARD_DB_PATH, { readonly: true });
  try {
    const item = db.prepare(`SELECT * FROM dashboard_items WHERE item_id = ?`).get(itemId) as any | undefined;
    if (!item) return null;
    return {
      ...item,
      chart_model_json: JSON.parse(item.chart_model_json),
      layout_json: item.layout_json ? JSON.parse(item.layout_json) : null
    };
  } finally {
    db.close();
  }
}

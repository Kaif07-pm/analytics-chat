import React, { useState, useEffect, useRef, useCallback } from "react";
import { ResponsiveGridLayout, useContainerWidth } from "react-grid-layout";
import { Plus, LayoutDashboard, Send, MessageSquareText, RefreshCw } from "lucide-react";
import { DashboardWidget } from "./DashboardWidget";
import type { Dashboard, DashboardItem } from "@/lib/db/dashboardDb";

// ── Local layout type ────────────────────────────────────────────────────────
type GridItem = { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number };
type GridMapping = { lg: GridItem[]; [key: string]: GridItem[] | undefined };

interface DashboardViewProps {
  quickQuestions: Array<{ id: string; question_text: string }>;
}

type WidgetEntry = {
  item: DashboardItem;
};

export function DashboardView({ quickQuestions }: DashboardViewProps) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<WidgetEntry[]>([]);
  const [layouts, setLayouts] = useState<GridMapping>({ lg: [] });

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: false });

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const layoutSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── data loading ─────────────────────────────────────────────────────────

  useEffect(() => {
    loadDashboards();
  }, []);

  useEffect(() => {
    if (activeDashboardId) {
      loadDashboardItems(activeDashboardId);
    } else {
      setWidgets([]);
      setLayouts({ lg: [] });
    }
  }, [activeDashboardId]);

  // Auto-scroll to bottom when new widget is added
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [widgets.length, mounted]);

  const loadDashboards = async () => {
    const res = await fetch("/api/dashboards");
    const json = await res.json();
    if (json.dashboards && json.dashboards.length > 0) {
      setDashboards(json.dashboards);
      if (!activeDashboardId) setActiveDashboardId(json.dashboards[0].dashboard_id);
    }
  };

  const loadDashboardItems = async (dashboardId: string) => {
    const res = await fetch(`/api/dashboards/${dashboardId}`);
    const json = await res.json();
    if (json.items) {
      const entries: WidgetEntry[] = json.items.map((item: DashboardItem) => ({ item }));
      setWidgets(entries);

      // Build layout grid from saved positions or compute defaults
      const lg: GridItem[] = json.items.map((item: DashboardItem, idx: number) => {
        const saved = item.layout_json;
        if (saved) {
          return { i: item.item_id, x: saved.x, y: saved.y, w: saved.w, h: saved.h, minW: 2, minH: 4 };
        }
        // Default: 2-column layout, each item occupies 6 of 12 columns
        const col = idx % 2 === 0 ? 0 : 6;
        const row = Math.floor(idx / 2) * 9;
        return { i: item.item_id, x: col, y: row, w: 6, h: 9, minW: 2, minH: 4 };
      });
      setLayouts({ lg });
    }
  };

  // ── actions ───────────────────────────────────────────────────────────────

  const createDashboard = async () => {
    const title = window.prompt("Enter new dashboard name:", "My Dashboard");
    if (!title) return;
    const res = await fetch("/api/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    const json = await res.json();
    if (json.dashboard) {
      await loadDashboards();
      setActiveDashboardId(json.dashboard.dashboard_id);
    }
  };

  const askWidget = useCallback(async (questionText: string) => {
    if (!activeDashboardId || !questionText.trim()) return;
    setLoading(true);
    setError(null);
    const trimmedQ = questionText.trim();
    setPrompt("");
    try {
      const res = await fetch(`/api/dashboards/${activeDashboardId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmedQ })
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to generate widget");
      } else if (json.item) {
        const newItem: DashboardItem = json.item;
        setWidgets(prev => {
          const next = [...prev, { item: newItem }];
          // Place new widget at the bottom of the grid
          setLayouts((prevLayouts: GridMapping) => {
            const lg = prevLayouts.lg || [];
            const existingMax = lg.reduce((max: number, l: any) => Math.max(max, l.y + l.h), 0);
            const col = prev.length % 2 === 0 ? 0 : 6;
            const newGridItem: GridItem = {
              i: newItem.item_id,
              x: col,
              y: existingMax,
              w: 6,
              h: 9,
              minW: 2,
              minH: 4
            };
            return { ...prevLayouts, lg: [...lg, newGridItem] };
          });
          return next;
        });
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [activeDashboardId]);

  const removeWidget = useCallback(async (itemId: string) => {
    if (!activeDashboardId) return;
    await fetch(`/api/dashboards/${activeDashboardId}/items/${itemId}`, { method: "DELETE" });
    setWidgets(prev => prev.filter(w => w.item.item_id !== itemId));
    setLayouts((prev: GridMapping) => ({ ...prev, lg: (prev.lg || []).filter((l: any) => l.i !== itemId) }));
  }, [activeDashboardId]);

  // Fired by react-grid-layout on drag/resize stop
  const onLayoutChange = useCallback((layout: any, allLayouts: any) => {
    if (!activeDashboardId) return;
    setLayouts(allLayouts);

    // Debounced persistence
    if (layoutSaveTimeout.current) clearTimeout(layoutSaveTimeout.current);
    layoutSaveTimeout.current = setTimeout(async () => {
      const currentLg = allLayouts.lg || [];
      await Promise.all(
        currentLg.map((l: any) =>
          fetch(`/api/dashboards/${activeDashboardId}/items/${l.i}/layout`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ x: l.x, y: l.y, w: l.w, h: l.h })
          }).catch(() => {})
        )
      );
    }, 800);
  }, [activeDashboardId]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!loading && prompt.trim()) askWidget(prompt);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex min-h-0 bg-slate-50">
      {/* ─── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white/80 backdrop-blur-sm p-4 flex flex-col h-full min-h-0 gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <LayoutDashboard size={15} className="text-blue-600" />
            Dashboards
          </div>
          <button
            onClick={createDashboard}
            className="p-1.5 rounded-lg border border-slate-200 hover:border-blue-200 hover:bg-blue-50 transition-all text-slate-600"
            title="New dashboard"
          >
            <Plus size={15} />
          </button>
        </div>

        {/* Dashboard list */}
        <div className="space-y-1">
          {dashboards.map(d => (
            <button
              key={d.dashboard_id}
              onClick={() => setActiveDashboardId(d.dashboard_id)}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                activeDashboardId === d.dashboard_id
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                  : "bg-white text-slate-700 border-slate-200 hover:border-blue-200 hover:bg-blue-50/50"
              }`}
            >
              {d.title}
            </button>
          ))}
          {dashboards.length === 0 && (
            <p className="text-xs text-slate-400 px-1">No dashboards yet. Create one!</p>
          )}
        </div>

        <div className="border-t border-slate-100" />

        {/* Quick Add KPIs */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1 rounded-md bg-emerald-100 text-emerald-600">
              <MessageSquareText size={12} />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Quick Add KPIs</span>
          </div>
          <div className="flex-1 overflow-auto space-y-1.5 pr-1">
            {quickQuestions.map(q => (
              <button
                key={q.id}
                onClick={() => askWidget(q.question_text)}
                disabled={loading || !activeDashboardId}
                className="w-full text-left text-xs text-slate-700 bg-slate-50 px-2.5 py-2 rounded-lg border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50 transition-colors disabled:opacity-40 leading-snug"
              >
                <span className="text-emerald-600 font-semibold mr-1">+</span>{q.question_text}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ─── Main Workspace ──────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!activeDashboardId ? (
          <div className="flex-1 flex items-center justify-center flex-col gap-3 text-slate-400">
            <LayoutDashboard size={52} className="text-slate-200" />
            <p className="font-semibold text-slate-500">Select or create a dashboard</p>
          </div>
        ) : (
          <>
            {/* ── Scrollable drag-and-drop grid ─────────────────────── */}
            <div ref={containerRef as any} className="flex-1 overflow-auto">
              <div className="min-h-full">
                {widgets.length === 0 && !loading && (
                  <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-slate-400 gap-3 mx-6 my-6 border-2 border-dashed border-slate-200 rounded-3xl bg-white/40">
                    <LayoutDashboard size={52} className="text-slate-200" />
                    <p className="font-semibold text-slate-500">This dashboard is empty</p>
                    <p className="text-sm text-center px-4">Use the input below or Quick Add KPIs to create widgets.<br />Drag to rearrange · Grab corners to resize.</p>
                  </div>
                )}

                {widgets.length > 0 && mounted && (
                  <ResponsiveGridLayout
                    className="layout select-none"
                    width={width}
                    layouts={layouts as any}
                    breakpoints={{ lg: 1200, md: 996, sm: 768 }}
                    cols={{ lg: 12, md: 10, sm: 6 }}
                    rowHeight={44}
                    onLayoutChange={onLayoutChange}
                    margin={[14, 14]}
                    containerPadding={[16, 16]}
                    dragConfig={{
                      handle: ".drag-handle"
                    }}
                    resizeConfig={{
                      handles: ["se", "sw", "ne", "nw", "e", "w", "n", "s"]
                    }}
                  >
                    {widgets.map(({ item }) => (
                      <div key={item.item_id} style={{ overflow: "hidden" }}>
                        <DashboardWidget item={item} onRemove={removeWidget} />
                      </div>
                    ))}
                  </ResponsiveGridLayout>
                )}

                {/* Loading ghost card appended at bottom like chat */}
                {loading && (
                  <div className="mx-4 mb-4 mt-2">
                    <div className="rounded-2xl border border-blue-200 bg-white overflow-hidden shadow-sm max-w-lg">
                      <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3">
                        <div className="h-3.5 bg-white/25 rounded-full w-3/4 animate-pulse" />
                      </div>
                      <div className="p-6 flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
                        <span className="text-sm font-medium text-slate-500">Generating visualization…</span>
                        <span className="text-xs text-slate-400">Interpreting query & writing SQL</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Fixed bottom input ─── chat-style ────────────────── */}
            <div className="shrink-0 bg-white border-t border-slate-200 px-5 py-4 shadow-[0_-4px_24px_rgba(0,0,0,.04)]">
              {error && (
                <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 block">
                    Add a widget — ask a question
                  </label>
                  <textarea
                    ref={inputRef}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    rows={2}
                    disabled={loading}
                    placeholder="e.g. 'Show daily bulk uploads', 'Top action per day this month'…"
                    className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 focus:bg-white transition-all"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Enter to generate · Shift+Enter for new line · Drag blue header to move · Grab edges to resize
                  </p>
                </div>
                <button
                  onClick={() => { if (!loading && prompt.trim()) askWidget(prompt); }}
                  disabled={loading || !prompt.trim()}
                  className="mb-6 h-12 px-5 rounded-xl bg-blue-600 text-white font-semibold text-sm shadow-md hover:bg-blue-700 hover:shadow-lg active:scale-95 transition-all disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {loading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <>
                      <Send size={16} />
                      Generate
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

import React, { useEffect, useState, useRef } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend
} from "recharts";
import { Info, RefreshCw, Trash2, Clock, X, ChevronDown } from "lucide-react";
import type { DashboardItem } from "@/lib/db/dashboardDb";

interface DashboardWidgetProps {
  item: DashboardItem;
  onRemove: (itemId: string) => void;
}

const CHART_COLORS = ["#3b82f6", "#06b6d4", "#8b5cf6", "#f43f5e", "#10b981", "#f59e0b", "#ec4899", "#84cc16"];

export function DashboardWidget({ item, onRemove }: DashboardWidgetProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInterpretation, setShowInterpretation] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<number>(item.refresh_interval || 0);
  const [showIntervalMenu, setShowIntervalMenu] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const intervalMenuRef = useRef<HTMLDivElement>(null);

  const fetchFreshData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboards/${item.dashboard_id}/items/${item.item_id}/refresh`, {
        method: "POST"
      });
      const json = await res.json();
      if (json.resultJson?.rows) {
        setData(json.resultJson.rows);
        setLastRefreshed(new Date());
      }
    } catch (e) {
      console.error("Failed to refresh data", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFreshData();
  }, [item.item_id]);

  useEffect(() => {
    if (refreshInterval > 0) {
      const ms = refreshInterval * 60 * 1000;
      const id = setInterval(fetchFreshData, ms);
      return () => clearInterval(id);
    }
  }, [refreshInterval, item.item_id]);

  // Close interval menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (intervalMenuRef.current && !intervalMenuRef.current.contains(e.target as Node)) {
        setShowIntervalMenu(false);
      }
    };
    if (showIntervalMenu) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showIntervalMenu]);

  const updateInterval = async (val: number) => {
    setRefreshInterval(val);
    setShowIntervalMenu(false);
    await fetch(`/api/dashboards/${item.dashboard_id}/items/${item.item_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_interval: val })
    });
  };

  const model = item.chart_model_json;

  const renderChart = () => {
    if (!data || data.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          No data available
        </div>
      );
    }

    if (model.kind === "kpi") {
      const valueField = Object.keys(data[0] || {})[0];
      const v = data.length > 0 && valueField ? data[0][valueField] : model.value;
      return (
        <div className="flex-1 flex flex-col items-center justify-center py-4">
          <div className="text-5xl font-bold tracking-tight text-slate-900 tabular-nums">{String(v)}</div>
          <div className="mt-3 text-sm text-slate-500 font-medium">{model.label}</div>
        </div>
      );
    }

    if (model.kind === "table") {
      const columns = Object.keys(data[0] || {});
      return (
        <div className="flex-1 overflow-auto w-full">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                {columns.map(c => (
                  <th key={c} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                    {c.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, idx) => (
                <tr key={idx} className={`border-b border-slate-100 ${idx % 2 === 0 ? "" : "bg-slate-50/50"}`}>
                  {columns.map(c => (
                    <td key={c} className="px-3 py-2 text-slate-700 tabular-nums">
                      {String((r as any)[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (model.kind === "x_y") {
      const xKey = model.xKey;
      const yKey = model.yKey;
      const chartType = model.chartType;

      if (chartType === "pie") {
        return (
          <div className="flex-1 w-full min-h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,.08)" }} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Pie data={data} dataKey={yKey as any} nameKey={xKey} outerRadius="70%" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        );
      }

      if (chartType === "line") {
        return (
          <div className="flex-1 w-full min-h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,.08)" }} />
                <Line type="monotone" dataKey={yKey as any} stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3, fill: "#3b82f6" }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      }

      return (
        <div className="flex-1 w-full min-h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,.08)" }} cursor={{ fill: "rgba(59,130,246,0.05)" }} />
              <Bar dataKey={yKey as any} radius={[4, 4, 0, 0]}>
                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    if (model.kind === "x_y_multi") {
      const xKey = model.xKey;
      const yKeys = model.yKeys;
      const chartType = model.chartType;

      if (chartType === "line") {
        return (
          <div className="flex-1 w-full min-h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,.08)" }} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                {yKeys.map((yk: string, i: number) => (
                  <Line key={yk} type="monotone" dataKey={yk} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      }

      return (
        <div className="flex-1 w-full min-h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,.08)" }} cursor={{ fill: "rgba(59,130,246,0.05)" }} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              {yKeys.map((yk: string, i: number) => (
                <Bar key={yk} dataKey={yk} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden group hover:shadow-md hover:border-slate-300 transition-all duration-200">
      {/* User "question" bubble at top - like chat interface */}
      <div className="px-4 pt-3 pb-2 bg-gradient-to-r from-blue-600 to-blue-700 drag-handle cursor-grab active:cursor-grabbing select-none">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-white/95 leading-snug flex-1">{item.question}</p>
          {/* Controls - only visible on hover */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setShowInterpretation(!showInterpretation); }}
              className={`p-1.5 rounded-lg transition-colors ${showInterpretation ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/15 hover:text-white'}`}
              title="View Interpretation"
            >
              <Info size={14} />
            </button>
            <div className="relative" ref={intervalMenuRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowIntervalMenu(!showIntervalMenu); }}
                className={`p-1.5 rounded-lg transition-colors flex items-center gap-0.5 ${refreshInterval > 0 ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/15 hover:text-white'}`}
                title="Auto-refresh settings"
              >
                <Clock size={14} />
                {refreshInterval > 0 && <span className="text-[10px] font-bold">{refreshInterval}m</span>}
              </button>
              {showIntervalMenu && (
                <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50" onClick={e => e.stopPropagation()}>
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Auto Refresh</div>
                  {[0, 1, 5, 15, 60].map(val => (
                    <button
                      key={val}
                      onClick={() => updateInterval(val)}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors ${refreshInterval === val ? 'text-blue-600 font-semibold bg-blue-50/50' : 'text-slate-700'}`}
                    >
                      {val === 0 ? "Off" : `Every ${val} min${val > 1 ? 's' : ''}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={(e) => { e.stopPropagation(); fetchFreshData(); }} className="p-1.5 rounded-lg text-white/70 hover:bg-white/15 hover:text-white transition-colors" title="Refresh">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onRemove(item.item_id); }} className="p-1.5 rounded-lg text-white/70 hover:bg-red-400/40 hover:text-white transition-colors" title="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {loading && (
          <div className="mt-1 text-[10px] text-blue-200 flex items-center gap-1">
            <RefreshCw size={9} className="animate-spin" /> Refreshing data...
          </div>
        )}
      </div>

      {/* Chart / Visualization body */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* Interpretation overlay */}
        {showInterpretation && (
          <div className="absolute inset-0 bg-white z-10 overflow-auto p-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400">AI Interpretation</h4>
              <button onClick={() => setShowInterpretation(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <X size={14} />
              </button>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{item.interpretation}</p>
            <div className="mt-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">SQL Query</h4>
              <pre className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs text-slate-600 font-mono whitespace-pre-wrap break-all">{item.sql_query}</pre>
            </div>
          </div>
        )}

        <div className="p-3 h-full flex flex-col">
          {renderChart()}
          {lastRefreshed && (
            <div className="mt-1 text-[10px] text-slate-400 text-right">
              Updated {lastRefreshed.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

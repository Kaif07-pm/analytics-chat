import type { NextPage } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { jsPDF } from "jspdf";
import { Send, Download, Plus, MessageSquareText } from "lucide-react";
import type { SqlResultJson } from "@/lib/db/eventsDb";
import type { ChartModel, SupportedChartType } from "@/lib/chart/chartPicker";

type ChatPayload = {
  sql: string | null;
  resultJson: SqlResultJson | null;
  chartModel: ChartModel | null;
};

type ChatMessage = {
  message_id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  payload_json: ChatPayload | null;
  created_at: string;
};

type Conversation = { conversation_id: string; title: string; created_at: string };

function formatTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function pickSupportedChartTypes() {
  return ["auto", "bar", "line", "pie", "table"] as const;
}

const ChartPanel = ({ payload }: { payload: ChatPayload }) => {
  const result = payload.resultJson;
  const initial = payload.chartModel;

  const [chartType, setChartType] = useState<SupportedChartType>(() => {
    if (!initial) return "auto";
    if (initial.kind === "kpi") return "auto";
    if (initial.kind === "table") return "table";
    if (initial.kind === "x_y") return initial.chartType;
    if (initial.kind === "x_y_multi") return initial.chartType;
    return "auto";
  });

  useEffect(() => {
    if (!initial) setChartType("auto");
    else if (initial.kind === "kpi") setChartType("auto");
    else if (initial.kind === "table") setChartType("table");
    else if (initial.kind === "x_y") setChartType(initial.chartType);
    else if (initial.kind === "x_y_multi") setChartType(initial.chartType);
  }, [payload.sql]);

  if (!result || !payload.chartModel) return null;

  // KPI
  if (payload.chartModel.kind === "kpi") {
    const v = payload.chartModel.value;
    return (
      <div className="mt-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">KPI</div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{String(v)}</div>
          <div className="mt-1 text-sm text-slate-600">{payload.chartModel.label}</div>
        </div>
      </div>
    );
  }

  // Table
  if (payload.chartModel.kind === "table" || chartType === "table") {
    return (
      <div className="mt-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Table</div>
          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c.name} className="px-3 py-2 text-left text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, idx) => (
                  <tr key={idx} className="border-b border-slate-100">
                    {result.columns.map((c) => (
                      <td key={c.name} className="px-3 py-2 text-slate-700">
                        {String((r as any)[c.name] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
                {result.rows.length === 0 ? (
                  <tr>
                    <td colSpan={result.columns.length} className="px-3 py-4 text-slate-500">
                      No rows returned.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // x_y_multi
  if (payload.chartModel.kind === "x_y_multi") {
    const model = payload.chartModel;

    const effectiveChartType: Exclude<SupportedChartType, "auto"> = (() => {
      if (chartType === "auto") return model.chartType as any;
      if (chartType === "bar" || chartType === "line" || chartType === "pie") return chartType;
      return model.chartType as any;
    })();

    // If user picks pie/table, fall back to table for multi-series.
    if (effectiveChartType === "pie") {
      return (
        <div className="mt-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Table</div>
            <div className="mt-3 overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th
                        key={c.name}
                        className="px-3 py-2 text-left text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200"
                      >
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      {result.columns.map((c) => (
                        <td key={c.name} className="px-3 py-2 text-slate-700">
                          {String((r as any)[c.name] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {result.rows.length === 0 ? (
                    <tr>
                      <td colSpan={result.columns.length} className="px-3 py-4 text-slate-500">
                        No rows returned.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    const xKey = model.xKey;
    const yKeys = model.yKeys;
    const data = result.rows as Array<Record<string, unknown>>;

    const colorPalette = ["#2563eb", "#1d4ed8", "#7c3aed", "#9333ea", "#0891b2", "#0ea5e9"];

    return (
      <div className="mt-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Visualization</div>
            <div className="flex items-center gap-2">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Chart</div>
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                value={chartType}
                onChange={(e) => setChartType(e.target.value as any)}
              >
                {pickSupportedChartTypes().map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3" style={{ width: "100%", height: 320 }}>
            {effectiveChartType === "line" ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  {yKeys.map((yk, idx) => (
                    <Line
                      key={yk}
                      type="monotone"
                      dataKey={yk as any}
                      stroke={colorPalette[idx % colorPalette.length]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  {yKeys.map((yk, idx) => (
                    <Bar key={yk} dataKey={yk as any} fill={colorPalette[idx % colorPalette.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    );
  }

  // x_y
  if (payload.chartModel.kind !== "x_y") return null;
  const model = payload.chartModel;

  const effectiveChartType: Exclude<SupportedChartType, "auto"> = (() => {
    if (chartType === "auto") return model.chartType as any;
    if (chartType === "bar" || chartType === "line" || chartType === "pie") return chartType;
    return model.chartType as any;
  })();

  const xKey = model.xKey;
  const yKey = model.yKey;

  const data = result.rows as Array<Record<string, unknown>>;

  return (
    <div className="mt-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Visualization</div>
          <div className="flex items-center gap-2">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Chart</div>
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              value={chartType}
              onChange={(e) => setChartType(e.target.value as any)}
            >
              {pickSupportedChartTypes().map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3" style={{ width: "100%", height: 320 }}>
          {effectiveChartType === "bar" ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey={yKey as any} fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          ) : effectiveChartType === "line" ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey={yKey as any} stroke="#1d4ed8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : effectiveChartType === "pie" ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip />
                <Pie data={data as any} dataKey={yKey as any} nameKey={xKey} outerRadius={110} fill="#2563eb" />
              </PieChart>
            </ResponsiveContainer>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const ChatPage: NextPage = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quickQuestions, setQuickQuestions] = useState<Array<{ id: string; question_text: string; sql_template: string }>>([]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const [editing, setEditing] = useState<null | { messageId: string; draft: string }>(null);
  const [crossQuestion, setCrossQuestion] = useState<string>("");
  const [pendingCrossFor, setPendingCrossFor] = useState<ChatMessage | null>(null);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = async () => {
      const qcRes = await fetch("/api/quick-questions");
      const qcJson = await qcRes.json();
      setQuickQuestions(qcJson.questions ?? []);

      const convRes = await fetch("/api/conversations");
      const convJson = await convRes.json();
      const list = convJson.conversations ?? [];
      setConversations(list);
      if (list.length > 0) setActiveConversationId(list[0].conversation_id);
    };
    load();
  }, []);

  useEffect(() => {
    const loadMessages = async () => {
      if (!activeConversationId) return;
      const res = await fetch(`/api/messages?conversationId=${encodeURIComponent(activeConversationId)}`);
      const json = await res.json();
      setMessages(json.messages ?? []);
    };
    loadMessages();
  }, [activeConversationId]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [messages.length, loading]);

  const lastUserQuestion = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].content;
    }
    return "";
  }, [messages]);

  const runChat = async (params: {
    message: string;
    mode: "chat" | "quick_access" | "cross";
    quickQuestionId?: string;
    lastContext?: any;
    replaceUserMessageId?: string;
  }) => {
    setLoading(true);
    setChatError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId ?? undefined,
          message: params.message,
          mode: params.mode,
          quickQuestionId: params.quickQuestionId,
          lastContext: params.lastContext,
          replaceUserMessageId: params.replaceUserMessageId
        })
      });

      const ct = res.headers.get("content-type") ?? "";
      const raw = await res.text();
      let json: Record<string, unknown> = {};
      if (ct.includes("application/json")) {
        try {
          json = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          setChatError("Invalid response from server. Check Vercel function logs.");
          return;
        }
      } else {
        setChatError(
          res.ok
            ? "Unexpected response from server."
            : `Request failed (${res.status}). If this is Vercel, the function may have timed out (10s on Hobby) or crashed.`
        );
        return;
      }

      if (!res.ok) {
        const errMsg = typeof json.error === "string" ? json.error : `Request failed (${res.status}).`;
        setChatError(errMsg);
        return;
      }

      if (typeof json.conversationId === "string") setActiveConversationId(json.conversationId);

      if (typeof json.conversationId === "string") {
        const mRes = await fetch(`/api/messages?conversationId=${encodeURIComponent(json.conversationId)}`);
        const mJson = await mRes.json();
        setMessages(mJson.messages ?? []);
      }

      const cRes = await fetch("/api/conversations");
      const cJson = await cRes.json();
      setConversations(cJson.conversations ?? []);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput("");
    await runChat({ message: msg, mode: "chat" });
  };

  const handleRunQuick = async (qid: string) => {
    if (loading) return;
    const q = quickQuestions.find((x) => x.id === qid);
    if (!q) return;
    await runChat({ message: q.question_text, mode: "quick_access", quickQuestionId: qid });
  };

  const handleNewChat = () => {
    // Force backend to create a new conversation on next request.
    setActiveConversationId(null);
    setMessages([]);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.text("Analytics Chat Export", 40, 40);
    doc.setFontSize(10);
    let y = 60;
    for (const m of messages) {
      const prefix = m.role === "user" ? "User: " : "Assistant: ";
      const lines = doc.splitTextToSize(prefix + m.content, 530);
      for (const line of lines) {
        doc.text(line, 40, y);
        y += 14;
        if (y > 760) {
          doc.addPage();
          y = 40;
        }
      }
      y += 8;
    }
    doc.save("analytics-chat.pdf");
  };

  const shareEmail = () => {
    const summary = messages
      .slice(-10)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    const subject = encodeURIComponent("Analytics Chat Summary");
    const body = encodeURIComponent(summary);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const renderMessageRoleStyles = (role: ChatMessage["role"]) => {
    if (role === "user") {
      return "ml-auto bg-blue-600 text-white border border-blue-700";
    }
    return "mr-auto bg-white text-slate-900 border border-slate-200";
  };

  return (
    <div className="h-screen w-full flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 border-r border-slate-200 bg-slate-50 p-4 flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-bold text-slate-900 tracking-tight">Analytics</div>
          <button
            onClick={handleNewChat}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm hover:border-blue-200 transition-all"
            title="Create new chat"
          >
            <Plus size={18} className="text-slate-700" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex-shrink-0 overflow-hidden max-h-[240px]">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-blue-50 px-2.5 py-1 text-blue-600">
              <MessageSquareText size={14} />
            </div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700">Quick Access</div>
          </div>

          <div className="mt-3 space-y-2 overflow-auto max-h-[180px] pr-1">
            {quickQuestions.map((q) => (
              <button
                key={q.id}
                onClick={() => handleRunQuick(q.id)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm hover:border-blue-200 transition-all"
              >
                <div className="text-sm font-semibold text-slate-900">{q.question_text}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex-1 overflow-hidden min-h-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700">Chat History</div>
          <div className="mt-2 space-y-1 overflow-auto pr-1">
            {conversations.map((c) => {
              const active = c.conversation_id === activeConversationId;
              return (
                <button
                  key={c.conversation_id}
                  onClick={() => setActiveConversationId(c.conversation_id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${
                    active ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-200"
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900">{c.title}</div>
                  <div className="text-[10px] text-slate-500">{formatTimestamp(c.created_at)}</div>
                </button>
              );
            })}
            {conversations.length === 0 ? <div className="text-sm text-slate-500 mt-2">No chats yet.</div> : null}
          </div>
        </div>

        {/* Profile */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-bold">
              K
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">Kaif Mac</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5 truncate">
                Senior Manager
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-h-0">
        <div className="border-b border-slate-200 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-900">Chat Analytics</div>
              <div className="mt-1 text-sm text-slate-600">Ask questions in natural language and explore dynamic visualizations.</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={exportPdf}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm hover:border-blue-200 transition-all text-sm font-semibold text-slate-700"
              >
                <Download size={18} className="inline-block mr-2" />
                Export PDF
              </button>
              <button
                onClick={shareEmail}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm hover:border-blue-200 transition-all text-sm font-semibold text-slate-700"
              >
                Share Email
              </button>
            </div>
          </div>
        </div>

        <div ref={chatScrollRef} className="flex-1 overflow-auto p-6 min-h-0">
          <div className="space-y-4">
            {messages.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                Start by clicking a Quick Access question, or ask a question in the input below.
              </div>
            ) : null}

            {messages.map((m) => {
              const payload = m.payload_json as ChatPayload | null;
              const isUser = m.role === "user";
              const showEdit = isUser;

              return (
                <div key={m.message_id} className="flex">
                  <div
                    className={`max-w-[860px] w-full rounded-xl p-4 shadow-sm transition-all ${renderMessageRoleStyles(m.role)}`}
                    style={{ background: isUser ? undefined : undefined }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
                      {showEdit ? (
                        <button
                          onClick={() => setEditing({ messageId: m.message_id, draft: m.content })}
                          className="rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-700 hover:border-blue-200 transition-all"
                          title="Edit and re-run"
                        >
                          Edit
                        </button>
                      ) : (
                        <button
                          onClick={() => setPendingCrossFor(m)}
                          disabled={!payload?.resultJson}
                          className="rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-700 hover:border-blue-200 transition-all disabled:opacity-50"
                          title="Ask a follow-up based on this output"
                        >
                          Ask cross-question
                        </button>
                      )}
                    </div>

                    {payload?.resultJson && payload.chartModel ? <ChartPanel payload={payload} /> : null}

                    {payload?.sql ? (
                      <div className="mt-3">
                        <details className="group">
                          <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-all">
                            Show SQL used
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-[11px] text-slate-600 border border-slate-200">
                            {payload.sql}
                          </pre>
                        </details>
                      </div>
                    ) : null}

                    {editing?.messageId === m.message_id ? (
                      <div className="mt-3">
                        <textarea
                          value={editing.draft}
                          onChange={(e) => setEditing((prev) => (prev ? { ...prev, draft: e.target.value } : prev))}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          rows={3}
                        />
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditing(null)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={async () => {
                              const edited = editing.draft.trim();
                              if (!edited) return;
                              const replaceUserMessageId = editing.messageId;
                              setEditing(null);
                              await runChat({ message: edited, mode: "chat", replaceUserMessageId });
                            }}
                            className="rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-blue-700 transition-all"
                          >
                            Re-run
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {pendingCrossFor?.message_id === m.message_id ? (
                      <div className="mt-3">
                        <textarea
                          value={crossQuestion}
                          onChange={(e) => setCrossQuestion(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          rows={2}
                          placeholder="Ask a follow-up (e.g., 'show last month', 'break down by day')"
                        />
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setPendingCrossFor(null);
                              setCrossQuestion("");
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={async () => {
                              const q = crossQuestion.trim();
                              if (!q) return;
                              setPendingCrossFor(null);
                              const last = payload;
                              await runChat({
                                message: q,
                                mode: "cross",
                                lastContext: {
                                  originalQuestion: lastUserQuestion,
                                  lastSql: last?.sql,
                                  lastResult: last?.resultJson,
                                  lastInterpretation: m.content
                                }
                              });
                              setCrossQuestion("");
                            }}
                            className="rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-blue-700 transition-all"
                          >
                            Ask
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white p-6">
          {chatError ? (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {chatError}
            </div>
          ) : null}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
                User query in natural language
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                rows={2}
                placeholder="Ask: 'Which system action is performed the most every day?'"
              />
              <div className="mt-1 text-[11px] text-slate-500">
                Tip: Try the Quick Access questions for supported analytics intents in this prototype.
              </div>
            </div>

            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="rounded-lg bg-blue-600 text-white px-4 py-3 shadow-sm hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Send"
            >
              <div className="flex items-center">
                <Send size={18} className="mr-2" />
                {loading ? "Running..." : "Send"}
              </div>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ChatPage;


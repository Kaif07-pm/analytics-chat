import type { SqlResultJson } from "../db/eventsDb";

export type SupportedChartType = "auto" | "bar" | "line" | "pie" | "table";

export type ChartModel =
  | { kind: "kpi"; value: number | string; label: string }
  | {
      kind: "x_y";
      chartType: Exclude<SupportedChartType, "auto" | "table">;
      xKey: string;
      yKey: string;
      data: Array<Record<string, unknown>>;
    }
  | {
      kind: "x_y_multi";
      chartType: Exclude<SupportedChartType, "auto" | "table">;
      xKey: string;
      yKeys: string[];
      data: Array<Record<string, unknown>>;
    }
  | { kind: "table"; columns: string[]; rows: Array<Record<string, unknown>> };

function inferColumnTypes(result: SqlResultJson): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of result.columns) map[c.name] = c.type;
  return map;
}

export function autoPickChart(result: SqlResultJson): ChartModel {
  const typeMap = inferColumnTypes(result);
  const numericColumns = result.columns.filter((c) => c.type === "integer" || c.type === "number").map((c) => c.name);

  if (result.rows.length === 0) {
    return { kind: "table", columns: result.columns.map((c) => c.name), rows: [] };
  }

  // KPI: 1 numeric-ish column and single row.
  const timeLikeX =
    result.columns.find((c) => c.name === "day" || c.name === "hour_of_day" || c.name.toLowerCase().includes("hour") || c.name.toLowerCase().includes("time"))?.name ??
    null;

  // Prefer time/day/month-ish columns as X-axis even if they are numeric in the dummy generator.
  const dimensionCandidates = timeLikeX
    ? [timeLikeX, ...result.columns.filter((c) => c.name !== timeLikeX).map((c) => c.name)]
    : result.columns.filter((c) => (numericColumns.length > 0 ? !numericColumns.includes(c.name) : true)).map((c) => c.name);

  const xKey = timeLikeX ?? dimensionCandidates[0] ?? null;

  // Pick all numeric columns except xKey. If only one metric exists, we render a single-series chart.
  const yKeys = numericColumns.filter((n) => n !== xKey);
  const yKey = yKeys[0] ?? numericColumns[0] ?? null;

  // KPI only for true scalar responses (single-column result).
  if (result.columns.length === 1 && result.rows.length === 1 && numericColumns.length === 1) {
    const onlyY = numericColumns[0];
    const val = (result.rows[0] as any)[onlyY] as any;
    return { kind: "kpi", value: val ?? "", label: onlyY };
  }

  if (!yKey || !xKey) {
    return { kind: "table", columns: result.columns.map((c) => c.name), rows: result.rows };
  }

  const xType = typeMap[xKey] ?? "text";
  const useLine =
    xType === "date_or_timestamp" ||
    xKey === "hour_of_day" ||
    xKey === "day" ||
    xKey === "week_start_date" ||
    xKey.toLowerCase().includes("hour") ||
    xKey.toLowerCase().includes("week");
  const chartType: Exclude<SupportedChartType, "auto" | "table"> = useLine ? "line" : "bar";

  if (yKeys.length >= 2) {
    return {
      kind: "x_y_multi",
      chartType,
      xKey,
      yKeys,
      data: result.rows
    };
  }

  return { kind: "x_y", chartType, xKey, yKey: yKey as string, data: result.rows };
}


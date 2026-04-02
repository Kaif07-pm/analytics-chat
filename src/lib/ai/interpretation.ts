import type { SqlGenOutput } from "./sqlGenerator";
import type { SqlResultJson } from "../db/eventsDb";

function firstRowValue<T>(result: SqlResultJson | null | undefined, key: string): T | null {
  if (!result || result.rows.length === 0) return null;
  const v = (result.rows[0] as any)[key];
  return (v === null || v === undefined ? null : (v as T));
}

export function buildInterpretation(args: {
  question: string;
  sqlGen: SqlGenOutput;
  sql: string;
  result: SqlResultJson;
}): string {
  const { question, result, sqlGen } = args;

  if (sqlGen.kind === "out_of_scope") {
    return "This question appears out of scope for the data model in this prototype. Try one of the quick access questions or ask about system actions, onboarding this month, bulk upload volume by hour, checker group approvals, maker-to-admin wait time, or elevated access pending queue.";
  }

  switch (sqlGen.kind === "ok" ? sqlGen.intent : null) {
    case "MOST_ACTION_DAILY": {
      const daily = result.rows.slice(0, 7) as Array<any>;
      const exampleLines = daily.map((r) => `${r.day}: ${r.top_action} (${r.action_count})`);
      const tail = result.rows.length > daily.length ? `...and ${result.rows.length - daily.length} more day(s).` : "";
      return `Here’s which system action was used the most on each day (top action per day):\n\n${exampleLines.join("\n")}\n${tail}`;
    }
    case "ONBOARDING_THIS_MONTH": {
      const month = firstRowValue<string>(result, "month");
      const count = firstRowValue<number>(result, "onboarding_cases_processed");
      return `In ${month ?? "the selected month"}, the portal processed ${count ?? 0} onboarding case(s) (from ` + "`initiate_screening`" + ` events with onboarding categories).`;
    }
    case "ONBOARDING_THIS_MONTH_WEEK_WISE": {
      const top = result.rows.slice(0, 6).map((r) => {
        const week = (r as any).week_start_date as string;
        const cnt = (r as any).onboarding_cases_processed as number;
        return `${week}: ${cnt}`;
      });
      const tail = result.rows.length > top.length ? `...and ${result.rows.length - top.length} more week(s).` : "";
      return `Weekly onboarding volume for the month (count of \`initiate_screening\` onboarding events). Top weeks: ${top.join(", ")}. ${tail}`.trim();
    }
    case "BULK_UPLOADS_PEAK_HOUR": {
      const hour = firstRowValue<number>(result, "hour_of_day");
      const count = firstRowValue<number>(result, "bulk_upload_count");
      return `The highest volume of bulk uploads happens around hour ${hour ?? 0}:00, with ${count ?? 0} bulk upload event(s) in the dataset.`;
    }
    case "CHECKER_GROUP_APPROVES_MOST": {
      const group = firstRowValue<string>(result, "checker_group_name");
      const count = firstRowValue<number>(result, "approvals_count");
      return `The checker group that approves the most drafts is ${group ?? "N/A"}, with ${count ?? 0} approval event(s).`;
    }
    case "AVG_WAIT_MAKER_TO_ADMIN": {
      const hours = firstRowValue<number>(result, "avg_wait_hours");
      const mins = firstRowValue<number>(result, "avg_wait_minutes");
      if (hours === null || mins === null) return `I couldn't compute an average wait time from the current dummy data.`;
      return `The average wait time between a maker’s submission and an admin’s approval is about ${hours} hour(s) (${mins} minute(s)).`;
    }
    case "ELEVATED_ACCESS_PENDING_QUEUE": {
      const pending = firstRowValue<number>(result, "pending_requests_count");
      return `At the time of the query, there are ${pending ?? 0} elevated access request(s) currently sitting in the pending queue (latest status = ` + "`PENDING_SUPERIOR_APPROVAL`" + `).`;
    }
    default: {
      // Fallback: generic narrative from the result shape.
      const columnNames = result.columns.map((c) => c.name);
      const has = (name: string) => columnNames.includes(name);

      if (has("week_start_date") && has("onboarding_cases_processed")) {
        const top = result.rows
          .slice(0, 6)
          .map((r) => `${(r as any).week_start_date}: ${(r as any).onboarding_cases_processed}`);
        const tail = result.rows.length > 6 ? `...and ${result.rows.length - 6} more week(s).` : "";
        return `Weekly onboarding volume (from \`initiate_screening\`). Top weeks: ${top.join(", ")}. ${tail}`.trim();
      }

      if (has("day") && has("onboarding_cases_processed")) {
        const top = result.rows
          .slice(0, 7)
          .map((r) => `${(r as any).day}: ${(r as any).onboarding_cases_processed}`);
        const tail = result.rows.length > 7 ? `...and ${result.rows.length - 7} more day(s).` : "";
        return `Daily onboarding volume (from \`initiate_screening\`). Sample: ${top.join(", ")}. ${tail}`.trim();
      }

      if (has("hour_of_day") && has("bulk_upload_count")) {
        const rows = result.rows as any[];
        const best = rows[0] ?? null;
        if (best && best.hour_of_day !== undefined && best.bulk_upload_count !== undefined) {
          return `Bulk upload activity peaks at around hour ${best.hour_of_day}:00 with ${best.bulk_upload_count} bulk upload event(s) in the dataset.`;
        }
      }

      if (result.rows.length === 1 && Object.keys(result.rows[0]).length === 1) {
        const k = Object.keys(result.rows[0])[0];
        return `For your question (“${question}”), the result is ${String((result.rows[0] as any)[k] ?? "")}.`;
      }
      return `I generated analytics from the available event data. Here’s the summary based on the query output.`;
    }
  }
}


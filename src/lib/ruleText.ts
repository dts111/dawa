// Plain-language wording for automation rules. Kept free of database imports
// so both the server engine and the browser UI can use it.

import type { AutomationRule } from "./types";

export function describeRule(rule: AutomationRule): string {
  switch (rule.trigger) {
    case "due_in_days":
      return `Tasks due within ${rule.triggerDays} working day${rule.triggerDays === 1 ? "" : "s"}`;
    case "overdue":
      return "Tasks past their finish date and not done";
    case "starting_in_days":
      return `Tasks starting within ${rule.triggerDays} working day${rule.triggerDays === 1 ? "" : "s"}`;
    case "not_started_but_should_be":
      return "Tasks that should have started but have not";
    case "status_is":
      return `Tasks with status "${rule.triggerStatus ?? "—"}"`;
    default:
      return rule.trigger;
  }
}

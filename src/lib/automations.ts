// Automation rules: "when X is true of a task, email someone about it."
//
// Rules are evaluated on demand — either by the Run now button or by an
// external scheduler hitting /api/automations/run once a day. Nothing runs in
// a background timer, so the app has no hidden state and restarts cleanly.

import { WorkCalendar, todayISO } from "./calendar";
import {
  claimAutomationSend,
  listEnabledAutomations,
  markAutomationRun,
  logActivity,
} from "./db";
import { loadProject } from "./projectData";
import { describeRule } from "./ruleText";
import { renderRuleNotification, renderTaskUpdateRequest, sendEmail } from "./email";
import type { AutomationRule, ProjectBundleData, ScheduledTask } from "./types";

export { describeRule };

export interface RuleOutcome {
  ruleId: string;
  ruleName: string;
  projectId: string;
  matched: number;
  sent: number;
  skipped: number;
  recipients: string[];
  errors: string[];
}

/** Which tasks a rule matches right now. */
export function matchTasks(rule: AutomationRule, bundle: ProjectBundleData, today: string): ScheduledTask[] {
  const cal = new WorkCalendar(bundle.project.workingDays, bundle.project.holidays);
  const leaves = bundle.schedule.tasks.filter((t) => !t.isSummary);

  switch (rule.trigger) {
    case "due_in_days":
      return leaves.filter(
        (t) =>
          t.effectiveStatus !== "done" &&
          t.finish >= today &&
          cal.workingDaysBetween(today, t.finish) - 1 <= rule.triggerDays,
      );
    case "overdue":
      return leaves.filter((t) => t.effectiveStatus !== "done" && t.finish < today);
    case "starting_in_days":
      return leaves.filter(
        (t) =>
          t.effectiveStatus === "not_started" &&
          t.start >= today &&
          cal.workingDaysBetween(today, t.start) - 1 <= rule.triggerDays,
      );
    case "not_started_but_should_be":
      return leaves.filter((t) => t.effectiveStatus === "not_started" && t.start <= today);
    case "status_is":
      return leaves.filter((t) => t.effectiveStatus === rule.triggerStatus);
    default:
      return [];
  }
}

/**
 * Runs one rule. `dryRun` reports what would happen without sending or
 * recording anything — used by the preview in the UI.
 */
export async function runRule(
  rule: AutomationRule,
  bundle: ProjectBundleData,
  opts: { dryRun?: boolean; today?: string } = {},
): Promise<RuleOutcome> {
  const today = opts.today ?? todayISO();
  const dryRun = Boolean(opts.dryRun);
  const matched = matchTasks(rule, bundle, today);
  const outcome: RuleOutcome = {
    ruleId: rule.id,
    ruleName: rule.name,
    projectId: rule.projectId,
    matched: matched.length,
    sent: 0,
    skipped: 0,
    recipients: [],
    errors: [],
  };

  if (!matched.length) {
    if (!dryRun) markAutomationRun(rule.id);
    return outcome;
  }

  const emailByResource = new Map(bundle.resources.map((r) => [r.id, r]));
  const headline = `${describeRule(rule)} on ${bundle.project.name}.`;

  if (rule.action === "email_owner") {
    // Group the matched tasks by the person who owns them.
    const perPerson = new Map<string, { name: string; email: string; tasks: ScheduledTask[] }>();
    for (const t of matched) {
      for (const rid of t.resourceIds) {
        const r = emailByResource.get(rid);
        if (!r?.email) continue;
        if (!perPerson.has(r.email)) perPerson.set(r.email, { name: r.name, email: r.email, tasks: [] });
        perPerson.get(r.email)!.tasks.push(t);
      }
    }
    if (perPerson.size === 0) {
      outcome.errors.push("Matched tasks have no assignee with an email address.");
    }

    for (const person of perPerson.values()) {
      // One email per person per day per rule, however often the rule runs.
      const fresh = dryRun
        ? person.tasks
        : person.tasks.filter((t) => claimAutomationSend(rule.id, t.id, person.email, today));
      if (!fresh.length) {
        outcome.skipped += person.tasks.length;
        continue;
      }

      outcome.recipients.push(person.email);
      if (dryRun) {
        outcome.sent += 1;
        continue;
      }

      const message = rule.includeButtons
        ? renderTaskUpdateRequest(bundle, person.name, person.email, fresh, today)
        : renderRuleNotification(bundle, rule.name, headline, fresh, today);
      const res = await sendEmail(person.email, message.subject, message.html);
      if (res.sent) outcome.sent += 1;
      else outcome.errors.push(`${person.email}: ${res.error ?? "not sent"}`);
    }
  } else {
    const addresses = (rule.actionEmails ?? "")
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!addresses.length) outcome.errors.push("No email addresses set on this rule.");

    for (const to of addresses) {
      if (!dryRun && !claimAutomationSend(rule.id, null, to, today)) {
        outcome.skipped += 1;
        continue;
      }
      outcome.recipients.push(to);
      if (dryRun) {
        outcome.sent += 1;
        continue;
      }
      const message = renderRuleNotification(bundle, rule.name, headline, matched, today);
      const res = await sendEmail(to, message.subject, message.html);
      if (res.sent) outcome.sent += 1;
      else outcome.errors.push(`${to}: ${res.error ?? "not sent"}`);
    }
  }

  if (!dryRun) {
    markAutomationRun(rule.id);
    if (outcome.sent > 0) {
      logActivity({
        projectId: rule.projectId,
        actor: "automation",
        message: `Rule "${rule.name}" matched ${outcome.matched} task(s) and emailed ${outcome.sent} recipient(s)`,
      });
    }
  }
  return outcome;
}

/** Runs every enabled rule across every project. This is what the scheduler calls. */
export async function runAllRules(today = todayISO()): Promise<RuleOutcome[]> {
  const rules = listEnabledAutomations();
  const projectIds = new Set(rules.map((r) => r.projectId));
  const bundles = new Map<string, ProjectBundleData>();
  for (const id of projectIds) {
    const b = loadProject(id);
    if (b) bundles.set(id, b);
  }

  const results: RuleOutcome[] = [];
  for (const rule of rules) {
    const bundle = bundles.get(rule.projectId);
    if (!bundle) continue;
    results.push(await runRule(rule, bundle, { today }));
  }
  return results;
}

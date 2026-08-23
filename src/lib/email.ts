// Outbound email. Uses Resend when RESEND_API_KEY is present; otherwise it
// falls back to "preview mode", which returns the rendered HTML instead of
// sending, so the feature is usable before any account is set up.

import { Resend } from "resend";
import { createUpdateToken } from "./db";
import { formatDate } from "./calendar";
import type { ProjectBundle } from "./projectData";
import type { ProjectBundleData, ScheduledTask } from "./types";

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

const BRAND = "#1f3864";
const CRITICAL = "#c00000";

function button(href: string, label: string, colour: string) {
  // Table-wrapped so it survives Outlook.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;margin:0 6px 6px 0;">
    <tr><td style="background:${colour};border-radius:6px;">
      <a href="${href}" style="display:inline-block;padding:9px 16px;font-family:Segoe UI,Arial,sans-serif;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a>
    </td></tr></table>`;
}

function shell(title: string, body: string, footer: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f6fa;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif;">
    <tr><td style="background:${BRAND};padding:18px 24px;color:#ffffff;font-size:17px;font-weight:600;">${title}</td></tr>
    <tr><td style="padding:24px;color:#1f2937;font-size:14px;line-height:1.55;">${body}</td></tr>
    <tr><td style="padding:14px 24px;background:#f9fafb;color:#6b7280;font-size:11px;border-top:1px solid #e5e7eb;">${footer}</td></tr>
  </table>
</td></tr></table></body></html>`;
}

function statusChip(t: ScheduledTask, today: string) {
  if (t.rolledPercentComplete >= 100) return `<span style="color:#15803d;font-weight:600;">Complete</span>`;
  if (t.finish < today) return `<span style="color:${CRITICAL};font-weight:600;">Overdue</span>`;
  if (t.isCritical) return `<span style="color:${CRITICAL};font-weight:600;">Critical path</span>`;
  return `<span style="color:#374151;">On plan</span>`;
}

/** Personalised "how is your task going?" email with one-click reply buttons. */
export function renderTaskUpdateRequest(
  bundle: ProjectBundle,
  recipientName: string,
  recipientEmail: string,
  tasks: ScheduledTask[],
  today: string,
) {
  const base = appUrl();
  const rows = tasks
    .map((t) => {
      const token = createUpdateToken({
        projectId: bundle.project.id,
        taskId: t.id,
        recipientEmail,
        action: "task_update",
      });
      const link = (choice: string) => `${base}/r/${token.token}?choice=${choice}`;
      return `<tr><td style="padding:14px 0;border-bottom:1px solid #e5e7eb;">
        <div style="font-weight:600;font-size:14px;">${t.wbs} &nbsp;${escapeHtml(t.name)}</div>
        <div style="color:#6b7280;font-size:12px;margin:4px 0 10px;">
          ${formatDate(t.start)} &rarr; ${formatDate(t.finish)} &middot; ${t.duration} working day${t.duration === 1 ? "" : "s"}
          &middot; ${t.rolledPercentComplete}% done &middot; ${statusChip(t, today)}
        </div>
        ${button(link("complete"), "Mark complete", "#15803d")}
        ${button(link("on_track"), "On track", BRAND)}
        ${button(link("delayed"), "Running late", CRITICAL)}
      </td></tr>`;
    })
    .join("");

  const body = `<p>Hello ${escapeHtml(recipientName)},</p>
    <p>Here are your open items on <strong>${escapeHtml(bundle.project.name)}</strong>. One click on a button below updates the plan — no login needed.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="margin-top:22px;">${button(`${base}/project/${bundle.project.id}`, "Open the full plan", "#374151")}</p>`;

  return {
    subject: `${bundle.project.name} — your tasks need an update`,
    html: shell("Task update requested", body, "Buttons expire after 14 days. Sent by EaaS Project Management."),
  };
}

/** Broadcast summary of where the project stands. */
export function renderProjectDigest(bundle: ProjectBundle, today: string) {
  const base = appUrl();
  const { schedule, project } = bundle;
  const leaves = schedule.tasks.filter((t) => !t.isSummary);
  const overdue = leaves.filter((t) => t.finish < today && t.rolledPercentComplete < 100);
  const upcoming = leaves
    .filter((t) => t.rolledPercentComplete < 100 && t.start >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 8);
  const slipping = leaves.filter((t) => (t.finishVariance ?? 0) > 0);

  const stat = (label: string, value: string | number, colour = "#111827") =>
    `<td style="padding:10px 14px;background:#f3f4f6;border-radius:8px;">
       <div style="font-size:20px;font-weight:700;color:${colour};">${value}</div>
       <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">${label}</div>
     </td><td style="width:8px;"></td>`;

  const list = (title: string, items: ScheduledTask[], colour: string) =>
    items.length
      ? `<h3 style="margin:22px 0 8px;font-size:13px;color:${colour};text-transform:uppercase;letter-spacing:.05em;">${title}</h3>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items
           .map(
             (t) => `<tr>
               <td style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
                 <strong>${t.wbs}</strong> ${escapeHtml(t.name)}
                 <span style="color:#6b7280;"> — ${formatDate(t.finish)}${
                   t.resourceNames.length ? ` · ${escapeHtml(t.resourceNames.join(", "))}` : ""
                 }</span>
               </td></tr>`,
           )
           .join("")}</table>`
      : "";

  const overallPct = schedule.tasks.filter((t) => t.level === 0);
  const pct =
    overallPct.length > 0
      ? Math.round(
          overallPct.reduce((a, t) => a + t.rolledPercentComplete * Math.max(1, t.duration), 0) /
            overallPct.reduce((a, t) => a + Math.max(1, t.duration), 0),
        )
      : 0;

  const body = `<p>Status of <strong>${escapeHtml(project.name)}</strong> as at ${formatDate(today)}.</p>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      ${stat("Complete", `${pct}%`)}
      ${stat("Finish", formatDate(schedule.projectFinish))}
      ${stat("Overdue", overdue.length, overdue.length ? CRITICAL : "#111827")}
      ${stat("Slipping", slipping.length, slipping.length ? CRITICAL : "#111827")}
    </tr></table>
    ${list("Overdue", overdue.slice(0, 8), CRITICAL)}
    ${list("Coming up", upcoming, BRAND)}
    <p style="margin-top:24px;">
      ${button(`${base}/project/${project.id}`, "Open the plan", BRAND)}
      ${button(`${base}/api/projects/${project.id}/export/xlsx`, "Download Excel", "#374151")}
    </p>`;

  return {
    subject: `${project.name} — status update (${formatDate(today)})`,
    html: shell("Project status update", body, "Sent by EaaS Project Management."),
  };
}

/** Plain notification listing the tasks an automation rule matched. */
export function renderRuleNotification(
  bundle: ProjectBundleData,
  ruleName: string,
  headline: string,
  tasks: ScheduledTask[],
  today: string,
) {
  const base = appUrl();
  const rows = tasks
    .map(
      (t) => `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
        <strong>${t.wbs}</strong> ${escapeHtml(t.name)}
        <div style="color:#6b7280;font-size:12px;margin-top:2px;">
          ${formatDate(t.start)} &rarr; ${formatDate(t.finish)} &middot; ${t.rolledPercentComplete}% done
          &middot; ${statusChip(t, today)}
          ${t.resourceNames.length ? ` &middot; ${escapeHtml(t.resourceNames.join(", "))}` : ""}
        </div></td></tr>`,
    )
    .join("");

  const body = `<p>${escapeHtml(headline)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <p style="margin-top:22px;">${button(`${base}/project/${bundle.project.id}`, "Open the plan", BRAND)}</p>`;

  return {
    subject: `${bundle.project.name} — ${ruleName}`,
    html: shell(ruleName, body, "Sent automatically by EaaS Project Management."),
  };
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export interface SendResult {
  to: string;
  sent: boolean;
  error?: string;
  previewHtml?: string;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  if (!isEmailConfigured()) {
    return { to, sent: false, error: "Preview only — RESEND_API_KEY is not set.", previewHtml: html };
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.EMAIL_FROM ?? "Project Updates <onboarding@resend.dev>";
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) return { to, sent: false, error: error.message };
    return { to, sent: true };
  } catch (e) {
    return { to, sent: false, error: e instanceof Error ? e.message : "Unknown send failure" };
  }
}

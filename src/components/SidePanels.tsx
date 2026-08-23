"use client";

import { useState } from "react";
import { describeRule } from "@/lib/ruleText";
import { STATUS_ORDER, STATUS_TOKENS } from "./statusTokens";
import type {
  AutomationRule,
  AutomationTrigger,
  ProjectBundleData,
  ScheduledTask,
  TaskStatus,
} from "@/lib/types";

export type Panel = null | "team" | "email" | "links" | "settings" | "share" | "automations";

export const PANEL_TITLES: Record<Exclude<Panel, null>, string> = {
  team: "Team members",
  email: "Send an update",
  links: "Task links",
  settings: "Working calendar",
  share: "Share this plan",
  automations: "Automation rules",
};

interface Props {
  panel: Exclude<Panel, null>;
  bundle: ProjectBundleData;
  selectedTask?: ScheduledTask;
  onClose: () => void;
  onBundle: (b: ProjectBundleData) => void;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}

const input =
  "w-full rounded-lg border border-slate-300 px-2 py-1.5 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10";

export default function SidePanel({
  panel,
  bundle,
  selectedTask,
  onClose,
  onBundle,
  onError,
  onNotice,
}: Props) {
  const { project, resources, assignments, dependencies, schedule } = bundle;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [rate, setRate] = useState("0");
  const [preview, setPreview] = useState<string | null>(null);

  const call = async (url: string, method: string, body?: unknown) => {
    try {
      onError(null);
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      if (json.bundle) onBundle(json.bundle);
      return json;
    } catch (e) {
      onError(e instanceof Error ? e.message : "Request failed");
      return null;
    }
  };

  return (
    <aside
      className={`flex shrink-0 flex-col border-l border-slate-200 bg-white shadow-xl shadow-slate-900/5 ${
        panel === "email" ? "w-[680px]" : "w-[26rem]"
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{PANEL_TITLES[panel]}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 text-[13px]">
        {panel === "team" && (
          <div className="space-y-4">
            <div className="space-y-2">
              {resources.length === 0 && <p className="text-slate-500">No team members yet.</p>}
              {resources.map((r) => (
                <div key={r.id} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{r.name}</p>
                      <p className="text-[12px] text-slate-500">
                        {r.role || "—"} · {r.email || "no email"} · {r.dayRate ? `${r.dayRate}/day` : "no rate"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => call(`/api/resources/${r.id}`, "DELETE")}
                      className="text-[12px] text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                await call(`/api/projects/${project.id}/resources`, "POST", {
                  name,
                  email: email || null,
                  role: role || null,
                  dayRate: Number(rate) || 0,
                });
                setName("");
                setEmail("");
                setRole("");
                setRate("0");
              }}
              className="space-y-2 rounded-lg bg-slate-50 p-3"
            >
              <p className="text-[12px] font-semibold text-slate-700">Add someone</p>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={input} />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (needed for update emails)"
                className={input}
              />
              <div className="flex gap-2">
                <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" className={input} />
                <input
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="Day rate"
                  type="number"
                  className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
                />
              </div>
              <button type="submit" className="w-full rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white shadow-sm transition hover:bg-slate-800">
                Add
              </button>
            </form>

            {selectedTask && !selectedTask.isSummary && (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 text-[12px] font-semibold text-slate-700">Assign to “{selectedTask.name}”</p>
                {resources.map((r) => {
                  const on = assignments.some((a) => a.taskId === selectedTask.id && a.resourceId === r.id);
                  return (
                    <label key={r.id} className="flex items-center gap-2 py-0.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const current = assignments
                            .filter((a) => a.taskId === selectedTask.id)
                            .map((a) => a.resourceId);
                          const next = on ? current.filter((x) => x !== r.id) : [...current, r.id];
                          call(`/api/tasks/${selectedTask.id}/assignments`, "PUT", { resourceIds: next });
                        }}
                      />
                      {r.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {panel === "links" && (
          <div className="space-y-3">
            <p className="text-slate-500">
              Select two or more rows in the grid and press <strong>Link</strong> to chain them finish-to-start.
            </p>
            {dependencies.length === 0 && <p className="text-slate-400">No links yet.</p>}
            {dependencies.map((d) => {
              const p = schedule.tasks.find((t) => t.id === d.predecessorId);
              const s = schedule.tasks.find((t) => t.id === d.successorId);
              return (
                <div key={d.id} className="flex items-center justify-between rounded border border-slate-200 p-2">
                  <span className="truncate">
                    <strong>{p?.wbs}</strong> {p?.name} → <strong>{s?.wbs}</strong> {s?.name}
                    <span className="ml-1 text-slate-500">
                      ({d.type}
                      {d.lag ? `${d.lag > 0 ? "+" : ""}${d.lag}d` : ""})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => call(`/api/dependencies/${d.id}`, "DELETE")}
                    className="ml-2 shrink-0 text-[12px] text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {panel === "settings" && (
          <CalendarPanel bundle={bundle} onSave={(body) => call(`/api/projects/${project.id}`, "PATCH", body)} />
        )}

        {panel === "share" && (
          <SharePanel bundle={bundle} call={call} onNotice={onNotice} />
        )}

        {panel === "automations" && (
          <AutomationsPanel bundle={bundle} call={call} onNotice={onNotice} />
        )}

        {panel === "email" && (
          <div className="space-y-3">
            <p className="text-slate-600">
              Update emails include one-click buttons — <em>Mark complete</em>, <em>On track</em> and{" "}
              <em>Running late</em> — that write straight back into this plan. No login needed for the recipient.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  const r = await call(`/api/projects/${project.id}/email`, "POST", {
                    type: "task_updates",
                    preview: true,
                  });
                  if (r?.html) setPreview(r.html);
                }}
                className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-300 ring-inset transition hover:bg-slate-50"
              >
                Preview task request
              </button>
              <button
                type="button"
                onClick={async () => {
                  const r = await call(`/api/projects/${project.id}/email`, "POST", {
                    type: "digest",
                    preview: true,
                  });
                  if (r?.html) setPreview(r.html);
                }}
                className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-300 ring-inset transition hover:bg-slate-50"
              >
                Preview status digest
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  const r = await call(`/api/projects/${project.id}/email`, "POST", { type: "task_updates" });
                  if (r)
                    onNotice(
                      r.configured
                        ? `Task update emails sent to ${r.sent} of ${r.attempted} recipient(s).`
                        : "Email is in preview mode — add RESEND_API_KEY to .env.local to send for real.",
                    );
                }}
                className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                Send task requests
              </button>
              <button
                type="button"
                onClick={async () => {
                  const r = await call(`/api/projects/${project.id}/email`, "POST", { type: "digest" });
                  if (r)
                    onNotice(
                      r.configured
                        ? `Status digest sent to ${r.sent} of ${r.attempted} recipient(s).`
                        : "Email is in preview mode — add RESEND_API_KEY to .env.local to send for real.",
                    );
                }}
                className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                Send status digest
              </button>
            </div>
            {preview && (
              <iframe
                title="Email preview"
                srcDoc={preview}
                className="h-[520px] w-full rounded border border-slate-300"
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ Share ---

function SharePanel({
  bundle,
  call,
  onNotice,
}: {
  bundle: ProjectBundleData;
  call: (url: string, method: string, body?: unknown) => Promise<Record<string, unknown> | null>;
  onNotice: (m: string | null) => void;
}) {
  const [label, setLabel] = useState("");
  // This panel only ever renders after a click, so the browser is present and
  // there is no server-rendered markup to mismatch against.
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="space-y-4">
      <p className="text-slate-600">
        A share link shows this plan to anyone who has it — Gantt, board, calendar and dashboard — but nothing
        can be edited. Useful for the wider team and for clients before logins exist.
      </p>
      <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800 ring-1 ring-amber-200">
        Anyone with the link can view the plan, including task names, dates and who is assigned. Share it the
        way you would share a document link, and revoke it when it is no longer needed.
      </p>

      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="What is this link for? e.g. Client view"
          className={input}
        />
        <button
          type="button"
          onClick={async () => {
            await call(`/api/projects/${bundle.project.id}/share`, "POST", { label: label || null });
            setLabel("");
            onNotice("Share link created.");
          }}
          className="w-full rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white shadow-sm transition hover:bg-slate-800"
        >
          Create a share link
        </button>
      </div>

      {bundle.shareLinks.length === 0 ? (
        <p className="text-slate-400">No active links.</p>
      ) : (
        <ul className="space-y-2">
          {bundle.shareLinks.map((l) => {
            const url = `${origin}/share/${l.token}`;
            return (
              <li key={l.token} className="rounded-lg border border-slate-200 p-2.5">
                <p className="font-medium text-slate-800">{l.label || "Untitled link"}</p>
                <code className="mt-1 block truncate rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                  {url}
                </code>
                <div className="mt-2 flex gap-3 text-[12px]">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(url);
                      onNotice("Link copied to the clipboard.");
                    }}
                    className="text-blue-700 hover:underline"
                  >
                    Copy
                  </button>
                  <a href={url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => call(`/api/projects/${bundle.project.id}/share?token=${l.token}`, "DELETE")}
                    className="ml-auto text-red-600 hover:underline"
                  >
                    Revoke
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[12px] text-slate-500">
        Links point at <code>APP_URL</code> when sent by email, so make sure that setting matches an address
        your team can actually reach.
      </p>
    </div>
  );
}

// ------------------------------------------------------------ Automations ---

const TRIGGER_OPTIONS: { value: AutomationTrigger; label: string; needsDays: boolean }[] = [
  { value: "due_in_days", label: "A task is due within N days", needsDays: true },
  { value: "overdue", label: "A task is overdue", needsDays: false },
  { value: "starting_in_days", label: "A task starts within N days", needsDays: true },
  { value: "not_started_but_should_be", label: "A task should have started but hasn't", needsDays: false },
  { value: "status_is", label: "A task has a particular status", needsDays: false },
];

function AutomationsPanel({
  bundle,
  call,
  onNotice,
}: {
  bundle: ProjectBundleData;
  call: (url: string, method: string, body?: unknown) => Promise<Record<string, unknown> | null>;
  onNotice: (m: string | null) => void;
}) {
  const [trigger, setTrigger] = useState<AutomationTrigger>("due_in_days");
  const [days, setDays] = useState("3");
  const [status, setStatus] = useState<TaskStatus>("blocked");
  const [action, setAction] = useState<"email_owner" | "email_addresses">("email_owner");
  const [emails, setEmails] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [buttons, setButtons] = useState(true);

  const needsDays = TRIGGER_OPTIONS.find((t) => t.value === trigger)?.needsDays ?? false;

  const create = async () => {
    const r = await call(`/api/projects/${bundle.project.id}/automations`, "POST", {
      name: ruleName || TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label,
      trigger,
      triggerDays: Number(days) || 0,
      triggerStatus: trigger === "status_is" ? status : null,
      action,
      actionEmails: action === "email_addresses" ? emails : null,
      includeButtons: buttons,
    });
    if (r) {
      setRuleName("");
      setEmails("");
      onNotice("Rule created. Use Test to see what it would do.");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-600">
        Rules run when you press <strong>Run now</strong>, or automatically if you point a scheduler at{" "}
        <code className="rounded bg-slate-100 px-1">/api/automations/run</code> once a morning. The README
        explains how to set that up on Windows.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={async () => {
            const res = await fetch("/api/automations/run", { method: "POST" });
            const json = await res.json();
            onNotice(
              `Ran ${json.rules ?? 0} rule(s) — ${json.totalSent ?? 0} email(s) sent. Emails only actually leave if RESEND_API_KEY is set.`,
            );
          }}
          className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-medium text-white shadow-sm transition hover:bg-slate-800"
        >
          Run all rules now
        </button>
      </div>

      <ul className="space-y-2">
        {bundle.automations.length === 0 && <p className="text-slate-400">No rules yet.</p>}
        {bundle.automations.map((rule) => (
          <RuleRow key={rule.id} rule={rule} call={call} onNotice={onNotice} />
        ))}
      </ul>

      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <p className="text-[12px] font-semibold text-slate-700">New rule</p>
        <input
          value={ruleName}
          onChange={(e) => setRuleName(e.target.value)}
          placeholder="Name (optional)"
          className={input}
        />

        <label className="block text-[12px] font-medium text-slate-600">
          When
          <select
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}
            className={`mt-1 ${input}`}
          >
            {TRIGGER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {needsDays && (
          <label className="block text-[12px] font-medium text-slate-600">
            N (working days)
            <input
              type="number"
              min={0}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={`mt-1 ${input}`}
            />
          </label>
        )}

        {trigger === "status_is" && (
          <label className="block text-[12px] font-medium text-slate-600">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className={`mt-1 ${input}`}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_TOKENS[s].label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-[12px] font-medium text-slate-600">
          Then email
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as "email_owner" | "email_addresses")}
            className={`mt-1 ${input}`}
          >
            <option value="email_owner">The person the task is assigned to</option>
            <option value="email_addresses">Specific addresses</option>
          </select>
        </label>

        {action === "email_addresses" && (
          <input
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="you@example.com, lead@example.com"
            className={input}
          />
        )}

        {action === "email_owner" && (
          <label className="flex items-center gap-2 text-[12px] text-slate-600">
            <input type="checkbox" checked={buttons} onChange={(e) => setButtons(e.target.checked)} />
            Include the one-click update buttons
          </label>
        )}

        <button type="button" onClick={create} className="w-full rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white shadow-sm transition hover:bg-slate-800">
          Create rule
        </button>
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  call,
  onNotice,
}: {
  rule: AutomationRule;
  call: (url: string, method: string, body?: unknown) => Promise<Record<string, unknown> | null>;
  onNotice: (m: string | null) => void;
}) {
  return (
    <li className="rounded-lg border border-slate-200 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{rule.name}</p>
          <p className="text-[12px] text-slate-500">
            {describeRule(rule)} → {rule.action === "email_owner" ? "the assignee" : rule.actionEmails}
          </p>
          {rule.lastRunAt && (
            <p className="text-[11px] text-slate-400">Last run {new Date(rule.lastRunAt).toLocaleString()}</p>
          )}
        </div>
        <label className="flex shrink-0 items-center gap-1 text-[12px] text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(rule.enabled)}
            onChange={(e) => call(`/api/automations/${rule.id}`, "PATCH", { enabled: e.target.checked ? 1 : 0 })}
          />
          On
        </label>
      </div>
      <div className="mt-2 flex gap-3 text-[12px]">
        <button
          type="button"
          onClick={async () => {
            const r = await fetch(`/api/automations/${rule.id}?dryRun=1`, { method: "POST" });
            const json = await r.json();
            const o = json.outcome;
            onNotice(
              `“${rule.name}” matches ${o.matched} task(s) and would email ${o.recipients.length} recipient(s)${
                o.errors.length ? ` — ${o.errors.join("; ")}` : ""
              }.`,
            );
          }}
          className="text-blue-700 hover:underline"
        >
          Test
        </button>
        <button
          type="button"
          onClick={async () => {
            const r = await call(`/api/automations/${rule.id}`, "POST");
            const o = r?.outcome as { matched: number; sent: number } | undefined;
            onNotice(`“${rule.name}” matched ${o?.matched ?? 0} task(s), sent ${o?.sent ?? 0} email(s).`);
          }}
          className="text-blue-700 hover:underline"
        >
          Run now
        </button>
        <button
          type="button"
          onClick={() => call(`/api/automations/${rule.id}`, "DELETE")}
          className="ml-auto text-red-600 hover:underline"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

// --------------------------------------------------------------- Calendar ---

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CalendarPanel({
  bundle,
  onSave,
}: {
  bundle: ProjectBundleData;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [workingDays, setWorkingDays] = useState<number[]>(bundle.project.workingDays);
  const [startDate, setStartDate] = useState(bundle.project.startDate);
  const [holidays, setHolidays] = useState(bundle.project.holidays.join("\n"));

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-[12px] font-semibold text-slate-700">Project start</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className={`mt-1 ${input}`}
        />
      </label>

      <div>
        <span className="text-[12px] font-semibold text-slate-700">Working days</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {DAY_LABELS.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() =>
                setWorkingDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort()))
              }
              className={`rounded px-2 py-1 text-[12px] ring-1 ring-inset ${
                workingDays.includes(i)
                  ? "bg-slate-900 text-white ring-slate-900"
                  : "bg-white text-slate-600 ring-slate-300"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="text-[12px] font-semibold text-slate-700">Holidays — one date per line (yyyy-mm-dd)</span>
        <textarea
          rows={6}
          value={holidays}
          onChange={(e) => setHolidays(e.target.value)}
          className={`mt-1 font-mono text-[12px] ${input}`}
        />
      </label>

      <button
        type="button"
        onClick={() =>
          onSave({
            startDate,
            workingDays,
            holidays: holidays
              .split(/\s*[\n,]\s*/)
              .map((s) => s.trim())
              .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
          })
        }
        className="w-full rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white shadow-sm transition hover:bg-slate-800"
      >
        Save calendar
      </button>
    </div>
  );
}

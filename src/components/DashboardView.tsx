"use client";

import { useMemo, useState } from "react";
import { WorkCalendar, addDays, calendarDaysBetween, formatDate, todayISO } from "@/lib/calendar";
import { INK, SEQ_BLUE, STATUS_ORDER, STATUS_TOKENS } from "./statusTokens";
import type { ProjectBundleData, ScheduledTask } from "@/lib/types";

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const colour = tone === "bad" ? "#d03b3b" : tone === "good" ? "#0ca30c" : INK.primary;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color: colour }}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[12px] text-slate-500">{sub}</p>}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Cumulative planned completion, as a percentage of total planned work. */
function progressCurve(tasks: ScheduledTask[], cal: WorkCalendar, from: string, to: string) {
  const leaves = tasks.filter((t) => !t.isSummary);
  const total = leaves.reduce((a, t) => a + Math.max(t.duration, 1), 0);
  if (!total) return [];

  const spanDays = Math.max(1, calendarDaysBetween(from, to));
  const step = Math.max(1, Math.ceil(spanDays / 90));
  const points: { date: string; planned: number }[] = [];

  for (let d = 0; d <= spanDays; d += step) {
    const date = addDays(from, d);
    let done = 0;
    for (const t of leaves) {
      const dur = Math.max(t.duration, 1);
      if (calendarDaysBetween(t.finish, date) >= 0) done += dur;
      else if (calendarDaysBetween(t.start, date) >= 0) {
        done += Math.min(dur, cal.workingDaysBetween(t.start, date));
      }
    }
    points.push({ date, planned: Math.round((done / total) * 100) });
  }
  if (points[points.length - 1]?.date !== to) points.push({ date: to, planned: 100 });
  return points;
}

export default function DashboardView({
  bundle,
  onSelect,
}: {
  bundle: ProjectBundleData;
  onSelect?: (taskId: string) => void;
}) {
  const today = todayISO();
  const { schedule, project, resources, assignments } = bundle;
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null);

  const cal = useMemo(
    () => new WorkCalendar(project.workingDays, project.holidays),
    [project.workingDays, project.holidays],
  );

  const leaves = schedule.tasks.filter((t) => !t.isSummary);
  const roots = schedule.tasks.filter((t) => t.level === 0);
  const overallPct = roots.length
    ? Math.round(
        roots.reduce((a, t) => a + t.rolledPercentComplete * Math.max(1, t.duration), 0) /
          roots.reduce((a, t) => a + Math.max(1, t.duration), 0),
      )
    : 0;

  const overdue = leaves
    .filter((t) => t.finish < today && t.effectiveStatus !== "done")
    .sort((a, b) => a.finish.localeCompare(b.finish));
  const slipping = leaves.filter((t) => (t.finishVariance ?? 0) > 0);
  const upcoming = leaves
    .filter((t) => t.effectiveStatus !== "done" && t.start >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 8);
  const blocked = leaves.filter((t) => t.effectiveStatus === "blocked");

  const statusCounts = STATUS_ORDER.map((key) => ({
    key,
    ...STATUS_TOKENS[key],
    count: leaves.filter((t) => t.effectiveStatus === key).length,
  }));
  const totalLeaves = Math.max(1, leaves.length);

  const workload = resources
    .map((r) => {
      const mine = assignments.filter((a) => a.resourceId === r.id).map((a) => a.taskId);
      const tasks = leaves.filter((t) => mine.includes(t.id));
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        days: tasks.reduce((a, t) => a + t.duration, 0),
        open: tasks.filter((t) => t.effectiveStatus !== "done").length,
        late: tasks.filter((t) => t.finish < today && t.effectiveStatus !== "done").length,
      };
    })
    .sort((a, b) => b.days - a.days);
  const maxDays = Math.max(1, ...workload.map((w) => w.days));

  // ---- Planned progress curve -----------------------------------------------
  const curve = useMemo(
    () => progressCurve(schedule.tasks, cal, schedule.projectStart, schedule.projectFinish),
    [schedule.tasks, schedule.projectStart, schedule.projectFinish, cal],
  );

  const W = 560;
  const H = 200;
  const PAD = { l: 34, r: 12, t: 10, b: 24 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const xAt = (i: number) => PAD.l + (curve.length <= 1 ? 0 : (i / (curve.length - 1)) * plotW);
  const yAt = (pct: number) => PAD.t + plotH - (pct / 100) * plotH;
  const line = curve.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.planned).toFixed(1)}`).join(" ");

  const todayIdx = curve.findIndex((p) => p.date >= today);
  const plannedNow = todayIdx >= 0 ? curve[todayIdx].planned : curve.length ? 100 : 0;
  const aheadBehind = overallPct - plannedNow;

  const hoverPoint = hover ? curve[hover.i] : null;

  return (
    <div className="h-full overflow-auto bg-slate-100 p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Complete" value={`${overallPct}%`} sub={`${plannedNow}% planned by today`} />
          <Tile
            label="Against plan"
            value={`${aheadBehind >= 0 ? "+" : ""}${aheadBehind}%`}
            sub={aheadBehind >= 0 ? "ahead of plan" : "behind plan"}
            tone={aheadBehind >= 0 ? "good" : "bad"}
          />
          <Tile label="Finish" value={formatDate(schedule.projectFinish)} sub={`${schedule.totalDuration} working days`} />
          <Tile label="Overdue" value={overdue.length} sub="past their finish date" tone={overdue.length ? "bad" : "good"} />
          <Tile
            label="Slipping"
            value={slipping.length}
            sub="later than baseline"
            tone={slipping.length ? "bad" : "good"}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title="Planned progress"
            hint="Cumulative share of planned work, weighted by duration. The dot is where you actually are."
          >
            {curve.length > 1 ? (
              <>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="w-full"
                  role="img"
                  aria-label="Planned progress over time"
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = ((e.clientX - rect.left) / rect.width) * W;
                    const i = Math.round(((x - PAD.l) / plotW) * (curve.length - 1));
                    if (i >= 0 && i < curve.length) setHover({ x, i });
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  {[0, 25, 50, 75, 100].map((g) => (
                    <g key={g}>
                      <line x1={PAD.l} x2={W - PAD.r} y1={yAt(g)} y2={yAt(g)} stroke={INK.grid} strokeWidth={1} />
                      <text x={PAD.l - 6} y={yAt(g) + 3} textAnchor="end" fontSize={9} fill={INK.muted}>
                        {g}%
                      </text>
                    </g>
                  ))}

                  {todayIdx >= 0 && (
                    <line
                      x1={xAt(todayIdx)}
                      x2={xAt(todayIdx)}
                      y1={PAD.t}
                      y2={PAD.t + plotH}
                      stroke="#d03b3b"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                  )}

                  <path d={line} fill="none" stroke={SEQ_BLUE.fill} strokeWidth={2} strokeLinejoin="round" />

                  {todayIdx >= 0 && (
                    <>
                      <circle cx={xAt(todayIdx)} cy={yAt(overallPct)} r={5} fill="#fff" stroke={INK.primary} strokeWidth={2} />
                      <text
                        x={xAt(todayIdx) + 8}
                        y={yAt(overallPct) - 6}
                        fontSize={10}
                        fill={INK.primary}
                        fontWeight={600}
                      >
                        actual {overallPct}%
                      </text>
                    </>
                  )}

                  {hoverPoint && (
                    <>
                      <line
                        x1={xAt(hover!.i)}
                        x2={xAt(hover!.i)}
                        y1={PAD.t}
                        y2={PAD.t + plotH}
                        stroke={INK.axis}
                        strokeWidth={1}
                      />
                      <circle cx={xAt(hover!.i)} cy={yAt(hoverPoint.planned)} r={4} fill={SEQ_BLUE.fill} stroke="#fff" strokeWidth={2} />
                    </>
                  )}

                  <text x={PAD.l} y={H - 6} fontSize={9} fill={INK.muted}>
                    {formatDate(schedule.projectStart)}
                  </text>
                  <text x={W - PAD.r} y={H - 6} fontSize={9} fill={INK.muted} textAnchor="end">
                    {formatDate(schedule.projectFinish)}
                  </text>
                </svg>
                <p className="mt-1 h-4 text-[12px] text-slate-600">
                  {hoverPoint
                    ? `${formatDate(hoverPoint.date)} — ${hoverPoint.planned}% planned complete`
                    : "Hover the chart for any date."}
                </p>
              </>
            ) : (
              <p className="py-8 text-center text-[13px] text-slate-400">Not enough tasks to plot a curve yet.</p>
            )}
          </Panel>

          <Panel title="Where the work sits" hint={`${leaves.length} deliverable tasks by status.`}>
            <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded">
              {statusCounts
                .filter((s) => s.count > 0)
                .map((s) => (
                  <div
                    key={s.key}
                    title={`${s.label}: ${s.count} task${s.count === 1 ? "" : "s"}`}
                    style={{ width: `${(s.count / totalLeaves) * 100}%`, background: s.colour }}
                    className="flex items-center justify-center text-[10px] font-semibold text-white"
                  >
                    {(s.count / totalLeaves) * 100 > 8 ? s.count : ""}
                  </div>
                ))}
            </div>

            <ul className="mt-3 space-y-1.5">
              {statusCounts.map((s) => (
                <li key={s.key} className="flex items-center gap-2 text-[13px]">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.colour }} />
                  <span aria-hidden style={{ color: s.colour }}>
                    {s.icon}
                  </span>
                  <span className="text-slate-700">{s.label}</span>
                  <span className="ml-auto font-semibold text-slate-900">{s.count}</span>
                  <span className="w-10 text-right text-[12px] text-slate-500">
                    {Math.round((s.count / totalLeaves) * 100)}%
                  </span>
                </li>
              ))}
            </ul>

            {blocked.length > 0 && (
              <p className="mt-3 rounded-md bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700 ring-1 ring-red-200">
                ▲ {blocked.length} task{blocked.length === 1 ? " is" : "s are"} blocked — these need a decision
                before anything downstream can move.
              </p>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Workload by person" hint="Working days assigned across the whole plan.">
            {workload.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-slate-400">No team members added yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {workload.map((w) => (
                  <li key={w.id}>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className="font-medium text-slate-800">
                        {w.name}
                        {w.role && <span className="ml-1.5 text-[11px] text-slate-400">{w.role}</span>}
                      </span>
                      <span className="text-slate-600">
                        {w.days}d
                        <span className="ml-2 text-[11px] text-slate-400">{w.open} open</span>
                        {w.late > 0 && <span className="ml-2 text-[11px] font-semibold text-red-600">{w.late} late</span>}
                      </span>
                    </div>
                    <div
                      className="mt-1 h-2.5 w-full overflow-hidden rounded-full"
                      style={{ background: SEQ_BLUE.track }}
                      title={`${w.name}: ${w.days} working days`}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(w.days / maxDays) * 100}%`, background: SEQ_BLUE.fill }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Needs attention" hint="Overdue first, then what starts next.">
            {overdue.length === 0 && upcoming.length === 0 && (
              <p className="py-6 text-center text-[13px] text-slate-400">Nothing outstanding.</p>
            )}

            {overdue.length > 0 && (
              <>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-red-700 uppercase">
                  Overdue ({overdue.length})
                </p>
                <ul className="mb-4 space-y-1">
                  {overdue.slice(0, 6).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onSelect?.(t.id)}
                        className="w-full rounded px-1.5 py-1 text-left text-[13px] hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-800">{t.name}</span>
                        <span className="ml-2 text-[12px] text-red-600">due {formatDate(t.finish)}</span>
                        {t.resourceNames.length > 0 && (
                          <span className="ml-2 text-[12px] text-slate-500">{t.resourceNames.join(", ")}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {upcoming.length > 0 && (
              <>
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Coming up</p>
                <ul className="space-y-1">
                  {upcoming.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onSelect?.(t.id)}
                        className="w-full rounded px-1.5 py-1 text-left text-[13px] hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-800">{t.name}</span>
                        <span className="ml-2 text-[12px] text-slate-500">starts {formatDate(t.start)}</span>
                        {t.isCritical && <span className="ml-2 text-[11px] font-semibold text-red-600">critical</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

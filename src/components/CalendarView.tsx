"use client";

import { useMemo, useState } from "react";
import { addDays, calendarDaysBetween, parseISO, todayISO, toISO } from "@/lib/calendar";
import { STATUS_TOKENS } from "./statusTokens";
import type { ProjectBundleData, ScheduledTask } from "@/lib/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday of the week containing `iso`. */
function mondayOf(iso: string): string {
  const dow = parseISO(iso).getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

interface Segment {
  task: ScheduledTask;
  startCol: number;
  span: number;
  continuesLeft: boolean;
  continuesRight: boolean;
  lane: number;
}

/** Greedy lane packing so overlapping bars stack instead of colliding. */
function packLanes(segments: Omit<Segment, "lane">[]): Segment[] {
  const laneEnds: number[] = [];
  return segments
    .slice()
    .sort((a, b) => a.startCol - b.startCol || b.span - a.span)
    .map((s) => {
      let lane = laneEnds.findIndex((end) => end <= s.startCol);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = s.startCol + s.span;
      return { ...s, lane };
    });
}

export default function CalendarView({
  bundle,
  onSelect,
}: {
  bundle: ProjectBundleData;
  onSelect?: (taskId: string) => void;
}) {
  const today = todayISO();
  const [anchor, setAnchor] = useState(() => {
    // Open on the month with work in it, not necessarily this month.
    const s = bundle.schedule.projectStart;
    return calendarDaysBetween(s, today) >= 0 && calendarDaysBetween(today, bundle.schedule.projectFinish) >= 0
      ? today
      : s;
  });
  const [showSummaries, setShowSummaries] = useState(false);

  const monthStart = useMemo(() => {
    const d = parseISO(anchor);
    return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12)));
  }, [anchor]);

  const { weeks, monthLabel } = useMemo(() => {
    const d = parseISO(monthStart);
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
    const gridStart = mondayOf(monthStart);
    const monthEnd = addDays(monthStart, daysInMonth - 1);

    const tasks = bundle.schedule.tasks.filter((t) => showSummaries || !t.isSummary);
    const rows: { start: string; segments: Segment[] }[] = [];

    let cursor = gridStart;
    while (calendarDaysBetween(cursor, monthEnd) >= 0) {
      const weekEnd = addDays(cursor, 6);
      const raw = tasks
        .filter(
          (t) => calendarDaysBetween(t.start, weekEnd) >= 0 && calendarDaysBetween(cursor, t.finish) >= 0,
        )
        .map((t) => {
          const startCol = Math.max(0, calendarDaysBetween(cursor, t.start));
          const endCol = Math.min(6, calendarDaysBetween(cursor, t.finish));
          return {
            task: t,
            startCol,
            span: Math.max(1, endCol - startCol + 1),
            continuesLeft: calendarDaysBetween(cursor, t.start) < 0,
            continuesRight: calendarDaysBetween(cursor, t.finish) > 6,
          };
        });
      rows.push({ start: cursor, segments: packLanes(raw) });
      cursor = addDays(cursor, 7);
    }

    return {
      weeks: rows,
      monthLabel: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    };
  }, [monthStart, bundle.schedule.tasks, showSummaries]);

  const shiftMonth = (delta: number) => {
    const d = parseISO(monthStart);
    setAnchor(toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1, 12))));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded-lg px-2.5 py-1 text-[13px] ring-1 ring-slate-300 ring-inset transition hover:bg-slate-50"
        >
          ← Prev
        </button>
        <h2 className="min-w-44 text-center text-sm font-semibold text-slate-900">{monthLabel}</h2>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-lg px-2.5 py-1 text-[13px] ring-1 ring-slate-300 ring-inset transition hover:bg-slate-50"
        >
          Next →
        </button>
        <button
          type="button"
          onClick={() => setAnchor(today)}
          className="rounded-lg px-2.5 py-1 text-[13px] ring-1 ring-slate-300 ring-inset transition hover:bg-slate-50"
        >
          Today
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={showSummaries}
            onChange={(e) => setShowSummaries(e.target.checked)}
          />
          Show phases
        </label>
      </div>

      <div className="grid shrink-0 grid-cols-7 border-b border-slate-200 bg-slate-50">
        {DAY_NAMES.map((d) => (
          <div key={d} className="px-2 py-1.5 text-center text-[11px] font-semibold text-slate-500">
            {d}
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {weeks.map((week) => {
          const lanes = week.segments.length ? Math.max(...week.segments.map((s) => s.lane)) + 1 : 0;
          const bodyHeight = Math.max(30, lanes * 22 + 8);
          return (
            <div key={week.start} className="border-b border-slate-200">
              <div className="grid grid-cols-7">
                {Array.from({ length: 7 }, (_, i) => addDays(week.start, i)).map((iso) => {
                  const d = parseISO(iso);
                  const inMonth = toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12))) === monthStart;
                  const isToday = iso === today;
                  return (
                    <div
                      key={iso}
                      className={`border-r border-slate-100 px-1.5 py-1 text-[11px] ${
                        inMonth ? "text-slate-700" : "bg-slate-50/60 text-slate-300"
                      }`}
                    >
                      <span
                        className={
                          isToday
                            ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-600 font-semibold text-white"
                            : ""
                        }
                      >
                        {d.getUTCDate()}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="relative" style={{ height: bodyHeight }}>
                {week.segments.map((s) => {
                  const token = STATUS_TOKENS[s.task.effectiveStatus];
                  const overdue = s.task.finish < today && s.task.effectiveStatus !== "done";
                  return (
                    <button
                      key={`${s.task.id}-${week.start}`}
                      type="button"
                      onClick={() => onSelect?.(s.task.id)}
                      title={`${s.task.wbs} ${s.task.name}\n${s.task.start} → ${s.task.finish}\n${token.label} · ${s.task.rolledPercentComplete}%`}
                      className="absolute flex items-center gap-1 overflow-hidden px-1.5 text-left text-[11px] font-medium text-white"
                      style={{
                        left: `calc(${(s.startCol / 7) * 100}% + 3px)`,
                        width: `calc(${(s.span / 7) * 100}% - 6px)`,
                        top: s.lane * 22 + 3,
                        height: 18,
                        background: s.task.isSummary ? "#334155" : token.colour,
                        borderRadius: 4,
                        borderTopLeftRadius: s.continuesLeft ? 0 : 4,
                        borderBottomLeftRadius: s.continuesLeft ? 0 : 4,
                        borderTopRightRadius: s.continuesRight ? 0 : 4,
                        borderBottomRightRadius: s.continuesRight ? 0 : 4,
                        outline: overdue ? "2px solid #d03b3b" : undefined,
                        outlineOffset: -2,
                      }}
                    >
                      <span aria-hidden className="shrink-0 opacity-90">
                        {s.task.isMilestone ? "◆" : token.icon}
                      </span>
                      <span className="truncate">{s.task.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-600">
        {Object.values(STATUS_TOKENS).map((t) => (
          <span key={t.label} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: t.colour }} />
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm ring-2 ring-red-600" />
          Overdue
        </span>
      </div>
    </div>
  );
}

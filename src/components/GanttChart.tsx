"use client";

import { useMemo, useRef, useState } from "react";
import { WorkCalendar, addDays, calendarDaysBetween, parseISO, todayISO } from "@/lib/calendar";
import { HEADER_HEIGHT, ROW_HEIGHT } from "./TaskGrid";
import { STATUS_TOKENS } from "./statusTokens";
import type { Dependency, Project, ScheduledTask } from "@/lib/types";

export type Zoom = "day" | "week" | "month";

const DAY_WIDTH: Record<Zoom, number> = { day: 26, week: 11, month: 4 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Props {
  project: Project;
  tasks: ScheduledTask[];
  dependencies: Dependency[];
  selected: string[];
  zoom: Zoom;
  readOnly?: boolean;
  showBaseline: boolean;
  showCritical: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onMoveTask: (id: string, newStart: string) => void;
  onResizeTask: (id: string, newDuration: number) => void;
}

interface DragState {
  taskId: string;
  mode: "move" | "resize";
  startX: number;
  originStart: string;
  originDuration: number;
  deltaDays: number;
}

export default function GanttChart({
  project,
  tasks,
  dependencies,
  selected,
  zoom,
  readOnly,
  showBaseline,
  showCritical,
  onSelect,
  onMoveTask,
  onResizeTask,
}: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const dayWidth = DAY_WIDTH[zoom];
  const today = todayISO();

  const cal = useMemo(
    () => new WorkCalendar(project.workingDays, project.holidays),
    [project.workingDays, project.holidays],
  );

  const { origin, totalDays } = useMemo(() => {
    if (!tasks.length) {
      const o = project.startDate;
      return { origin: addDays(o, -7), totalDays: 60 };
    }
    let min = tasks[0].start;
    let max = tasks[0].finish;
    for (const t of tasks) {
      if (t.start < min) min = t.start;
      if (t.finish > max) max = t.finish;
      if (t.baselineStart && t.baselineStart < min) min = t.baselineStart;
      if (t.baselineFinish && t.baselineFinish > max) max = t.baselineFinish;
    }
    const o = addDays(min, -7);
    return { origin: o, totalDays: Math.max(30, calendarDaysBetween(o, max) + 21) };
  }, [tasks, project.startDate]);

  const x = (iso: string) => calendarDaysBetween(origin, iso) * dayWidth;
  const width = totalDays * dayWidth;

  // ---- Timeline header ------------------------------------------------------
  const ticks = useMemo(() => {
    const majors: { label: string; left: number; width: number }[] = [];
    const minors: { label: string; left: number; width: number; weekend: boolean }[] = [];
    let cursor = origin;
    let majorStart = 0;
    for (let i = 0; i < totalDays; i++) {
      const d = parseISO(cursor);
      if (zoom === "day") {
        minors.push({
          label: String(d.getUTCDate()),
          left: i * dayWidth,
          width: dayWidth,
          weekend: !cal.isWorkingDay(cursor),
        });
      } else if (zoom === "week" && d.getUTCDay() === 1) {
        minors.push({ label: String(d.getUTCDate()), left: i * dayWidth, width: dayWidth * 7, weekend: false });
      }
      const next = addDays(cursor, 1);
      if (parseISO(next).getUTCMonth() !== d.getUTCMonth() || i === totalDays - 1) {
        majors.push({
          label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
          left: majorStart * dayWidth,
          width: (i - majorStart + 1) * dayWidth,
        });
        majorStart = i + 1;
      }
      cursor = next;
    }
    return { majors, minors };
  }, [origin, totalDays, dayWidth, zoom, cal]);

  const rowIndex = new Map(tasks.map((t, i) => [t.id, i]));

  // ---- Dragging -------------------------------------------------------------
  const beginDrag = (e: React.MouseEvent, task: ScheduledTask, mode: "move" | "resize") => {
    if (task.isSummary || readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const state: DragState = {
      taskId: task.id,
      mode,
      startX: e.clientX,
      originStart: task.start,
      originDuration: task.duration,
      deltaDays: 0,
    };
    setDrag(state);

    const move = (ev: MouseEvent) => {
      const delta = Math.round((ev.clientX - state.startX) / dayWidth);
      setDrag({ ...state, deltaDays: delta });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const delta = Math.round((ev.clientX - state.startX) / dayWidth);
      setDrag(null);
      if (delta === 0) return;
      if (mode === "move") {
        onMoveTask(task.id, cal.nextWorkingDay(addDays(state.originStart, delta)));
      } else {
        const next = Math.max(task.isMilestone ? 0 : 1, state.originDuration + delta);
        if (next !== state.originDuration) onResizeTask(task.id, next);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const previewFor = (t: ScheduledTask) => {
    if (!drag || drag.taskId !== t.id || drag.deltaDays === 0) return null;
    if (drag.mode === "move") {
      const s = addDays(drag.originStart, drag.deltaDays);
      return { start: s, duration: drag.originDuration };
    }
    return { start: drag.originStart, duration: Math.max(1, drag.originDuration + drag.deltaDays) };
  };

  // ---- Dependency arrows ----------------------------------------------------
  const arrows = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const out: { d: string; critical: boolean }[] = [];
    for (const dep of dependencies) {
      const from = byId.get(dep.predecessorId);
      const to = byId.get(dep.successorId);
      if (!from || !to) continue;
      const fy = (rowIndex.get(from.id) ?? 0) * ROW_HEIGHT + ROW_HEIGHT / 2;
      const ty = (rowIndex.get(to.id) ?? 0) * ROW_HEIGHT + ROW_HEIGHT / 2;
      const fx = dep.type === "SS" || dep.type === "SF" ? x(from.start) : x(from.finish) + dayWidth;
      const tx = dep.type === "FF" || dep.type === "SF" ? x(to.finish) + dayWidth : x(to.start);
      const gap = 10;
      const path =
        tx >= fx + gap
          ? `M ${fx} ${fy} H ${fx + gap} V ${ty} H ${tx}`
          : `M ${fx} ${fy} H ${fx + gap} V ${(fy + ty) / 2} H ${tx - gap} V ${ty} H ${tx}`;
      out.push({ d: path, critical: from.isCritical && to.isCritical });
    }
    return out;
  }, [dependencies, tasks, dayWidth, origin]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={areaRef} className="relative" style={{ width }}>
      {/* Header */}
      <div
        className="sticky top-0 z-10 border-b border-slate-300 bg-slate-800 text-slate-100"
        style={{ height: HEADER_HEIGHT, width }}
      >
        <div className="relative h-7 border-b border-slate-600">
          {ticks.majors.map((m, i) => (
            <div
              key={i}
              className="absolute flex h-7 items-center justify-center overflow-hidden border-r border-slate-600 text-[11px] font-semibold"
              style={{ left: m.left, width: m.width }}
            >
              {m.width > 46 ? m.label : ""}
            </div>
          ))}
        </div>
        <div className="relative h-7">
          {ticks.minors.map((m, i) => (
            <div
              key={i}
              className={`absolute flex h-7 items-center justify-center border-r border-slate-700 text-[10px] ${
                m.weekend ? "bg-slate-900 text-slate-500" : "text-slate-300"
              }`}
              style={{ left: m.left, width: m.width }}
            >
              {m.width > 14 ? m.label : ""}
            </div>
          ))}
        </div>
      </div>

      {/* Chart body */}
      <div className="relative" style={{ width, height: tasks.length * ROW_HEIGHT }}>
        {/* Non-working day shading */}
        {zoom === "day" &&
          Array.from({ length: totalDays }, (_, i) => addDays(origin, i))
            .map((iso, i) => ({ iso, i }))
            .filter(({ iso }) => !cal.isWorkingDay(iso))
            .map(({ i }) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 bg-slate-100"
                style={{ left: i * dayWidth, width: dayWidth }}
              />
            ))}

        {/* Row separators */}
        {tasks.map((t, i) => (
          <div
            key={t.id}
            className={`absolute left-0 border-b border-slate-100 transition-colors ${
              selected.includes(t.id) ? "bg-blue-50/70" : ""
            }`}
            style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, width }}
          />
        ))}

        {/* Today marker */}
        <div
          className="absolute top-0 bottom-0 z-20 w-px bg-red-500"
          style={{ left: x(today) + dayWidth / 2 }}
          title={`Today — ${today}`}
        />

        {/* Dependency arrows */}
        <svg className="pointer-events-none absolute inset-0 z-10" width={width} height={tasks.length * ROW_HEIGHT}>
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#64748b" />
            </marker>
            <marker id="arrow-crit" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#b91c1c" />
            </marker>
          </defs>
          {arrows.map((a, i) => (
            <path
              key={i}
              d={a.d}
              fill="none"
              stroke={showCritical && a.critical ? "#b91c1c" : "#94a3b8"}
              strokeWidth={1.2}
              markerEnd={showCritical && a.critical ? "url(#arrow-crit)" : "url(#arrow)"}
            />
          ))}
        </svg>

        {/* Bars */}
        {tasks.map((t, i) => {
          const preview = previewFor(t);
          const start = preview?.start ?? t.start;
          const duration = preview?.duration ?? t.duration;
          const left = x(start);
          const barWidth = Math.max(
            dayWidth,
            (calendarDaysBetween(start, cal.finishFor(start, duration)) + 1) * dayWidth,
          );
          const top = i * ROW_HEIGHT;
          const critical = showCritical && t.isCritical;

          return (
            <div key={t.id}>
              {showBaseline && t.baselineStart && t.baselineFinish && (
                <div
                  className="absolute rounded-sm bg-slate-400/70"
                  style={{
                    left: x(t.baselineStart),
                    width: Math.max(3, (calendarDaysBetween(t.baselineStart, t.baselineFinish) + 1) * dayWidth),
                    top: top + ROW_HEIGHT - 9,
                    height: 4,
                  }}
                  title={`Baseline: ${t.baselineStart} → ${t.baselineFinish}`}
                />
              )}

              {t.isMilestone ? (
                <div
                  onMouseDown={(e) => {
                    onSelect(t.id, e.shiftKey);
                    beginDrag(e, t, "move");
                  }}
                  className={`absolute z-10 ${readOnly ? "" : "cursor-move"}`}
                  style={{ left: left + dayWidth / 2 - 7, top: top + 8, width: 14, height: 14 }}
                  title={`${t.name} — ${t.start}`}
                >
                  <div className="h-full w-full rotate-45 bg-purple-700 shadow-sm" />
                </div>
              ) : t.isSummary ? (
                <div
                  className="absolute z-10"
                  style={{ left, width: barWidth, top: top + 10, height: 11 }}
                  title={`${t.name} — ${t.start} → ${t.finish}`}
                >
                  <div className="h-[6px] w-full bg-slate-700" />
                  <div className="absolute -bottom-0 left-0 h-[7px] w-[7px] skew-x-[-20deg] bg-slate-700" />
                  <div className="absolute -bottom-0 right-0 h-[7px] w-[7px] skew-x-[20deg] bg-slate-700" />
                </div>
              ) : (
                <div
                  onMouseDown={(e) => {
                    onSelect(t.id, e.shiftKey);
                    beginDrag(e, t, "move");
                  }}
                  className={`group absolute z-10 rounded shadow-sm ring-1 transition-shadow hover:shadow ${readOnly ? "" : "cursor-move"} ${
                    critical ? "bg-red-600 ring-red-800" : "bg-blue-600 ring-blue-800"
                  } ${selected.includes(t.id) ? "ring-2 ring-offset-1" : ""}`}
                  style={{ left, width: barWidth, top: top + 7, height: 17 }}
                  title={`${t.name}\n${t.start} → ${t.finish}\n${t.duration} working days · ${t.rolledPercentComplete}% · float ${t.totalFloat}d`}
                >
                  <div
                    className={`h-full rounded-l ${critical ? "bg-red-900" : "bg-blue-900"}`}
                    style={{ width: `${t.rolledPercentComplete}%` }}
                  />
                  <div
                    onMouseDown={(e) => beginDrag(e, t, "resize")}
                    className={`absolute top-0 right-0 h-full w-2 cursor-ew-resize ${
                      readOnly ? "hidden" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <div className="mx-auto h-full w-[3px] bg-white/70" />
                  </div>
                  {t.effectiveStatus === "blocked" && (
                    <span
                      className="pointer-events-none absolute -top-[3px] -left-[3px] flex h-[23px] w-[10px] items-center justify-center rounded-l-sm text-[9px] text-white"
                      style={{ background: STATUS_TOKENS.blocked.colour }}
                      title="Blocked"
                      aria-label="Blocked"
                    >
                      ▲
                    </span>
                  )}
                  {barWidth > 60 && (
                    <span className="pointer-events-none absolute top-0 left-2 flex h-full items-center text-[10px] font-medium text-white/90">
                      {t.rolledPercentComplete > 0 ? `${t.rolledPercentComplete}%` : ""}
                    </span>
                  )}
                </div>
              )}

              {/* Resource names trailing the bar, like MS Project */}
              {t.resourceNames.length > 0 && !t.isSummary && (
                <span
                  className="pointer-events-none absolute z-10 text-[10px] whitespace-nowrap text-slate-500"
                  style={{ left: left + barWidth + 6, top: top + 9 }}
                >
                  {t.resourceNames.join(", ")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

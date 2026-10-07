"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { predecessorLabel } from "@/lib/schedule";
import { STATUS_ORDER, STATUS_TOKENS } from "./statusTokens";
import type { Dependency, Resource, ScheduledTask, TaskStatus } from "@/lib/types";

export const ROW_HEIGHT = 32;
export const HEADER_HEIGHT = 56;

const COLS = {
  wbs: 52,
  name: 224,
  days: 48,
  start: 100,
  finish: 100,
  pct: 42,
  status: 118,
  preds: 56,
  team: 88,
};
export const GRID_WIDTH = Object.values(COLS).reduce((a, b) => a + b, 0);

export type ResizableCol = "name" | "start" | "finish";

const COLUMN_BOUNDS: Record<ResizableCol, [number, number]> = {
  name: [140, 480],
  start: [80, 200],
  finish: [80, 200],
};

interface Props {
  tasks: ScheduledTask[];
  dependencies: Dependency[];
  resources: Resource[];
  selected: string[];
  collapsed: Set<string>;
  readOnly?: boolean;
  columnWidths: Record<ResizableCol, number>;
  onResizeColumn: (col: ResizableCol, width: number) => void;
  onSelect: (id: string, additive: boolean) => void;
  onToggleCollapse: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onSetStart: (id: string, iso: string) => void;
  onSetFinish: (id: string, iso: string) => void;
  onSetOwner: (id: string, resourceId: string | null) => void;
  onSetPredecessors: (id: string, raw: string) => void;
  /** Heights of the rendered rows (in task order), so the Gantt bars can line up with wrapped rows. */
  onRowHeights?: (heights: number[]) => void;
  /** Drag-and-drop by the # number: put task `id` before/after task `targetId`. */
  onMoveTask?: (id: string, targetId: string, position: "before" | "after") => void;
}

/** How far the mouse must travel before a press on # becomes a drag (a plain click just selects). */
const DRAG_THRESHOLD = 4;

function Cell({
  children,
  width,
  align = "left",
  className = "",
  wrap = false,
  fill = false,
}: {
  children: React.ReactNode;
  width: number;
  align?: "left" | "center" | "right";
  className?: string;
  /** Let the content wrap (and the row grow) instead of cutting it off. */
  wrap?: boolean;
  /** Content fills the whole cell edge to edge, at any row height (no padding). */
  fill?: boolean;
}) {
  return (
    <div
      style={{ width, textAlign: align }}
      className={`shrink-0 border-r border-slate-200 ${fill ? "flex self-stretch" : wrap ? "flex items-center self-stretch px-2" : "truncate px-2"} ${className}`}
    >
      {children}
    </div>
  );
}

function ResizableHeaderCell({
  width,
  label,
  align = "left",
  onResizeStart,
}: {
  width: number;
  label: string;
  align?: "left" | "center";
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  return (
    <div style={{ width, textAlign: align }} className="relative shrink-0 truncate border-r border-slate-600 px-2">
      {label}
      <div
        onMouseDown={onResizeStart}
        title="Drag to resize"
        className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400/70"
      />
    </div>
  );
}

/** Text input that only writes back on blur or Enter, so typing never re-schedules. */
function EditableText({
  value,
  onCommit,
  className = "",
  type = "text",
  disabled = false,
}: {
  value: string | number;
  onCommit: (v: string) => void;
  className?: string;
  type?: string;
  disabled?: boolean;
}) {
  // Re-sync the draft when the saved value changes underneath us (for example
  // after the scheduler recalculates), without an effect.
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(String(value));
  }
  return (
    <input
      type={type}
      value={draft}
      disabled={disabled}
      readOnly={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== String(value)) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`w-full bg-transparent outline-none focus:rounded focus:bg-white focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:text-slate-400 ${className}`}
    />
  );
}

/**
 * Like EditableText, but the text wraps onto further lines (Excel's "Wrap text")
 * and the box grows to fit. A name is still one line of text: Enter saves, and
 * pasted line breaks become spaces.
 */
function WrappingText({
  value,
  onCommit,
  disabled = false,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value);
  }
  const ref = useRef<HTMLTextAreaElement>(null);

  // Fit the height to the wrapped text — on every edit, and whenever the column width changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draft]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      disabled={disabled}
      readOnly={disabled}
      onChange={(e) => setDraft(e.target.value.replace(/\r?\n/g, " "))}
      onBlur={() => {
        const next = draft.trim();
        if (next && next !== value) onCommit(next);
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="block w-full resize-none overflow-hidden bg-transparent py-1 leading-snug break-words whitespace-normal outline-none focus:rounded focus:bg-white focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:text-slate-400"
    />
  );
}

function StatusCell({
  task,
  readOnly,
  onChange,
}: {
  task: ScheduledTask;
  readOnly?: boolean;
  onChange: (s: TaskStatus) => void;
}) {
  const token = STATUS_TOKENS[task.effectiveStatus];
  // Summaries take their status from their children, so they are never editable.
  if (readOnly || task.isSummary) {
    return (
      <span
        className="flex h-full w-full items-center justify-center gap-1 px-1 text-[11px] font-medium"
        style={{ background: token.tint, color: token.colour }}
      >
        <span aria-hidden>{token.icon}</span>
        {token.label}
      </span>
    );
  }
  return (
    <select
      value={task.effectiveStatus}
      onChange={(e) => onChange(e.target.value as TaskStatus)}
      onMouseDown={(e) => e.stopPropagation()}
      className="h-full w-full cursor-pointer rounded-none border-0 px-1 text-[11px] font-medium outline-none focus:ring-2 focus:ring-blue-400 focus:ring-inset"
      style={{ background: token.tint, color: token.colour, textAlignLast: "center" }}
      aria-label={`Status of ${task.name}`}
    >
      {STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {STATUS_TOKENS[s].icon} {STATUS_TOKENS[s].label}
        </option>
      ))}
    </select>
  );
}

export default function TaskGrid({
  tasks,
  dependencies,
  resources,
  selected,
  collapsed,
  readOnly,
  columnWidths,
  onResizeColumn,
  onSelect,
  onToggleCollapse,
  onPatch,
  onSetStart,
  onSetFinish,
  onSetOwner,
  onSetPredecessors,
  onRowHeights,
  onMoveTask,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const widths = { ...COLS, ...columnWidths };
  const gridWidth = Object.values(widths).reduce((a, b) => a + b, 0);

  // Wrapped names make rows taller; tell the Gantt chart every row's real height.
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const lastReported = useRef("");
  const reportHeights = useCallback(() => {
    const heights = tasks.map((t) => rowEls.current.get(t.id)?.offsetHeight || ROW_HEIGHT);
    const key = heights.join(",");
    if (key === lastReported.current) return;
    lastReported.current = key;
    onRowHeights?.(heights);
  }, [tasks, onRowHeights]);

  useLayoutEffect(() => {
    reportHeights();
    const ro = new ResizeObserver(reportHeights);
    rowEls.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [reportHeights]);

  /** Press and hold on a row's # number, move over another row, release to drop it there. */
  const beginRowDrag = (taskId: string) => (e: React.MouseEvent) => {
    if (readOnly || !onMoveTask || e.button !== 0) return;
    const startY = e.clientY;
    let dragging = false;
    let target: { id: string; position: "before" | "after" } | null = null;

    const targetAt = (y: number) => {
      for (const [id, el] of rowEls.current) {
        const r = el.getBoundingClientRect();
        if (y >= r.top && y < r.bottom) {
          return id === taskId ? null : { id, position: y < r.top + r.height / 2 ? ("before" as const) : ("after" as const) };
        }
      }
      return null;
    };
    const move = (ev: MouseEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        setDragId(taskId);
        document.body.style.cursor = "grabbing";
      }
      ev.preventDefault();
      target = targetAt(ev.clientY);
      setDrop(target);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key);
      document.body.style.cursor = "";
      setDragId(null);
      setDrop(null);
      if (commit && dragging && target) onMoveTask(taskId, target.id, target.position);
    };
    const up = () => finish(true);
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key);
  };

  const beginResize = (col: ResizableCol) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidths[col];
    const [min, max] = COLUMN_BOUNDS[col];
    const move = (ev: MouseEvent) => {
      onResizeColumn(col, Math.min(max, Math.max(min, startWidth + (ev.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div style={{ width: gridWidth }} className="shrink-0 border-r-2 border-slate-300 bg-white">
      <div
        style={{ height: HEADER_HEIGHT }}
        className="sticky top-0 z-20 flex items-end border-b border-slate-300 bg-slate-800 text-[11px] font-semibold tracking-wide text-slate-100 uppercase"
      >
        <div className="flex h-8 w-full items-center">
          <Cell width={widths.wbs} align="center" className="border-slate-600">#</Cell>
          <ResizableHeaderCell width={widths.name} label="Task name" onResizeStart={beginResize("name")} />
          <Cell width={widths.days} align="center" className="border-slate-600">Dur</Cell>
          <ResizableHeaderCell
            width={widths.start}
            label="Start"
            align="center"
            onResizeStart={beginResize("start")}
          />
          <ResizableHeaderCell
            width={widths.finish}
            label="Finish"
            align="center"
            onResizeStart={beginResize("finish")}
          />
          <Cell width={widths.pct} align="center" className="border-slate-600">%</Cell>
          <Cell width={widths.status} align="center" className="border-slate-600">Status</Cell>
          <Cell width={widths.preds} align="center" className="border-slate-600">Link</Cell>
          <Cell width={widths.team} className="border-slate-600">Team</Cell>
        </div>
      </div>

      {tasks.map((t) => {
        const isSelected = selected.includes(t.id);
        return (
          <div
            key={t.id}
            ref={(el) => {
              if (el) rowEls.current.set(t.id, el);
              else rowEls.current.delete(t.id);
            }}
            style={{ minHeight: ROW_HEIGHT, boxShadow: isSelected ? "inset 2px 0 0 #2563eb" : undefined }}
            onMouseDown={(e) => onSelect(t.id, e.shiftKey || e.metaKey || e.ctrlKey)}
            className={`group relative flex items-center border-b border-slate-100 ${t.level > 0 ? "text-[12.33px]" : "text-[13px]"} transition-colors ${
              dragId === t.id ? "opacity-40" : ""
            } ${isSelected ? "bg-blue-50" : t.isSummary ? "bg-slate-50" : "bg-white hover:bg-slate-50"}`}
          >
            {/* While dragging: a blue line where the task will land, drawn above the cells. */}
            {drop?.id === t.id && (
              <div
                data-drop-line={drop.position}
                className={`pointer-events-none absolute right-0 left-0 z-10 h-[3px] bg-blue-600 ${
                  drop.position === "before" ? "-top-px" : "-bottom-px"
                }`}
              />
            )}
            <Cell
              width={widths.wbs}
              align="center"
              className={`${t.level > 0 ? "text-[11px] text-slate-500" : "text-[11px] font-semibold text-slate-700"} ${
                readOnly || !onMoveTask ? "" : "cursor-grab select-none"
              }`}
            >
              <span
                onMouseDown={beginRowDrag(t.id)}
                title={readOnly || !onMoveTask ? undefined : "Drag to move this task"}
                className="relative inline-flex w-full items-center justify-center"
              >
                {!readOnly && onMoveTask && (
                  <span aria-hidden className="absolute left-0 text-slate-300 opacity-0 transition group-hover:opacity-100">
                    ⋮⋮
                  </span>
                )}
                {t.wbs}
              </span>
            </Cell>
            <Cell
              width={widths.name}
              wrap
              className={t.isSummary || t.isMilestone ? "font-semibold text-slate-900" : "text-slate-800"}
            >
              <div className="flex w-full min-w-0 items-center" style={{ paddingLeft: t.level * 14 }}>
                {t.isSummary ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleCollapse(t.id);
                    }}
                    className="mr-1 w-4 shrink-0 text-slate-500"
                    aria-label={collapsed.has(t.id) ? "Expand" : "Collapse"}
                  >
                    {collapsed.has(t.id) ? "▸" : "▾"}
                  </button>
                ) : (
                  <span className={`mr-1 w-4 shrink-0 text-center ${t.isMilestone ? "font-semibold" : ""} text-slate-300`}>
                    {t.isMilestone ? "◆" : "•"}
                  </span>
                )}
                <WrappingText value={t.name} disabled={readOnly} onCommit={(v) => onPatch(t.id, { name: v })} />
              </div>
            </Cell>
            <Cell width={widths.days} align="center">
              <EditableText
                type="number"
                value={t.duration}
                disabled={readOnly || t.isSummary}
                onCommit={(v) => onPatch(t.id, { duration: Number(v) })}
                className="text-center"
              />
            </Cell>
            <Cell width={widths.start} align="center" className="text-[12px] text-slate-600">
              <EditableText
                type="date"
                value={t.start}
                disabled={readOnly || t.isSummary}
                onCommit={(v) => onSetStart(t.id, v)}
                className="text-center"
              />
            </Cell>
            <Cell width={widths.finish} align="center" className="text-[12px] text-slate-600">
              <EditableText
                type="date"
                value={t.finish}
                disabled={readOnly || t.isSummary}
                onCommit={(v) => onSetFinish(t.id, v)}
                className="text-center"
              />
            </Cell>
            <Cell width={widths.pct} align="center">
              <EditableText
                type="number"
                value={t.rolledPercentComplete}
                disabled={readOnly || t.isSummary}
                onCommit={(v) => onPatch(t.id, { percentComplete: Number(v) })}
                className="text-center"
              />
            </Cell>
            <Cell width={widths.status} align="center" fill>
              <StatusCell task={t} readOnly={readOnly} onChange={(s) => onPatch(t.id, { status: s })} />
            </Cell>
            <Cell width={widths.preds} align="center" className="text-[11px] text-slate-500">
              <EditableText
                value={predecessorLabel(t.id, dependencies, tasks)}
                disabled={readOnly}
                onCommit={(v) => onSetPredecessors(t.id, v)}
                className="text-center"
              />
            </Cell>
            <Cell width={widths.team} className="text-[11px] text-slate-600">
              <select
                value={t.resourceIds[0] ?? ""}
                disabled={readOnly || t.isSummary}
                onChange={(e) => onSetOwner(t.id, e.target.value || null)}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full cursor-pointer rounded border-0 bg-transparent py-0.5 text-[11px] outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                <option value="">—</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Cell>
          </div>
        );
      })}
    </div>
  );
}

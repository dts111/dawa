"use client";

import { useState } from "react";
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
}

function Cell({
  children,
  width,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  width: number;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  return (
    <div
      style={{ width, textAlign: align }}
      className={`shrink-0 truncate border-r border-slate-200 px-2 ${className}`}
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
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
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
      className="w-full cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[11px] font-medium outline-none focus:ring-2 focus:ring-blue-400"
      style={{ background: token.tint, color: token.colour }}
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
}: Props) {
  const widths = { ...COLS, ...columnWidths };
  const gridWidth = Object.values(widths).reduce((a, b) => a + b, 0);

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
            style={{ height: ROW_HEIGHT }}
            onMouseDown={(e) => onSelect(t.id, e.shiftKey || e.metaKey || e.ctrlKey)}
            className={`flex items-center border-b border-slate-100 ${t.level > 0 ? "text-[12.33px]" : "text-[13px]"} transition-colors ${
              isSelected
                ? "bg-blue-50 shadow-[inset_2px_0_0_#2563eb]"
                : t.isSummary
                  ? "bg-slate-50"
                  : "bg-white hover:bg-slate-50"
            }`}
          >
            <Cell width={widths.wbs} align="center" className="text-[11px] text-slate-500">
              {t.wbs}
            </Cell>
            <Cell width={widths.name} className={t.isSummary ? "font-semibold text-slate-900" : "text-slate-800"}>
              <div className="flex items-center" style={{ paddingLeft: t.level * 14 }}>
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
                  <span className="mr-1 w-4 shrink-0 text-center text-slate-300">
                    {t.isMilestone ? "◆" : "•"}
                  </span>
                )}
                <EditableText
                  value={t.name}
                  disabled={readOnly}
                  onCommit={(v) => onPatch(t.id, { name: v })}
                />
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
            <Cell width={widths.status} align="center">
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

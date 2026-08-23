"use client";

import { useMemo, useState } from "react";
import { formatDate, todayISO } from "@/lib/calendar";
import { STATUS_ORDER, STATUS_TOKENS } from "./statusTokens";
import type { ProjectBundleData, ScheduledTask, TaskStatus } from "@/lib/types";

type GroupBy = "status" | "owner";

interface Props {
  bundle: ProjectBundleData;
  readOnly?: boolean;
  onSetStatus: (taskId: string, status: TaskStatus) => void;
  onSetOwner: (taskId: string, resourceId: string | null) => void;
  onSelect?: (taskId: string) => void;
}

function Card({
  task,
  today,
  draggable,
  onDragStart,
  onClick,
}: {
  task: ScheduledTask;
  today: string;
  draggable: boolean;
  onDragStart: () => void;
  onClick?: () => void;
}) {
  const overdue = task.finish < today && task.effectiveStatus !== "done";
  const token = STATUS_TOKENS[task.effectiveStatus];
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      className={`rounded-xl border bg-white p-3 shadow-sm transition ${
        draggable ? "cursor-grab hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing" : ""
      } ${overdue ? "border-red-300" : "border-slate-200"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] leading-snug font-medium text-slate-900">{task.name}</p>
        <span className="shrink-0 text-[11px] text-slate-400">{task.wbs}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium"
          style={{ background: token.tint, color: token.colour }}
        >
          <span aria-hidden>{token.icon}</span>
          {token.label}
        </span>
        {task.isCritical && (
          <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">Critical</span>
        )}
        {overdue && (
          <span className="rounded bg-red-600 px-1.5 py-0.5 font-medium text-white">Overdue</span>
        )}
        {task.isMilestone && (
          <span className="rounded bg-purple-50 px-1.5 py-0.5 font-medium text-purple-700">Milestone</span>
        )}
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Due {formatDate(task.finish)}
        {task.resourceNames.length > 0 && ` · ${task.resourceNames.join(", ")}`}
      </p>

      {!task.isMilestone && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full"
            style={{
              width: `${task.rolledPercentComplete}%`,
              background: STATUS_TOKENS[task.effectiveStatus].colour,
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function BoardView({ bundle, readOnly, onSetStatus, onSetOwner, onSelect }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const today = todayISO();

  // Summaries are containers, not work — the board shows the leaves only.
  const cards = useMemo(
    () => bundle.schedule.tasks.filter((t) => !t.isSummary),
    [bundle.schedule.tasks],
  );

  const columns = useMemo(() => {
    if (groupBy === "status") {
      return STATUS_ORDER.map((key) => ({
        key,
        label: STATUS_TOKENS[key].label,
        icon: STATUS_TOKENS[key].icon,
        colour: STATUS_TOKENS[key].colour,
        tasks: cards.filter((t) => t.effectiveStatus === key),
      }));
    }
    const byOwner = bundle.resources.map((r) => ({
      key: r.id,
      label: r.name,
      icon: "",
      colour: "#2a78d6",
      tasks: cards.filter((t) => t.resourceIds.includes(r.id)),
    }));
    return [
      ...byOwner,
      {
        key: "__unassigned",
        label: "Unassigned",
        icon: "",
        colour: "#898781",
        tasks: cards.filter((t) => t.resourceIds.length === 0),
      },
    ];
  }, [groupBy, cards, bundle.resources]);

  const drop = (columnKey: string) => {
    if (!dragging || readOnly) return;
    if (groupBy === "status") onSetStatus(dragging, columnKey as TaskStatus);
    else onSetOwner(dragging, columnKey === "__unassigned" ? null : columnKey);
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <span className="text-[12px] font-semibold text-slate-600">Group by</span>
        <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-300 ring-inset">
          {(["status", "owner"] as GroupBy[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupBy(g)}
              className={`px-3 py-1 text-[13px] capitalize transition ${
                groupBy === g ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
        {!readOnly && (
          <span className="text-[12px] text-slate-400">
            Drag a card between columns to {groupBy === "status" ? "change its status" : "reassign it"}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {columns.map((col) => (
          <div
            key={col.key}
            onDragOver={(e) => {
              if (readOnly) return;
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={() => drop(col.key)}
            className={`flex w-72 shrink-0 flex-col rounded-xl border bg-slate-50 ${
              over === col.key ? "border-blue-400 bg-blue-50/60" : "border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                {col.icon && (
                  <span aria-hidden style={{ color: col.colour }}>
                    {col.icon}
                  </span>
                )}
                {col.label}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                {col.tasks.length}
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {col.tasks.length === 0 && (
                <p className="px-1 py-6 text-center text-[12px] text-slate-400">Nothing here</p>
              )}
              {col.tasks.map((t) => (
                <Card
                  key={t.id}
                  task={t}
                  today={today}
                  draggable={!readOnly}
                  onDragStart={() => setDragging(t.id)}
                  onClick={() => onSelect?.(t.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

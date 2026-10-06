"use client";

import { useEffect, useRef, useState } from "react";
import { RISK_ORDER, RISK_TOKENS } from "./statusTokens";
import type { ProjectBundleData, TableColumn, TableLayout, TaskRisk } from "@/lib/types";

interface Props {
  bundle: ProjectBundleData;
  readOnly?: boolean;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onSetOwner: (taskId: string, resourceId: string | null) => void;
  onSelect?: (taskId: string) => void;
  /** Saves column widths / row heights with the plan. Absent for read-only viewers. */
  onSaveLayout?: (layout: TableLayout | null) => void;
}

const WBS_WIDTH = 56;
const DEFAULT_COLS: Record<TableColumn, number> = {
  name: 224,
  owner: 160,
  todo: 260,
  risk: 128,
  notes: 260,
  remarks: 260,
};
const COLUMN_LABELS: Record<TableColumn, string> = {
  name: "Task name",
  owner: "Owner",
  todo: "To-do list",
  risk: "Risk",
  notes: "Notes",
  remarks: "Remarks",
};
const MIN_COL = 60;
const MAX_COL = 800;
const SAVE_DELAY_MS = 600;

/**
 * Textarea version of the grid's inline editor: local draft, commits on blur only.
 * Its height is the row's height; dragging its corner resizes the whole row.
 */
function EditableTextArea({
  value,
  onCommit,
  disabled,
  placeholder,
  height,
  onResize,
}: {
  value: string | null;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  height?: number;
  onResize?: (height: number) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value ?? "");
  }
  const ref = useRef<HTMLTextAreaElement>(null);

  // The browser's resize corner has no "resized" event: compare the height when the drag ends.
  const watchResize = () => {
    const el = ref.current;
    if (!el || !onResize) return;
    const before = el.offsetHeight;
    const done = () => {
      window.removeEventListener("mouseup", done);
      if (el.offsetHeight !== before) onResize(el.offsetHeight);
    };
    window.addEventListener("mouseup", done);
  };

  return (
    <textarea
      ref={ref}
      value={draft}
      disabled={disabled}
      readOnly={disabled}
      placeholder={placeholder}
      rows={2}
      style={height ? { height } : undefined}
      onMouseDown={watchResize}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== (value ?? "")) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(value ?? "");
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="block w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] leading-snug text-slate-700 outline-none transition hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-brand/15 disabled:cursor-not-allowed disabled:text-slate-400"
    />
  );
}

export default function TableView({ bundle, readOnly, onPatch, onSetOwner, onSelect, onSaveLayout }: Props) {
  // Summaries are containers, not work — same rule the board uses.
  const rows = bundle.schedule.tasks.filter((t) => !t.isSummary);

  const saved = bundle.project.tableLayout;
  const [cols, setCols] = useState<Record<TableColumn, number>>({ ...DEFAULT_COLS, ...saved?.cols });
  const [rowHeights, setRowHeights] = useState<Record<string, number>>(saved?.rows ?? {});

  // Save shortly after the last change, so a drag produces one save, not hundreds.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ cols, rowHeights, taskIds: new Set<string>() });
  useEffect(() => {
    latest.current = { cols, rowHeights, taskIds: new Set(rows.map((t) => t.id)) };
  });
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const scheduleSave = () => {
    if (!onSaveLayout) return; // read-only viewers can resize for themselves, but nothing is saved
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const { cols: c, rowHeights: r, taskIds } = latest.current;
      // Drop rows of tasks that no longer exist.
      const liveRows = Object.fromEntries(Object.entries(r).filter(([id]) => taskIds.has(id)));
      onSaveLayout({ cols: c, rows: liveRows });
    }, SAVE_DELAY_MS);
  };

  const beginColumnResize = (col: TableColumn) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = cols[col];
    const move = (ev: MouseEvent) => {
      const width = Math.min(MAX_COL, Math.max(MIN_COL, startWidth + (ev.clientX - startX)));
      setCols((prev) => ({ ...prev, [col]: width }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      scheduleSave();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const resizeRow = (taskId: string, height: number) => {
    setRowHeights((prev) => ({ ...prev, [taskId]: Math.min(600, Math.max(32, height)) }));
    scheduleSave();
  };

  const resetSizes = () => {
    setCols(DEFAULT_COLS);
    setRowHeights({});
    if (saveTimer.current) clearTimeout(saveTimer.current);
    onSaveLayout?.(null);
  };

  const tableWidth = WBS_WIDTH + Object.values(cols).reduce((a, b) => a + b, 0);
  const isCustomised =
    Object.keys(rowHeights).length > 0 ||
    (Object.keys(DEFAULT_COLS) as TableColumn[]).some((k) => cols[k] !== DEFAULT_COLS[k]);

  const header = (col: TableColumn, last = false) => (
    <th className={`relative px-3 py-2 text-left ${last ? "" : "border-r border-slate-600"}`}>
      <span className="block truncate">{COLUMN_LABELS[col]}</span>
      <span
        onMouseDown={beginColumnResize(col)}
        title="Drag to resize"
        className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400/70"
      />
    </th>
  );

  return (
    <div className="flex h-full flex-col bg-white">
      {onSaveLayout && (
        <div className="flex shrink-0 items-center justify-end gap-3 border-b border-slate-200 px-3 py-1.5 text-[11.5px] text-slate-500">
          <span>Drag a column edge or a box&apos;s corner to resize — sizes are saved with the plan.</span>
          {isCustomised && (
            <button type="button" onClick={resetSizes} className="font-medium text-brand hover:underline">
              Reset sizes
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-[13px]" style={{ tableLayout: "fixed", width: tableWidth }}>
          <colgroup>
            <col style={{ width: WBS_WIDTH }} />
            {(Object.keys(DEFAULT_COLS) as TableColumn[]).map((c) => (
              <col key={c} style={{ width: cols[c] }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-800 text-[11px] font-semibold tracking-wide text-slate-100 uppercase">
            <tr>
              <th className="border-r border-slate-600 px-3 py-2 text-center">#</th>
              {header("name")}
              {header("owner")}
              {header("todo")}
              {header("risk")}
              {header("notes")}
              {header("remarks", true)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-10 text-center text-slate-400">
                  No tasks yet.
                </td>
              </tr>
            )}
            {rows.map((t) => {
              const token = RISK_TOKENS[t.risk ?? "none"];
              const height = rowHeights[t.id];
              const onResize = (h: number) => resizeRow(t.id, h);
              return (
                <tr key={t.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                  <td className="border-r border-slate-100 px-2 py-2.5 text-center text-[11px] text-slate-500">
                    {t.wbs}
                  </td>
                  <td className="border-r border-slate-100 px-3 py-2.5 break-words">
                    <button
                      type="button"
                      onClick={() => onSelect?.(t.id)}
                      className="text-left font-medium text-slate-900 hover:underline"
                    >
                      {t.name}
                    </button>
                  </td>
                  <td className="border-r border-slate-100 px-2 py-2">
                    <select
                      value={t.resourceIds[0] ?? ""}
                      disabled={readOnly}
                      onChange={(e) => onSetOwner(t.id, e.target.value || null)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">Unassigned</option>
                      {bundle.resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border-r border-slate-100 px-1 py-1">
                    <EditableTextArea
                      value={t.objectives}
                      disabled={readOnly}
                      placeholder="Things to do for this task…"
                      height={height}
                      onResize={onResize}
                      onCommit={(v) => onPatch(t.id, { objectives: v })}
                    />
                  </td>
                  <td className="border-r border-slate-100 px-2 py-2">
                    <select
                      value={t.risk ?? "none"}
                      disabled={readOnly}
                      onChange={(e) =>
                        onPatch(t.id, {
                          risk: e.target.value === "none" ? null : (e.target.value as TaskRisk),
                        })
                      }
                      className="w-full cursor-pointer rounded border-0 px-1.5 py-1 text-[12px] font-medium outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed"
                      style={{ background: token.tint, color: token.colour }}
                      aria-label={`Risk for ${t.name}`}
                    >
                      <option value="none">
                        {RISK_TOKENS.none.icon} {RISK_TOKENS.none.label}
                      </option>
                      {RISK_ORDER.map((r) => (
                        <option key={r} value={r}>
                          {RISK_TOKENS[r].icon} {RISK_TOKENS[r].label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border-r border-slate-100 px-1 py-1">
                    <EditableTextArea
                      value={t.guidance}
                      disabled={readOnly}
                      placeholder="Notes for whoever picks this up…"
                      height={height}
                      onResize={onResize}
                      onCommit={(v) => onPatch(t.id, { guidance: v })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <EditableTextArea
                      value={t.remarks}
                      disabled={readOnly}
                      placeholder="Anything else worth flagging…"
                      height={height}
                      onResize={onResize}
                      onCommit={(v) => onPatch(t.id, { remarks: v })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

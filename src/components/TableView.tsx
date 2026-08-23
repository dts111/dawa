"use client";

import { useState } from "react";
import { RISK_ORDER, RISK_TOKENS } from "./statusTokens";
import type { ProjectBundleData, TaskRisk } from "@/lib/types";

interface Props {
  bundle: ProjectBundleData;
  readOnly?: boolean;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onSetOwner: (taskId: string, resourceId: string | null) => void;
  onSelect?: (taskId: string) => void;
}

/** Textarea version of the grid's inline editor: local draft, commits on blur only. */
function EditableTextArea({
  value,
  onCommit,
  disabled,
  placeholder,
}: {
  value: string | null;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value ?? "");
  }
  return (
    <textarea
      value={draft}
      disabled={disabled}
      readOnly={disabled}
      placeholder={placeholder}
      rows={2}
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
      className="w-full min-w-[200px] resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] leading-snug text-slate-700 outline-none transition hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:text-slate-400"
    />
  );
}

export default function TableView({ bundle, readOnly, onPatch, onSetOwner, onSelect }: Props) {
  // Summaries are containers, not work — same rule the board uses.
  const rows = bundle.schedule.tasks.filter((t) => !t.isSummary);

  return (
    <div className="h-full overflow-auto bg-white">
      <table className="w-full min-w-[1100px] border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-slate-800 text-[11px] font-semibold tracking-wide text-slate-100 uppercase">
          <tr>
            <th className="w-14 border-r border-slate-600 px-3 py-2 text-center">#</th>
            <th className="w-56 border-r border-slate-600 px-3 py-2 text-left">Task name</th>
            <th className="w-40 border-r border-slate-600 px-3 py-2 text-left">Owner</th>
            <th className="min-w-[220px] border-r border-slate-600 px-3 py-2 text-left">Objectives</th>
            <th className="w-32 border-r border-slate-600 px-3 py-2 text-left">Risk</th>
            <th className="min-w-[220px] border-r border-slate-600 px-3 py-2 text-left">Guidance</th>
            <th className="min-w-[220px] px-3 py-2 text-left">Remarks</th>
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
            return (
              <tr key={t.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                <td className="border-r border-slate-100 px-2 py-2.5 text-center text-[11px] text-slate-500">
                  {t.wbs}
                </td>
                <td className="border-r border-slate-100 px-3 py-2.5">
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
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[13px] outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:opacity-60"
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
                    placeholder="What this task is meant to achieve…"
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
                    onCommit={(v) => onPatch(t.id, { guidance: v })}
                  />
                </td>
                <td className="px-1 py-1">
                  <EditableTextArea
                    value={t.remarks}
                    disabled={readOnly}
                    placeholder="Anything else worth flagging…"
                    onCommit={(v) => onPatch(t.id, { remarks: v })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

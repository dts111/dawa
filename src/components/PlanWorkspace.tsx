"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import TaskGrid, { GRID_WIDTH, type ResizableCol } from "./TaskGrid";
import GanttChart, { type Zoom } from "./GanttChart";
import BoardView from "./BoardView";
import TableView from "./TableView";
import CalendarView from "./CalendarView";
import DashboardView from "./DashboardView";
import SidePanel, { type Panel } from "./SidePanels";
import LogoutButton from "./LogoutButton";
import type { ProjectBundleData, ScheduledTask, TaskStatus } from "@/lib/types";
import { WorkCalendar, formatDate, todayISO } from "@/lib/calendar";

export type ViewKey = "gantt" | "board" | "table" | "calendar" | "dashboard";

const VIEWS: { key: ViewKey; label: string; icon: string }[] = [
  { key: "gantt", label: "Gantt", icon: "▤" },
  { key: "board", label: "Board", icon: "▦" },
  { key: "table", label: "Table", icon: "☰" },
  { key: "calendar", label: "Calendar", icon: "▩" },
  { key: "dashboard", label: "Dashboard", icon: "◍" },
];

const DEFAULT_COLUMN_WIDTHS: Record<ResizableCol, number> = { name: 224, start: 100, finish: 100 };
const COLUMN_WIDTHS_KEY = "eaas-pm:column-widths";

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

function Btn({
  children,
  onClick,
  disabled,
  tone = "plain",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "plain" | "primary" | "danger";
  title?: string;
}) {
  const tones = {
    plain: "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 hover:ring-slate-400",
    primary: "bg-slate-900 text-white ring-slate-900 shadow-sm hover:bg-slate-800",
    danger: "bg-white text-red-700 ring-red-300 hover:bg-red-50",
  } as const;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-2.5 py-1.5 text-[13px] font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/** The plan title, editable in place. Commits on blur/Enter, Escape reverts. */
function EditableHeading({
  value,
  onCommit,
  disabled,
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
  return (
    <input
      value={draft}
      disabled={disabled}
      readOnly={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1 -mx-1 text-base font-semibold tracking-tight text-slate-900 outline-none transition hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-900/10 disabled:cursor-default disabled:hover:border-transparent"
    />
  );
}

export default function PlanWorkspace({
  initial,
  readOnly = false,
  shareLabel,
}: {
  initial: ProjectBundleData;
  readOnly?: boolean;
  shareLabel?: string | null;
}) {
  const [bundle, setBundle] = useState(initial);
  const [view, setView] = useState<ViewKey>("gantt");
  const [columnWidths, setColumnWidths] = useState<Record<ResizableCol, number>>(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMN_WIDTHS;
    try {
      const stored = JSON.parse(window.localStorage.getItem(COLUMN_WIDTHS_KEY) ?? "null");
      if (stored && typeof stored === "object") return { ...DEFAULT_COLUMN_WIDTHS, ...stored };
    } catch {
      // Ignore malformed storage and fall back to defaults.
    }
    return DEFAULT_COLUMN_WIDTHS;
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<Zoom>("week");
  const [showBaseline, setShowBaseline] = useState(true);
  const [showCritical, setShowCritical] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const resizeColumn = (col: ResizableCol, width: number) => {
    setColumnWidths((prev) => {
      const next = { ...prev, [col]: width };
      localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const { project, schedule, dependencies } = bundle;
  const cal = useMemo(
    () => new WorkCalendar(project.workingDays, project.holidays),
    [project.workingDays, project.holidays],
  );

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (readOnly) return null;
      setBusy(true);
      setError(null);
      try {
        const result = (await fn()) as { bundle?: ProjectBundleData };
        if (result?.bundle) setBundle(result.bundle);
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [readOnly],
  );

  const renameProject = async (name: string) => {
    if (readOnly) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not rename the plan.");
      setBundle((b) => ({ ...b, project: json.project }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const visible = useMemo(() => {
    const byId = new Map(schedule.tasks.map((t) => [t.id, t]));
    const isHidden = (t: ScheduledTask) => {
      let p = t.parentId;
      let guard = 0;
      while (p && guard++ < 100) {
        if (collapsed.has(p)) return true;
        p = byId.get(p)?.parentId ?? null;
      }
      return false;
    };
    return schedule.tasks.filter((t) => !isHidden(t));
  }, [schedule.tasks, collapsed]);

  const selectRow = (id: string, additive: boolean) =>
    setSelected((cur) => (additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));

  const patchTask = (id: string, patch: Record<string, unknown>) =>
    run(() => api(`/api/tasks/${id}`, "PATCH", patch));

  /** Typing a new start in the grid pins it, exactly like dragging the bar does. */
  const setTaskStart = (id: string, iso: string) => {
    if (!iso) return;
    patchTask(id, { startDate: iso });
  };

  /** Finish isn't stored directly — it's start + duration, so solve for duration. */
  const setTaskFinish = (id: string, iso: string) => {
    if (!iso) return;
    const task = schedule.tasks.find((t) => t.id === id);
    if (!task) return;
    const duration = cal.workingDaysBetween(task.start, iso);
    if (duration < 0) {
      setError("Finish date can't be before the task's start date.");
      return;
    }
    patchTask(id, { duration });
  };

  /** Inverse of predecessorLabel(): "3", "3SS", "3FS+2d" — comma-separated WBS refs. */
  const setTaskPredecessors = (taskId: string, raw: string) => {
    const tokens = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const parsed: { predecessorId: string; type: string; lag: number }[] = [];
    for (const token of tokens) {
      const m = token.match(/^(\d+(?:\.\d+)*)\s*(FS|SS|FF|SF)?\s*([+-]\d+)?d?$/i);
      if (!m) {
        setError(`Couldn't understand predecessor "${token}". Use a WBS number, e.g. "3" or "3FS+2d".`);
        return;
      }
      const [, wbs, type, lagRaw] = m;
      const pred = schedule.tasks.find((t) => t.wbs === wbs);
      if (!pred) {
        setError(`No task with WBS "${wbs}".`);
        return;
      }
      if (pred.id === taskId) {
        setError("A task can't be its own predecessor.");
        return;
      }
      parsed.push({ predecessorId: pred.id, type: (type ?? "FS").toUpperCase(), lag: lagRaw ? Number(lagRaw) : 0 });
    }

    const current = dependencies.filter((d) => d.successorId === taskId);
    const toRemove = current.filter((d) => !parsed.some((p) => p.predecessorId === d.predecessorId));

    run(async () => {
      let last: unknown = null;
      for (const d of toRemove) last = await api(`/api/dependencies/${d.id}`, "DELETE");
      for (const p of parsed) {
        last = await api(`/api/projects/${project.id}/dependencies`, "POST", {
          predecessorId: p.predecessorId,
          successorId: taskId,
          type: p.type,
          lag: p.lag,
        });
      }
      return last;
    });
  };

  const first = selected[0] ? schedule.tasks.find((t) => t.id === selected[0]) : undefined;

  const addTask = (opts: { asChild?: boolean; milestone?: boolean; above?: boolean } = {}) =>
    run(() =>
      api(`/api/projects/${project.id}/tasks`, "POST", {
        name: opts.milestone ? "New milestone" : "New task",
        duration: opts.milestone ? 0 : 5,
        parentId: opts.asChild ? (first?.id ?? null) : (first?.parentId ?? null),
        afterTaskId: opts.asChild || opts.above ? undefined : first?.id,
        beforeTaskId: opts.above ? first?.id : undefined,
      }),
    );

  const indent = () => {
    if (!first) return;
    const siblings = schedule.tasks.filter((t) => t.parentId === first.parentId);
    const idx = siblings.findIndex((t) => t.id === first.id);
    if (idx <= 0) {
      setError("There is no task above this one at the same level to nest it under.");
      return;
    }
    patchTask(first.id, { parentId: siblings[idx - 1].id });
  };

  const outdent = () => {
    if (!first?.parentId) return;
    const parent = schedule.tasks.find((t) => t.id === first.parentId);
    patchTask(first.id, { parentId: parent?.parentId ?? null, sortOrder: (parent?.sortOrder ?? 0) + 0.5 });
  };

  /** Swaps the selected task with its neighbouring sibling — # renumbers automatically. */
  const moveUp = () => {
    if (!first) return;
    const siblings = schedule.tasks.filter((t) => t.parentId === first.parentId);
    const idx = siblings.findIndex((t) => t.id === first.id);
    if (idx <= 0) return;
    const prev = siblings[idx - 1];
    const movingId = first.id;
    const movingSort = first.sortOrder;
    run(async () => {
      await api(`/api/tasks/${movingId}`, "PATCH", { sortOrder: prev.sortOrder });
      return api(`/api/tasks/${prev.id}`, "PATCH", { sortOrder: movingSort });
    });
  };

  const moveDown = () => {
    if (!first) return;
    const siblings = schedule.tasks.filter((t) => t.parentId === first.parentId);
    const idx = siblings.findIndex((t) => t.id === first.id);
    if (idx === -1 || idx >= siblings.length - 1) return;
    const next = siblings[idx + 1];
    const movingId = first.id;
    const movingSort = first.sortOrder;
    run(async () => {
      await api(`/api/tasks/${movingId}`, "PATCH", { sortOrder: next.sortOrder });
      return api(`/api/tasks/${next.id}`, "PATCH", { sortOrder: movingSort });
    });
  };

  const removeSelected = async () => {
    for (const id of selected) await run(() => api(`/api/tasks/${id}`, "DELETE"));
    setSelected([]);
  };

  const linkSelected = () => {
    if (selected.length < 2) return;
    const pairs = selected.slice(0, -1).map((p, i) => [p, selected[i + 1]] as const);
    return run(async () => {
      let last: unknown = null;
      for (const [p, s] of pairs) {
        last = await api(`/api/projects/${project.id}/dependencies`, "POST", {
          predecessorId: p,
          successorId: s,
          type: "FS",
          lag: 0,
        });
      }
      return last;
    });
  };

  const saveBaseline = () =>
    run(async () => {
      const r = await api(`/api/projects/${project.id}/baseline`, "POST");
      setNotice("Baseline saved — variances are now measured against today's plan.");
      return r;
    });

  const setStatus = (taskId: string, status: TaskStatus) => patchTask(taskId, { status });

  const setOwner = (taskId: string, resourceId: string | null) =>
    run(() =>
      api(`/api/tasks/${taskId}/assignments`, "PUT", { resourceIds: resourceId ? [resourceId] : [] }),
    );

  /** Clicking a card in board/calendar/dashboard jumps to it in the Gantt. */
  const focusTask = (taskId: string) => {
    setSelected([taskId]);
    setView("gantt");
  };

  const hasBaseline = schedule.tasks.some((t) => t.baselineFinish);
  const today = todayISO();
  const leaves = schedule.tasks.filter((t) => !t.isSummary);
  const overdue = leaves.filter((t) => t.finish < today && t.effectiveStatus !== "done").length;
  const roots = schedule.tasks.filter((t) => t.level === 0);
  const overallPct = roots.length
    ? Math.round(
        roots.reduce((a, t) => a + t.rolledPercentComplete * Math.max(1, t.duration), 0) /
          roots.reduce((a, t) => a + Math.max(1, t.duration), 0),
      )
    : 0;

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="mr-auto min-w-0">
            <div className="flex items-center gap-2">
              {!readOnly && (
                <Link
                  href="/"
                  className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[13px] font-medium text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
                  title="Back to main menu"
                >
                  ← Main menu
                </Link>
              )}
              <EditableHeading value={project.name} disabled={readOnly} onCommit={renameProject} />
              {readOnly && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-300">
                  Read only{shareLabel ? ` · ${shareLabel}` : ""}
                </span>
              )}
            </div>
            <p className="text-[12px] text-slate-500">
              {formatDate(schedule.projectStart)} → {formatDate(schedule.projectFinish)} ·{" "}
              {schedule.totalDuration} working days · {overallPct}% complete
              {overdue > 0 && <span className="ml-2 font-semibold text-red-600">{overdue} overdue</span>}
            </p>
          </div>

          <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-300 ring-inset">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] transition ${
                  view === v.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span aria-hidden>{v.icon}</span>
                {v.label}
              </button>
            ))}
          </div>

          {!readOnly && (
            <>
              <Btn onClick={() => setPanel(panel === "team" ? null : "team")}>Team</Btn>
              <Btn onClick={() => setPanel(panel === "automations" ? null : "automations")}>Automations</Btn>
              <Btn onClick={() => setPanel(panel === "share" ? null : "share")}>Share</Btn>
            </>
          )}
          <a
            href={`/api/projects/${project.id}/export/xlsx`}
            className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-[13px] font-medium text-white shadow-sm transition hover:bg-emerald-800"
          >
            Export to Excel
          </a>
          {!readOnly && (
            <Btn tone="primary" onClick={() => setPanel(panel === "email" ? null : "email")}>
              Email update
            </Btn>
          )}
          {!readOnly && (
            <>
              <span className="mx-1 h-5 w-px bg-slate-300" />
              <LogoutButton />
            </>
          )}
        </div>

        {view === "gantt" && !readOnly && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Btn onClick={() => addTask()}>+ Task</Btn>
            <Btn onClick={() => addTask({ asChild: true })} disabled={!first}>
              + Sub-task
            </Btn>
            <Btn onClick={() => addTask({ above: true })} disabled={!first}>
              + Task above
            </Btn>
            <Btn onClick={() => addTask({ milestone: true })}>+ Milestone</Btn>
            <span className="mx-1 h-5 w-px bg-slate-300" />
            <Btn onClick={outdent} disabled={!first?.parentId} title="Move left">
              ←
            </Btn>
            <Btn onClick={indent} disabled={!first} title="Move right (make a sub-task)">
              →
            </Btn>
            <Btn onClick={moveUp} disabled={!first} title="Move up">
              ↑
            </Btn>
            <Btn onClick={moveDown} disabled={!first} title="Move down">
              ↓
            </Btn>
            <span className="mx-1 h-5 w-px bg-slate-300" />
            <Btn onClick={linkSelected} disabled={selected.length < 2} title="Link selected tasks finish-to-start">
              Link
            </Btn>
            <Btn onClick={() => setPanel("links")}>Manage links</Btn>
            <Btn tone="danger" onClick={removeSelected} disabled={!selected.length}>
              Delete
            </Btn>
            <span className="mx-1 h-5 w-px bg-slate-300" />
            <Btn onClick={saveBaseline}>Save baseline</Btn>
            {hasBaseline && (
              <Btn onClick={() => run(() => api(`/api/projects/${project.id}/baseline`, "DELETE"))}>
                Clear baseline
              </Btn>
            )}
            <Btn onClick={() => setPanel("settings")}>Calendar</Btn>
            {busy && <span className="ml-2 text-[12px] text-slate-400">Saving…</span>}
          </div>
        )}

        {view === "gantt" && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-300 ring-inset">
              {(["day", "week", "month"] as Zoom[]).map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoom(z)}
                  className={`px-2.5 py-1.5 text-[13px] capitalize transition ${
                    zoom === z ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {z}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[13px] text-slate-600">
              <input type="checkbox" checked={showCritical} onChange={(e) => setShowCritical(e.target.checked)} />
              Critical path
            </label>
            <label className="flex items-center gap-1.5 text-[13px] text-slate-600">
              <input type="checkbox" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} />
              Baseline
            </label>
          </div>
        )}

        {(error || notice || schedule.errors.length > 0) && (
          <div className="mt-2 space-y-1">
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-1.5 text-[13px] text-red-700 ring-1 ring-red-200">{error}</p>
            )}
            {notice && (
              <p className="rounded-md bg-emerald-50 px-3 py-1.5 text-[13px] text-emerald-800 ring-1 ring-emerald-200">
                {notice}
              </p>
            )}
            {schedule.errors.map((e, i) => (
              <p
                key={i}
                className="rounded-md bg-amber-50 px-3 py-1.5 text-[13px] text-amber-800 ring-1 ring-amber-200"
              >
                {e}
              </p>
            ))}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {view === "gantt" && (
            <div className="h-full overflow-auto bg-white">
              <div className="flex min-w-max">
                <div className="sticky left-0 z-30 bg-white">
                  <TaskGrid
                    tasks={visible}
                    dependencies={dependencies}
                    resources={bundle.resources}
                    selected={selected}
                    collapsed={collapsed}
                    readOnly={readOnly}
                    columnWidths={columnWidths}
                    onResizeColumn={resizeColumn}
                    onSelect={selectRow}
                    onToggleCollapse={(id) =>
                      setCollapsed((c) => {
                        const next = new Set(c);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    onPatch={patchTask}
                    onSetStart={setTaskStart}
                    onSetFinish={setTaskFinish}
                    onSetOwner={setOwner}
                    onSetPredecessors={setTaskPredecessors}
                  />
                </div>
                <GanttChart
                  project={project}
                  tasks={visible}
                  dependencies={dependencies}
                  selected={selected}
                  zoom={zoom}
                  readOnly={readOnly}
                  showBaseline={showBaseline}
                  showCritical={showCritical}
                  onSelect={selectRow}
                  onMoveTask={(id, start) => patchTask(id, { startDate: start })}
                  onResizeTask={(id, duration) => patchTask(id, { duration })}
                />
              </div>
              {visible.length === 0 && (
                <div className="p-10 text-center text-sm text-slate-500" style={{ width: GRID_WIDTH }}>
                  No tasks yet. Use <strong>+ Task</strong> above to start building the plan.
                </div>
              )}
            </div>
          )}

          {view === "board" && (
            <BoardView
              bundle={bundle}
              readOnly={readOnly}
              onSetStatus={setStatus}
              onSetOwner={setOwner}
              onSelect={focusTask}
            />
          )}

          {view === "table" && (
            <TableView
              bundle={bundle}
              readOnly={readOnly}
              onPatch={patchTask}
              onSetOwner={setOwner}
              onSelect={focusTask}
            />
          )}

          {view === "calendar" && <CalendarView bundle={bundle} onSelect={focusTask} />}

          {view === "dashboard" && <DashboardView bundle={bundle} onSelect={focusTask} />}
        </div>

        {panel && !readOnly && (
          <SidePanel
            panel={panel}
            bundle={bundle}
            selectedTask={first}
            onClose={() => setPanel(null)}
            onBundle={setBundle}
            onError={setError}
            onNotice={setNotice}
          />
        )}
      </div>
    </div>
  );
}

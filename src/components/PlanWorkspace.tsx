"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TaskGrid, { GRID_WIDTH, type ResizableCol } from "./TaskGrid";
import GanttChart, { type Zoom } from "./GanttChart";
import BoardView from "./BoardView";
import TableView from "./TableView";
import CalendarView from "./CalendarView";
import DashboardView from "./DashboardView";
import SidePanel, { type Panel } from "./SidePanels";
import LogoutButton from "./LogoutButton";
import ClientMark from "./ClientMark";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookmarkX,
  Building2,
  CalendarCog,
  CalendarDays,
  ChartGantt,
  CircleAlert,
  CornerDownRight,
  Diamond,
  Eye,
  FileSpreadsheet,
  IndentDecrease,
  IndentIncrease,
  LayoutDashboard,
  Link2,
  ListPlus,
  LoaderCircle,
  Mail,
  Plus,
  Share2,
  Spline,
  SquareKanban,
  Table2,
  Trash2,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ProjectBundleData, ScheduledTask, TableLayout, TaskStatus } from "@/lib/types";
import { WorkCalendar, formatDate, todayISO } from "@/lib/calendar";

export type ViewKey = "gantt" | "board" | "table" | "calendar" | "dashboard";

const VIEWS: { key: ViewKey; label: string; icon: LucideIcon }[] = [
  { key: "gantt", label: "Gantt", icon: ChartGantt },
  { key: "board", label: "Board", icon: SquareKanban },
  { key: "table", label: "Table", icon: Table2 },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
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
  icon: Icon,
  onClick,
  disabled,
  active,
  tone = "plain",
  title,
}: {
  children?: React.ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "plain" | "primary" | "danger";
  title?: string;
}) {
  const tones = {
    plain: active
      ? "border-brand bg-brand-soft text-brand"
      : "border-slate-200 bg-white text-slate-700 hover:border-brand hover:text-brand",
    primary: "border-brand bg-brand text-white shadow-card hover:border-brand-hover hover:bg-brand-hover",
    danger: "border-red-200 bg-white text-red-700 hover:border-red-400 hover:bg-red-50",
  } as const;
  return (
    <button
      type="button"
      title={title}
      aria-label={!children ? title : undefined}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-md border-2 py-1 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        children ? "px-2.5" : "px-1.5"
      } ${tones[tone]}`}
    >
      {Icon && <Icon size={15} aria-hidden />}
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />;
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
      size={Math.min(60, Math.max(8, draft.length + 1))}
      className="max-w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1 -mx-1 text-lg font-bold tracking-tight text-slate-900 outline-none transition hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-brand/15 disabled:cursor-default disabled:hover:border-transparent"
    />
  );
}

export default function PlanWorkspace({
  initial,
  readOnly = false,
  shareLabel,
  shareToken,
}: {
  initial: ProjectBundleData;
  readOnly?: boolean;
  shareLabel?: string | null;
  /** Share token when viewed through a read-only link; used for the Excel download. */
  shareToken?: string;
}) {
  const [bundle, setBundle] = useState(initial);
  const [view, setView] = useState<ViewKey>("gantt");
  // Server-safe defaults so the client's hydration render matches the SSR
  // markup exactly; the real values (if any) are restored after mount below.
  const [columnWidths, setColumnWidths] = useState<Record<ResizableCol, number>>(DEFAULT_COLUMN_WIDTHS);
  const [selected, setSelected] = useState<string[]>([]);
  // Real row heights from the task grid (wrapped names make rows taller); the Gantt follows them.
  const [rowHeights, setRowHeights] = useState<number[]>([]);
  const collapsedKey = `eaas-pm:collapsed:${initial.project.id}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Restoring a persisted UI preference from localStorage after mount, once —
  // this is exactly what an effect is for, so the setState-in-effect rule
  // doesn't apply here (it's not derivable during render without risking a
  // hydration mismatch, since localStorage isn't available during SSR).
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(COLUMN_WIDTHS_KEY) ?? "null");
      if (stored && typeof stored === "object") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setColumnWidths({ ...DEFAULT_COLUMN_WIDTHS, ...stored });
      }
    } catch {
      // Ignore malformed storage and keep the defaults.
    }
    try {
      const stored = JSON.parse(window.localStorage.getItem(collapsedKey) ?? "[]");
      if (Array.isArray(stored) && stored.length) setCollapsed(new Set(stored));
    } catch {
      // Ignore malformed storage and keep everything expanded.
    }
  }, [collapsedKey]);
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

  const toggleCollapse = (id: string) => {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(collapsedKey, JSON.stringify([...next]));
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

  /** Saves the Table view's column widths / row heights with the plan (quietly — no spinner). */
  const saveTableLayout = async (tableLayout: TableLayout | null) => {
    try {
      const json = await api(`/api/projects/${project.id}`, "PATCH", { tableLayout });
      setBundle((b) => ({ ...b, project: { ...b.project, tableLayout: json.project.tableLayout } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the table sizes.");
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
      {readOnly && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-teal px-4 py-1.5 text-[12.5px] text-white">
          <Eye size={14} aria-hidden />
          <span>
            You&apos;re viewing a live, read-only plan{shareLabel ? ` · ${shareLabel}` : ""} — it updates as the
            team works.
          </span>
        </div>
      )}
      <header className="shrink-0 border-b border-slate-200 bg-white shadow-card">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
          <div className="mr-auto flex min-w-0 items-center gap-3">
            {readOnly ? (
              <ClientMark name={project.clientName} logo={project.clientLogo} height={40} />
            ) : (
              <Link href="/" title="All plans" aria-label="All plans" className="shrink-0">
                <ClientMark name={project.clientName} logo={project.clientLogo} height={40} />
              </Link>
            )}
            <div className="min-w-0">
              {project.clientName && (
                <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{project.clientName}</p>
              )}
              <EditableHeading value={project.name} disabled={readOnly} onCommit={renameProject} />
              <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-slate-500">
                <span className="font-mono">
                  {formatDate(schedule.projectStart)} → {formatDate(schedule.projectFinish)}
                </span>
                <span aria-hidden>·</span>
                <span className="font-mono">{schedule.totalDuration} working days</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                    <span className="block h-full rounded-full bg-brand" style={{ width: `${overallPct}%` }} />
                  </span>
                  <span className="font-mono">{overallPct}%</span>
                </span>
                {overdue > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 ring-1 ring-red-200">
                    <CircleAlert size={12} aria-hidden /> {overdue} overdue
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {!readOnly && (
              <>
                <Btn icon={Users} onClick={() => setPanel(panel === "team" ? null : "team")} active={panel === "team"}>
                  Team
                </Btn>
                <Btn
                  icon={Zap}
                  onClick={() => setPanel(panel === "automations" ? null : "automations")}
                  active={panel === "automations"}
                >
                  Automations
                </Btn>
                <Btn icon={Building2} onClick={() => setPanel(panel === "client" ? null : "client")} active={panel === "client"}>
                  Client
                </Btn>
                <Btn icon={Share2} onClick={() => setPanel(panel === "share" ? null : "share")} active={panel === "share"}>
                  Share
                </Btn>
              </>
            )}
            <a
              href={shareToken ? `/share/${shareToken}/xlsx` : `/api/projects/${project.id}/xlsx`}
              className="inline-flex items-center gap-1.5 rounded-md border-2 border-teal/30 bg-teal-soft px-2.5 py-1 text-[13px] font-medium text-teal transition hover:border-teal"
            >
              <FileSpreadsheet size={15} aria-hidden />
              Export to Excel
            </a>
            {!readOnly && (
              <>
                <Btn icon={Mail} tone="primary" onClick={() => setPanel(panel === "email" ? null : "email")}>
                  Email update
                </Btn>
                <span className="mx-1 h-5 w-px bg-slate-200" />
                <LogoutButton />
              </>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4">
          <nav className="-mb-px flex max-w-full gap-1 overflow-x-auto" aria-label="Views">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const on = view === v.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setView(v.key)}
                  aria-current={on ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] font-medium transition ${
                    on
                      ? "border-brand text-brand"
                      : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
                  }`}
                >
                  <Icon size={15} aria-hidden />
                  {v.label}
                </button>
              );
            })}
          </nav>

          {view === "gantt" && (
            <div className="flex flex-wrap items-center gap-3 pb-2">
              <div className="flex overflow-hidden rounded-md border-2 border-slate-200" role="group" aria-label="Zoom">
                {(["day", "week", "month"] as Zoom[]).map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZoom(z)}
                    aria-pressed={zoom === z}
                    className={`px-2.5 py-0.5 text-[12.5px] capitalize transition ${
                      zoom === z ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {z}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={showCritical}
                  onChange={(e) => setShowCritical(e.target.checked)}
                />
                Critical path
              </label>
              <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={showBaseline}
                  onChange={(e) => setShowBaseline(e.target.checked)}
                />
                Baseline
              </label>
            </div>
          )}
        </div>

        {view === "gantt" && !readOnly && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 bg-slate-50 px-4 py-2">
            <Btn icon={Plus} onClick={() => addTask()}>
              Task
            </Btn>
            <Btn icon={CornerDownRight} onClick={() => addTask({ asChild: true })} disabled={!first}>
              Sub-task
            </Btn>
            <Btn icon={ListPlus} onClick={() => addTask({ above: true })} disabled={!first}>
              Task above
            </Btn>
            <Btn icon={Diamond} onClick={() => addTask({ milestone: true })}>
              Milestone
            </Btn>
            <Divider />
            <Btn icon={IndentDecrease} onClick={outdent} disabled={!first?.parentId} title="Outdent (move left)" />
            <Btn icon={IndentIncrease} onClick={indent} disabled={!first} title="Indent (make a sub-task)" />
            <Btn icon={ArrowUp} onClick={moveUp} disabled={!first} title="Move up" />
            <Btn icon={ArrowDown} onClick={moveDown} disabled={!first} title="Move down" />
            <Divider />
            <Btn
              icon={Link2}
              onClick={linkSelected}
              disabled={selected.length < 2}
              title="Link selected tasks finish-to-start (Ctrl/Shift-click to select several)"
            >
              Link
            </Btn>
            <Btn icon={Spline} onClick={() => setPanel("links")}>
              Manage links
            </Btn>
            <Btn icon={Trash2} tone="danger" onClick={removeSelected} disabled={!selected.length}>
              Delete
            </Btn>
            <Divider />
            <Btn icon={Bookmark} onClick={saveBaseline} title="Snapshot today's dates to measure slippage against">
              Save baseline
            </Btn>
            {hasBaseline && (
              <Btn icon={BookmarkX} onClick={() => run(() => api(`/api/projects/${project.id}/baseline`, "DELETE"))}>
                Clear baseline
              </Btn>
            )}
            <Btn icon={CalendarCog} onClick={() => setPanel("settings")}>
              Working calendar
            </Btn>
            {busy && (
              <span className="ml-2 inline-flex items-center gap-1 text-[12px] text-slate-500">
                <LoaderCircle size={13} className="animate-spin" aria-hidden /> Saving…
              </span>
            )}
          </div>
        )}

        {(error || notice || schedule.errors.length > 0) && (
          <div className="space-y-1 px-4 pb-2">
            {error && (
              <p className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-1.5 text-[13px] text-red-700 ring-1 ring-red-200">
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
                  <X size={14} />
                </button>
              </p>
            )}
            {notice && (
              <p className="flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-1.5 text-[13px] text-emerald-800 ring-1 ring-emerald-200">
                <span className="flex-1">{notice}</span>
                <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
                  <X size={14} />
                </button>
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
                    onToggleCollapse={toggleCollapse}
                    onPatch={patchTask}
                    onSetStart={setTaskStart}
                    onSetFinish={setTaskFinish}
                    onSetOwner={setOwner}
                    onSetPredecessors={setTaskPredecessors}
                    onRowHeights={setRowHeights}
                  />
                </div>
                <GanttChart
                  project={project}
                  tasks={visible}
                  rowHeights={rowHeights}
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
              onSaveLayout={readOnly ? undefined : saveTableLayout}
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

// Shared domain types for the EaaS project scheduler.

export type DependencyType = "FS" | "SS" | "FF" | "SF";

/** Board column a task sits in. Kept in step with percentComplete. */
export type TaskStatus = "not_started" | "in_progress" | "blocked" | "done";

export const TASK_STATUSES: { key: TaskStatus; label: string; colour: string }[] = [
  { key: "not_started", label: "Not started", colour: "#64748b" },
  { key: "in_progress", label: "In progress", colour: "#2563eb" },
  { key: "blocked", label: "Blocked", colour: "#dc2626" },
  { key: "done", label: "Done", colour: "#15803d" },
];

/** How a task is anchored in time. ASAP = fully driven by its predecessors. */
export type ConstraintType = "ASAP" | "SNET" | "MSO";

/** Risk level shown in the Table view. Null means not assessed yet. */
export type TaskRisk = "low" | "medium" | "high";

export interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  /** Position among siblings. Determines display order within a parent. */
  sortOrder: number;
  name: string;
  /** Duration in *working* days. 0 = milestone. */
  duration: number;
  /** Manually pinned start (only meaningful for SNET / MSO). ISO yyyy-mm-dd. */
  constraintType: ConstraintType;
  constraintDate: string | null;
  percentComplete: number;
  status: TaskStatus;
  notes: string | null;
  /** Free-text planning fields shown in the Table view. */
  objectives: string | null;
  guidance: string | null;
  remarks: string | null;
  risk: TaskRisk | null;
  /** Baseline snapshot, null until a baseline is saved. */
  baselineStart: string | null;
  baselineFinish: string | null;
  baselineDuration: number | null;
  createdAt: string;
}

export interface Dependency {
  id: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  /** Lag in working days. Negative = lead. */
  lag: number;
}

export interface Resource {
  id: string;
  projectId: string;
  name: string;
  email: string | null;
  role: string | null;
  /** Cost per working day, used for simple cost rollups. */
  dayRate: number;
}

export interface Assignment {
  id: string;
  taskId: string;
  resourceId: string;
  /** Percentage of the resource's time, 0-100. */
  units: number;
}

export type UserRole = "admin" | "user";
export type UserStatus = "invited" | "active" | "disabled";

/** A person who can sign in. Each user sees only the plans they own (the admin sees all). */
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  sessionVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface UserWithStats extends User {
  planCount: number;
  /** True while an unexpired invite or reset link exists. */
  hasPendingLink: boolean;
}

export interface Project {
  id: string;
  /** The user who owns this plan. */
  ownerId: string | null;
  name: string;
  description: string | null;
  /** Project start date, ISO yyyy-mm-dd. Tasks with no predecessor begin here. */
  startDate: string;
  /** JSON array of ISO dates treated as non-working. */
  holidays: string[];
  /** Which weekdays are working days. 0 = Sunday .. 6 = Saturday. */
  workingDays: number[];
  /** The company this plan is for, shown to stakeholders. */
  clientName: string | null;
  /** Small logo as a data: URL (png/jpeg/webp). Null falls back to the Dafegen bird. */
  clientLogo: string | null;
  createdAt: string;
}

/** A task after the scheduling engine has run. */
export interface ScheduledTask extends Task {
  wbs: string;
  level: number;
  isSummary: boolean;
  isMilestone: boolean;
  start: string;
  finish: string;
  lateStart: string;
  lateFinish: string;
  totalFloat: number;
  isCritical: boolean;
  /** Working days early (negative) or late (positive) vs baseline finish. */
  finishVariance: number | null;
  startVariance: number | null;
  /** Rolled-up % complete for summary rows. */
  rolledPercentComplete: number;
  cost: number;
  resourceNames: string[];
  resourceIds: string[];
  /** Status after rollup — summaries derive theirs from their children. */
  effectiveStatus: TaskStatus;
}

/** A read-only link to a plan — anonymous, or a personal invite when `email` is set. */
export interface ShareLink {
  token: string;
  projectId: string;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** Stakeholder the link was emailed to; null for an anonymous link. */
  email: string | null;
  message: string | null;
  lastSentAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
}

export type AutomationTrigger =
  | "due_in_days"
  | "overdue"
  | "starting_in_days"
  | "not_started_but_should_be"
  | "status_is";

export type AutomationAction = "email_owner" | "email_addresses";

export interface AutomationRule {
  id: string;
  projectId: string;
  name: string;
  trigger: AutomationTrigger;
  /** Days for the day-based triggers; ignored otherwise. */
  triggerDays: number;
  /** Status to match for the status_is trigger. */
  triggerStatus: TaskStatus | null;
  action: AutomationAction;
  /** Comma-separated addresses for the email_addresses action. */
  actionEmails: string | null;
  /** Include one-click update buttons in the email. */
  includeButtons: number;
  enabled: number;
  lastRunAt: string | null;
  createdAt: string;
}

/** Everything the UI needs for one project. Safe to import from client code. */
export interface ProjectBundleData {
  project: Project;
  dependencies: Dependency[];
  resources: Resource[];
  assignments: Assignment[];
  schedule: ScheduleResult;
  shareLinks: ShareLink[];
  automations: AutomationRule[];
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  projectStart: string;
  projectFinish: string;
  totalDuration: number;
  criticalPath: string[];
  errors: string[];
}

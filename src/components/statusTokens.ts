import type { TaskRisk, TaskStatus } from "@/lib/types";

/**
 * Status colours come from the reserved status palette, not the categorical
 * series palette. Green-vs-red is deliberately not colourblind-separable, so
 * every status mark in this app ships with an icon AND a text label — colour
 * never carries the meaning on its own.
 */
export const STATUS_TOKENS: Record<
  TaskStatus,
  { label: string; icon: string; colour: string; tint: string; ring: string }
> = {
  not_started: {
    label: "Not started",
    icon: "○",
    colour: "#898781",
    tint: "#f4f4f2",
    ring: "#d8d7d1",
  },
  in_progress: {
    label: "In progress",
    icon: "◐",
    colour: "#2a78d6",
    tint: "#eaf2fd",
    ring: "#b7d3f6",
  },
  blocked: {
    label: "Blocked",
    icon: "▲",
    colour: "#d03b3b",
    tint: "#fdeded",
    ring: "#f4c3c3",
  },
  done: {
    label: "Done",
    icon: "✓",
    colour: "#0ca30c",
    tint: "#eaf7ea",
    ring: "#bfe5bf",
  },
};

export const STATUS_ORDER: TaskStatus[] = ["not_started", "in_progress", "blocked", "done"];

/** "none" covers a task whose risk hasn't been assessed yet. */
export const RISK_TOKENS: Record<
  TaskRisk | "none",
  { label: string; icon: string; colour: string; tint: string; ring: string }
> = {
  none: {
    label: "Not set",
    icon: "–",
    colour: "#898781",
    tint: "#f4f4f2",
    ring: "#d8d7d1",
  },
  low: {
    label: "Low",
    icon: "○",
    colour: "#0ca30c",
    tint: "#eaf7ea",
    ring: "#bfe5bf",
  },
  medium: {
    label: "Medium",
    icon: "◐",
    colour: "#b45309",
    tint: "#fef3e2",
    ring: "#fbd9a5",
  },
  high: {
    label: "High",
    icon: "▲",
    colour: "#d03b3b",
    tint: "#fdeded",
    ring: "#f4c3c3",
  },
};

export const RISK_ORDER: TaskRisk[] = ["low", "medium", "high"];

/** Single-hue blue for magnitude charts — one series, so no CVD risk. */
export const SEQ_BLUE = {
  fill: "#2a78d6",
  fillSoft: "#9ec5f4",
  track: "#eef1f5",
};

export const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
};

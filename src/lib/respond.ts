import { consumeUpdateToken, getTask, getUpdateToken, logActivity, updateTask } from "@/lib/db";

const CHOICES = new Set(["complete", "on_track", "delayed"]);

/** Applies an emailed one-click response. Returns a plain-language outcome. */
export function applyResponse(token: string, choice: string, extraDays = 0) {
  const record = getUpdateToken(token);
  if (!record) return { ok: false as const, message: "This link is not valid." };
  if (new Date(record.expiresAt).getTime() < Date.now())
    return { ok: false as const, message: "This link has expired. Ask for a fresh update email." };
  if (record.usedAt)
    return {
      ok: false as const,
      message: "You have already replied using this link — the plan is up to date. Ask for a fresh email to change your answer.",
    };
  if (!CHOICES.has(choice)) return { ok: false as const, message: "Unrecognised action." };

  const task = record.taskId ? getTask(record.taskId) : null;
  if (!task) return { ok: false as const, message: "That task no longer exists." };

  let message: string;
  if (choice === "complete") {
    updateTask(task.id, { percentComplete: 100 });
    message = `Thanks — "${task.name}" is marked 100% complete.`;
  } else if (choice === "on_track") {
    message = `Thanks — "${task.name}" recorded as on track.`;
  } else {
    const days = Math.max(1, Math.min(365, Math.round(extraDays || 0)));
    updateTask(task.id, { duration: Math.max(0, task.duration) + days });
    message = `Thanks — "${task.name}" extended by ${days} working day${days === 1 ? "" : "s"}. Anything that follows it has been rescheduled.`;
  }

  logActivity({
    projectId: record.projectId,
    taskId: task.id,
    actor: record.recipientEmail,
    message:
      choice === "complete"
        ? `marked "${task.name}" complete`
        : choice === "on_track"
          ? `confirmed "${task.name}" is on track`
          : `reported a delay of ${extraDays} day(s) on "${task.name}"`,
  });

  // "Running late" stays reusable so a longer delay can be reported again.
  if (choice !== "delayed") consumeUpdateToken(token);

  return { ok: true as const, message, projectId: record.projectId, taskName: task.name };
}

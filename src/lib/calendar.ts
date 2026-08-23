// Working-day calendar maths. Everything speaks ISO "yyyy-mm-dd" strings so
// that dates survive JSON round-trips without timezone drift.

export const DAY_MS = 86_400_000;

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISO(iso: string): Date {
  // Anchor at UTC noon so DST shifts can never roll a date backwards.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function dayOfWeek(iso: string): number {
  return parseISO(iso).getUTCDay();
}

export function calendarDaysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY_MS);
}

export class WorkCalendar {
  private working: Set<number>;
  private holidays: Set<string>;

  constructor(workingDays: number[] = [1, 2, 3, 4, 5], holidays: string[] = []) {
    this.working = new Set(workingDays.length ? workingDays : [1, 2, 3, 4, 5]);
    this.holidays = new Set(holidays);
  }

  isWorkingDay(iso: string): boolean {
    return this.working.has(dayOfWeek(iso)) && !this.holidays.has(iso);
  }

  /** Nudge forward to the next working day (returns the same day if it works). */
  nextWorkingDay(iso: string): string {
    let cur = iso;
    for (let i = 0; i < 3650 && !this.isWorkingDay(cur); i++) cur = addDays(cur, 1);
    return cur;
  }

  prevWorkingDay(iso: string): string {
    let cur = iso;
    for (let i = 0; i < 3650 && !this.isWorkingDay(cur); i++) cur = addDays(cur, -1);
    return cur;
  }

  /**
   * Move `n` working days from `iso`. n=0 just normalises onto a working day.
   * Positive moves forward, negative moves back.
   */
  addWorkingDays(iso: string, n: number): string {
    let cur = n >= 0 ? this.nextWorkingDay(iso) : this.prevWorkingDay(iso);
    const step = n >= 0 ? 1 : -1;
    let remaining = Math.abs(n);
    let guard = 0;
    while (remaining > 0 && guard++ < 36_500) {
      cur = addDays(cur, step);
      if (this.isWorkingDay(cur)) remaining--;
    }
    return cur;
  }

  /** Inclusive count of working days from `a` to `b`. Negative if b < a. */
  workingDaysBetween(a: string, b: string): number {
    if (calendarDaysBetween(a, b) < 0) return -this.workingDaysBetween(b, a);
    let count = 0;
    let cur = a;
    let guard = 0;
    while (calendarDaysBetween(cur, b) >= 0 && guard++ < 36_500) {
      if (this.isWorkingDay(cur)) count++;
      cur = addDays(cur, 1);
    }
    return count;
  }

  /** Finish date for a task starting on `start` and lasting `duration` working days. */
  finishFor(start: string, duration: number): string {
    if (duration <= 0) return this.nextWorkingDay(start);
    return this.addWorkingDays(start, duration - 1);
  }

  /** Start date for a task finishing on `finish` and lasting `duration` working days. */
  startFor(finish: string, duration: number): string {
    if (duration <= 0) return this.prevWorkingDay(finish);
    return this.addWorkingDays(finish, -(duration - 1));
  }
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

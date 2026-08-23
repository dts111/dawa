// Excel export: an MS Project-style workbook built with ExcelJS.
//
// Sheet 1 "Gantt Chart"  – task table on the left, painted timeline on the right
// Sheet 2 "Task Table"   – flat, filterable data for pivots
// Sheet 3 "Resources"    – resource list with allocation and cost
// Sheet 4 "Summary"      – headline project numbers

import ExcelJS from "exceljs";
import { WorkCalendar, addDays, calendarDaysBetween, parseISO, todayISO } from "./calendar";
import { predecessorLabel } from "./schedule";
import type { ProjectBundle } from "./projectData";

const COLOURS = {
  header: "FF1F3864",
  headerText: "FFFFFFFF",
  summaryBar: "FF404040",
  taskBar: "FF2E75B6",
  criticalBar: "FFC00000",
  progressBar: "FF1F4E79",
  baselineBar: "FFBFBFBF",
  milestone: "FF7030A0",
  weekend: "FFF2F2F2",
  today: "FFFFE699",
  band: "FFF7F9FC",
};

/** Weekly buckets once a project runs long, so the sheet stays printable. */
function buildTimeline(start: string, finish: string) {
  const spanDays = Math.max(1, calendarDaysBetween(start, finish) + 1);
  const unit: "day" | "week" = spanDays <= 90 ? "day" : "week";
  const step = unit === "day" ? 1 : 7;

  // Weekly columns start on the Monday of the project's first week.
  let cursor = start;
  if (unit === "week") {
    const dow = parseISO(start).getUTCDay();
    cursor = addDays(start, dow === 0 ? -6 : 1 - dow);
  }

  const cols: { start: string; end: string }[] = [];
  let guard = 0;
  while (calendarDaysBetween(cursor, finish) >= 0 && guard++ < 400) {
    cols.push({ start: cursor, end: addDays(cursor, step - 1) });
    cursor = addDays(cursor, step);
  }
  return { unit, cols };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string) {
  const d = parseISO(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}

export async function buildWorkbook(bundle: ProjectBundle): Promise<Buffer> {
  const { project, schedule, dependencies, resources, assignments } = bundle;
  const cal = new WorkCalendar(project.workingDays, project.holidays);
  const today = todayISO();

  const wb = new ExcelJS.Workbook();
  wb.creator = "EaaS Project Management";
  wb.created = new Date();

  // ---------------------------------------------------------------- Gantt ---
  const gs = wb.addWorksheet("Gantt Chart", {
    views: [{ state: "frozen", xSplit: 8, ySplit: 3 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const tableHeaders = [
    "WBS",
    "Task Name",
    "Dur (d)",
    "Start",
    "Finish",
    "% Done",
    "Predecessors",
    "Resources",
  ];
  const FIXED = tableHeaders.length;
  const { unit, cols } = buildTimeline(schedule.projectStart, schedule.projectFinish);

  // Title row
  gs.mergeCells(1, 1, 1, FIXED + Math.max(cols.length, 1));
  const title = gs.getCell(1, 1);
  title.value = `${project.name} — Schedule`;
  title.font = { bold: true, size: 16, color: { argb: COLOURS.header } };
  gs.getRow(1).height = 24;

  // Period band row (month labels above the timeline)
  const bandRow = gs.getRow(2);
  bandRow.height = 16;
  let bandStart = 0;
  for (let i = 0; i < cols.length; i++) {
    const cur = parseISO(cols[i].start).getUTCMonth();
    const next = i + 1 < cols.length ? parseISO(cols[i + 1].start).getUTCMonth() : -1;
    if (cur !== next) {
      const from = FIXED + 1 + bandStart;
      const to = FIXED + 1 + i;
      if (to > from) gs.mergeCells(2, from, 2, to);
      const c = gs.getCell(2, from);
      const d = parseISO(cols[i].start);
      c.value = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      c.alignment = { horizontal: "center" };
      c.font = { bold: true, size: 9, color: { argb: COLOURS.headerText } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.header } };
      bandStart = i + 1;
    }
  }

  // Header row
  const header = gs.getRow(3);
  tableHeaders.forEach((h, i) => {
    const c = header.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: COLOURS.headerText }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.header } };
    c.alignment = { vertical: "middle", horizontal: i === 1 ? "left" : "center", wrapText: true };
  });
  cols.forEach((col, i) => {
    const c = header.getCell(FIXED + 1 + i);
    c.value = unit === "day" ? String(parseISO(col.start).getUTCDate()) : shortDate(col.start);
    c.font = { bold: true, size: 8, color: { argb: COLOURS.headerText } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.header } };
    c.alignment = { horizontal: "center" };
  });
  header.height = 28;

  gs.getColumn(1).width = 9;
  gs.getColumn(2).width = 42;
  gs.getColumn(3).width = 8;
  gs.getColumn(4).width = 12;
  gs.getColumn(5).width = 12;
  gs.getColumn(6).width = 8;
  gs.getColumn(7).width = 16;
  gs.getColumn(8).width = 22;
  for (let i = 0; i < cols.length; i++) {
    gs.getColumn(FIXED + 1 + i).width = unit === "day" ? 2.8 : 4.5;
  }

  schedule.tasks.forEach((t, idx) => {
    const r = gs.getRow(4 + idx);
    r.height = 16;

    r.getCell(1).value = t.wbs;
    const nameCell = r.getCell(2);
    nameCell.value = t.name;
    nameCell.alignment = { indent: t.level * 2 };
    nameCell.font = { bold: t.isSummary, size: 10 };

    r.getCell(3).value = t.isMilestone ? 0 : t.duration;
    r.getCell(4).value = parseISO(t.start);
    r.getCell(5).value = parseISO(t.finish);
    r.getCell(4).numFmt = "dd mmm yyyy";
    r.getCell(5).numFmt = "dd mmm yyyy";
    r.getCell(6).value = t.rolledPercentComplete / 100;
    r.getCell(6).numFmt = "0%";
    r.getCell(7).value = predecessorLabel(t.id, dependencies, schedule.tasks);
    r.getCell(8).value = t.resourceNames.join(", ");

    for (let i = 1; i <= FIXED; i++) {
      r.getCell(i).border = {
        top: { style: "hair", color: { argb: "FFD9D9D9" } },
        bottom: { style: "hair", color: { argb: "FFD9D9D9" } },
        left: { style: "hair", color: { argb: "FFD9D9D9" } },
        right: { style: "hair", color: { argb: "FFD9D9D9" } },
      };
      if (idx % 2 === 1) {
        r.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.band } };
      }
    }
    // Paint the bars.
    const progressEnd =
      t.rolledPercentComplete > 0
        ? cal.addWorkingDays(t.start, Math.max(0, Math.round((t.duration * t.rolledPercentComplete) / 100) - 1))
        : null;

    cols.forEach((col, i) => {
      const cell = r.getCell(FIXED + 1 + i);
      const overlaps = calendarDaysBetween(col.start, t.finish) >= 0 && calendarDaysBetween(t.start, col.end) >= 0;
      const isWeekendCol = unit === "day" && !cal.isWorkingDay(col.start);
      const isToday = calendarDaysBetween(col.start, today) >= 0 && calendarDaysBetween(today, col.end) >= 0;

      let fill: string | null = null;
      if (overlaps) {
        if (t.isMilestone) fill = COLOURS.milestone;
        else if (t.isSummary) fill = COLOURS.summaryBar;
        else if (t.isCritical) fill = COLOURS.criticalBar;
        else fill = COLOURS.taskBar;
        if (progressEnd && calendarDaysBetween(col.end, progressEnd) >= 0 && !t.isSummary && !t.isMilestone) {
          fill = COLOURS.progressBar;
        }
      } else if (
        t.baselineStart &&
        t.baselineFinish &&
        calendarDaysBetween(col.start, t.baselineFinish) >= 0 &&
        calendarDaysBetween(t.baselineStart, col.end) >= 0
      ) {
        fill = COLOURS.baselineBar;
      } else if (isToday) {
        fill = COLOURS.today;
      } else if (isWeekendCol) {
        fill = COLOURS.weekend;
      }

      if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      if (t.isMilestone && overlaps) {
        cell.value = "◆";
        cell.alignment = { horizontal: "center" };
        cell.font = { size: 8, color: { argb: "FFFFFFFF" } };
      }
    });
  });

  // Legend
  const legendRow = 4 + schedule.tasks.length + 2;
  const legend: [string, string][] = [
    ["Summary", COLOURS.summaryBar],
    ["Task", COLOURS.taskBar],
    ["Critical path", COLOURS.criticalBar],
    ["Complete", COLOURS.progressBar],
    ["Baseline", COLOURS.baselineBar],
    ["Milestone", COLOURS.milestone],
  ];
  legend.forEach(([label, colour], i) => {
    const c = gs.getCell(legendRow, 1 + i * 2);
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colour } };
    const l = gs.getCell(legendRow, 2 + i * 2);
    l.value = label;
    l.font = { size: 9 };
  });

  // ----------------------------------------------------------- Task table ---
  const ts = wb.addWorksheet("Task Table", { views: [{ state: "frozen", ySplit: 1 }] });
  ts.columns = [
    { header: "WBS", key: "wbs", width: 10 },
    { header: "Task Name", key: "name", width: 44 },
    { header: "Level", key: "level", width: 7 },
    { header: "Type", key: "type", width: 11 },
    { header: "Duration (d)", key: "duration", width: 12 },
    { header: "Start", key: "start", width: 13 },
    { header: "Finish", key: "finish", width: 13 },
    { header: "% Complete", key: "pct", width: 12 },
    { header: "Predecessors", key: "preds", width: 18 },
    { header: "Resources", key: "res", width: 26 },
    { header: "Objectives", key: "objectives", width: 32 },
    { header: "Risk", key: "risk", width: 10 },
    { header: "Guidance", key: "guidance", width: 32 },
    { header: "Remarks", key: "remarks", width: 32 },
    { header: "Total Float (d)", key: "float", width: 14 },
    { header: "Critical", key: "critical", width: 10 },
    { header: "Baseline Start", key: "bstart", width: 14 },
    { header: "Baseline Finish", key: "bfinish", width: 14 },
    { header: "Finish Variance (d)", key: "var", width: 18 },
    { header: "Cost", key: "cost", width: 12 },
  ];
  ts.getRow(1).font = { bold: true, color: { argb: COLOURS.headerText } };
  ts.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.header } };

  schedule.tasks.forEach((t) => {
    const row = ts.addRow({
      wbs: t.wbs,
      name: t.name,
      level: t.level,
      type: t.isSummary ? "Summary" : t.isMilestone ? "Milestone" : "Task",
      duration: t.duration,
      start: parseISO(t.start),
      finish: parseISO(t.finish),
      pct: t.rolledPercentComplete / 100,
      preds: predecessorLabel(t.id, dependencies, schedule.tasks),
      res: t.resourceNames.join(", "),
      objectives: t.objectives ?? "",
      risk: t.risk ? t.risk.charAt(0).toUpperCase() + t.risk.slice(1) : "",
      guidance: t.guidance ?? "",
      remarks: t.remarks ?? "",
      float: t.isSummary ? "" : t.totalFloat,
      critical: t.isSummary ? "" : t.isCritical ? "Yes" : "No",
      bstart: t.baselineStart ? parseISO(t.baselineStart) : "",
      bfinish: t.baselineFinish ? parseISO(t.baselineFinish) : "",
      var: t.finishVariance ?? "",
      cost: t.cost,
    });
    row.getCell("start").numFmt = "dd mmm yyyy";
    row.getCell("finish").numFmt = "dd mmm yyyy";
    row.getCell("bstart").numFmt = "dd mmm yyyy";
    row.getCell("bfinish").numFmt = "dd mmm yyyy";
    row.getCell("pct").numFmt = "0%";
    row.getCell("cost").numFmt = "#,##0.00";
    row.getCell("objectives").alignment = { wrapText: true, vertical: "top" };
    row.getCell("guidance").alignment = { wrapText: true, vertical: "top" };
    row.getCell("remarks").alignment = { wrapText: true, vertical: "top" };
    if (t.isSummary) row.font = { bold: true };
    if (typeof t.finishVariance === "number" && t.finishVariance > 0) {
      row.getCell("var").font = { color: { argb: COLOURS.criticalBar }, bold: true };
    }
    if (t.risk === "high") {
      row.getCell("risk").font = { color: { argb: COLOURS.criticalBar }, bold: true };
    }
  });
  ts.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ts.columns.length } };

  // ------------------------------------------------------------ Resources ---
  const rs = wb.addWorksheet("Resources");
  rs.columns = [
    { header: "Resource", key: "name", width: 28 },
    { header: "Role", key: "role", width: 24 },
    { header: "Email", key: "email", width: 30 },
    { header: "Day Rate", key: "rate", width: 12 },
    { header: "Tasks Assigned", key: "count", width: 15 },
    { header: "Working Days", key: "days", width: 14 },
    { header: "Cost", key: "cost", width: 14 },
  ];
  rs.getRow(1).font = { bold: true, color: { argb: COLOURS.headerText } };
  rs.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOURS.header } };

  const taskById = new Map(schedule.tasks.map((t) => [t.id, t]));
  for (const r of resources) {
    const mine = assignments.filter((a) => a.resourceId === r.id);
    const days = mine.reduce((acc, a) => acc + (taskById.get(a.taskId)?.duration ?? 0), 0);
    const row = rs.addRow({
      name: r.name,
      role: r.role ?? "",
      email: r.email ?? "",
      rate: r.dayRate,
      count: mine.length,
      days,
      cost: days * r.dayRate,
    });
    row.getCell("rate").numFmt = "#,##0.00";
    row.getCell("cost").numFmt = "#,##0.00";
  }

  // -------------------------------------------------------------- Summary ---
  const ss = wb.addWorksheet("Summary");
  ss.getColumn(1).width = 30;
  ss.getColumn(2).width = 28;
  const leaves = schedule.tasks.filter((t) => !t.isSummary);
  const done = leaves.filter((t) => t.percentComplete >= 100).length;
  const late = leaves.filter((t) => t.finishVariance !== null && t.finishVariance > 0).length;
  const overall = schedule.tasks.filter((t) => t.level === 0);
  const overallPct =
    overall.length > 0
      ? Math.round(
          overall.reduce((a, t) => a + t.rolledPercentComplete * Math.max(1, t.duration), 0) /
            overall.reduce((a, t) => a + Math.max(1, t.duration), 0),
        )
      : 0;

  const rows: [string, string | number][] = [
    ["Project", project.name],
    ["Exported", todayISO()],
    ["Project start", schedule.projectStart],
    ["Project finish", schedule.projectFinish],
    ["Duration (working days)", schedule.totalDuration],
    ["Total tasks", schedule.tasks.length],
    ["Deliverable tasks", leaves.length],
    ["Completed", done],
    ["Overall % complete", `${overallPct}%`],
    ["Critical tasks", schedule.criticalPath.length],
    ["Tasks late vs baseline", late],
    ["Total cost", schedule.tasks.filter((t) => t.level === 0).reduce((a, t) => a + t.cost, 0)],
  ];
  ss.getCell(1, 1).value = `${project.name} — Summary`;
  ss.getCell(1, 1).font = { bold: true, size: 14, color: { argb: COLOURS.header } };
  rows.forEach(([k, v], i) => {
    ss.getCell(i + 3, 1).value = k;
    ss.getCell(i + 3, 1).font = { bold: true };
    ss.getCell(i + 3, 2).value = v;
  });

  if (schedule.errors.length) {
    ss.getCell(rows.length + 5, 1).value = "Warnings";
    ss.getCell(rows.length + 5, 1).font = { bold: true, color: { argb: COLOURS.criticalBar } };
    schedule.errors.forEach((e, i) => {
      ss.getCell(rows.length + 6 + i, 1).value = e;
    });
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

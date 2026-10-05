import { NextResponse } from "next/server";
import {
  createDependency,
  createProject,
  createResource,
  createTask,
  setTaskAssignments,
  updateTask,
} from "@/lib/db";
import { todayISO, addDays } from "@/lib/calendar";

export const runtime = "nodejs";

/**
 * Creates a worked example so the app is not an empty page on first run.
 * Everything here is ordinary demo content — delete the project when done.
 */
export async function POST() {
  const start = addDays(todayISO(), -10);
  const project = await createProject({
    name: "EaaS Deployment — Demo Site",
    description: "Example plan showing summaries, links, milestones, resources and a baseline.",
    startDate: start,
  });

  // Placeholder addresses so the email previews work out of the box. Swap them
  // for real ones (or delete the demo project) before sending anything.
  const teamInput = [
    { name: "Project Manager", role: "Project Manager", dayRate: 550, email: "pm@example.com" },
    { name: "Site Engineer", role: "Engineering", dayRate: 420, email: "engineer@example.com" },
    { name: "Commercial Lead", role: "Commercial", dayRate: 480, email: "commercial@example.com" },
    { name: "Install Contractor", role: "Delivery", dayRate: 700, email: "contractor@example.com" },
  ];
  const team = [];
  for (const r of teamInput) team.push(await createResource({ projectId: project.id, ...r }));

  let order = 0;
  const t = async (name: string, duration: number, parentId: string | null = null, pct = 0) =>
    await createTask({ projectId: project.id, name, duration, parentId, sortOrder: (order += 10), percentComplete: pct });

  const phase1 = await t("1. Feasibility & survey", 0);
  const a1 = await t("Site survey and load profiling", 5, phase1.id, 100);
  const a2 = await t("Energy modelling and options appraisal", 6, phase1.id, 100);
  const a3 = await t("Outline business case", 4, phase1.id, 60);
  const m1 = await t("Feasibility sign-off", 0, phase1.id);

  const phase2 = await t("2. Design & procurement", 0);
  const b1 = await t("Detailed design", 12, phase2.id, 20);
  const b2 = await t("Planning and DNO application", 20, phase2.id, 10);
  const b3 = await t("Tender pack and contractor selection", 10, phase2.id);
  const b4 = await t("Long-lead equipment order", 8, phase2.id);
  const m2 = await t("Contract award", 0, phase2.id);

  const phase3 = await t("3. Installation", 0);
  const c1 = await t("Enabling works", 6, phase3.id);
  const c2 = await t("Plant room installation", 15, phase3.id);
  const c3 = await t("Electrical and controls", 10, phase3.id);
  const c4 = await t("Commissioning and witness testing", 6, phase3.id);

  const phase4 = await t("4. Handover & service", 0);
  const d1 = await t("O&M documentation and training", 5, phase4.id);
  const d2 = await t("Performance monitoring set-up", 4, phase4.id);
  const m3 = await t("Service go-live", 0, phase4.id);

  const link = async (p: { id: string }, s: { id: string }, lag = 0) =>
    await createDependency({ projectId: project.id, predecessorId: p.id, successorId: s.id, type: "FS", lag });

  await link(a1, a2);
  await link(a2, a3);
  await link(a3, m1);
  await link(m1, b1);
  await link(b1, b2);
  await link(b1, b3);
  await link(b3, m2);
  await link(m2, b4);
  await link(b4, c1, 5);
  await link(c1, c2);
  await link(c2, c3);
  await link(c3, c4);
  await link(c4, d1);
  await link(c4, d2);
  await link(d1, m3);
  await link(d2, m3);

  await setTaskAssignments(a1.id, [team[1].id]);
  await setTaskAssignments(a2.id, [team[1].id]);
  await setTaskAssignments(a3.id, [team[0].id, team[2].id]);
  await setTaskAssignments(b1.id, [team[1].id]);
  await setTaskAssignments(b2.id, [team[0].id]);
  await setTaskAssignments(b3.id, [team[2].id]);
  await setTaskAssignments(c2.id, [team[3].id]);
  await setTaskAssignments(c3.id, [team[3].id]);
  await setTaskAssignments(c4.id, [team[1].id, team[3].id]);
  await setTaskAssignments(d1.id, [team[0].id]);

  // One blocked item so the board and dashboard show something interesting.
  await updateTask(b2.id, { status: "blocked" });

  return NextResponse.json({ projectId: project.id }, { status: 201 });
}

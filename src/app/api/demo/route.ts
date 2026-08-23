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
  const project = createProject({
    name: "EaaS Deployment — Demo Site",
    description: "Example plan showing summaries, links, milestones, resources and a baseline.",
    startDate: start,
  });

  // Placeholder addresses so the email previews work out of the box. Swap them
  // for real ones (or delete the demo project) before sending anything.
  const team = [
    { name: "Project Manager", role: "Project Manager", dayRate: 550, email: "pm@example.com" },
    { name: "Site Engineer", role: "Engineering", dayRate: 420, email: "engineer@example.com" },
    { name: "Commercial Lead", role: "Commercial", dayRate: 480, email: "commercial@example.com" },
    { name: "Install Contractor", role: "Delivery", dayRate: 700, email: "contractor@example.com" },
  ].map((r) => createResource({ projectId: project.id, ...r }));

  let order = 0;
  const t = (name: string, duration: number, parentId: string | null = null, pct = 0) =>
    createTask({ projectId: project.id, name, duration, parentId, sortOrder: (order += 10), percentComplete: pct });

  const phase1 = t("1. Feasibility & survey", 0);
  const a1 = t("Site survey and load profiling", 5, phase1.id, 100);
  const a2 = t("Energy modelling and options appraisal", 6, phase1.id, 100);
  const a3 = t("Outline business case", 4, phase1.id, 60);
  const m1 = t("Feasibility sign-off", 0, phase1.id);

  const phase2 = t("2. Design & procurement", 0);
  const b1 = t("Detailed design", 12, phase2.id, 20);
  const b2 = t("Planning and DNO application", 20, phase2.id, 10);
  const b3 = t("Tender pack and contractor selection", 10, phase2.id);
  const b4 = t("Long-lead equipment order", 8, phase2.id);
  const m2 = t("Contract award", 0, phase2.id);

  const phase3 = t("3. Installation", 0);
  const c1 = t("Enabling works", 6, phase3.id);
  const c2 = t("Plant room installation", 15, phase3.id);
  const c3 = t("Electrical and controls", 10, phase3.id);
  const c4 = t("Commissioning and witness testing", 6, phase3.id);

  const phase4 = t("4. Handover & service", 0);
  const d1 = t("O&M documentation and training", 5, phase4.id);
  const d2 = t("Performance monitoring set-up", 4, phase4.id);
  const m3 = t("Service go-live", 0, phase4.id);

  const link = (p: { id: string }, s: { id: string }, lag = 0) =>
    createDependency({ projectId: project.id, predecessorId: p.id, successorId: s.id, type: "FS", lag });

  link(a1, a2);
  link(a2, a3);
  link(a3, m1);
  link(m1, b1);
  link(b1, b2);
  link(b1, b3);
  link(b3, m2);
  link(m2, b4);
  link(b4, c1, 5);
  link(c1, c2);
  link(c2, c3);
  link(c3, c4);
  link(c4, d1);
  link(c4, d2);
  link(d1, m3);
  link(d2, m3);

  setTaskAssignments(a1.id, [team[1].id]);
  setTaskAssignments(a2.id, [team[1].id]);
  setTaskAssignments(a3.id, [team[0].id, team[2].id]);
  setTaskAssignments(b1.id, [team[1].id]);
  setTaskAssignments(b2.id, [team[0].id]);
  setTaskAssignments(b3.id, [team[2].id]);
  setTaskAssignments(c2.id, [team[3].id]);
  setTaskAssignments(c3.id, [team[3].id]);
  setTaskAssignments(c4.id, [team[1].id, team[3].id]);
  setTaskAssignments(d1.id, [team[0].id]);

  // One blocked item so the board and dashboard show something interesting.
  updateTask(b2.id, { status: "blocked" });

  return NextResponse.json({ projectId: project.id }, { status: 201 });
}

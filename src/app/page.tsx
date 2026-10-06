import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, CircleAlert, FolderKanban, ListChecks, ShieldCheck, Users } from "lucide-react";
import { currentUser } from "@/lib/access";
import { listProjects } from "@/lib/db";
import { loadProject } from "@/lib/projectData";
import { formatDate, todayISO } from "@/lib/calendar";
import NewProjectForm from "@/components/NewProjectForm";
import LogoutButton from "@/components/LogoutButton";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import RenameProjectButton from "@/components/RenameProjectButton";
import BrandMark from "@/components/BrandMark";
import ClientMark from "@/components/ClientMark";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const projects = await listProjects(user.id);
  const today = todayISO();

  // A one-line health summary per plan, from the same scheduler the plan uses.
  const summaries = await Promise.all(
    projects.map(async (p) => {
      const bundle = await loadProject(p.id);
      const tasks = bundle?.schedule.tasks ?? [];
      const leaves = tasks.filter((t) => !t.isSummary);
      const roots = tasks.filter((t) => t.level === 0);
      const weight = roots.reduce((a, t) => a + Math.max(1, t.duration), 0);
      return {
        project: p,
        taskCount: leaves.length,
        finish: bundle?.schedule.projectFinish ?? p.startDate,
        pct: weight
          ? Math.round(roots.reduce((a, t) => a + t.rolledPercentComplete * Math.max(1, t.duration), 0) / weight)
          : 0,
        overdue: leaves.filter((t) => t.finish < today && t.effectiveStatus !== "done").length,
        blocked: leaves.filter((t) => t.effectiveStatus === "blocked").length,
        viewers: bundle?.shareLinks.filter((l) => l.email).length ?? 0,
      };
    }),
  );

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-[15px] leading-tight font-bold tracking-tight text-slate-900">Dafegen</p>
              <p className="text-[12px] leading-tight text-slate-500">Project Management</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[12.5px] text-slate-500 sm:inline">{user.name === "Administrator" ? user.email : user.name}</span>
            {user.role === "admin" && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <ShieldCheck size={14} aria-hidden /> Admin
              </Link>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Project plans</h1>
          <p className="mt-1.5 max-w-2xl text-[15px] text-slate-600">
            Build a schedule, link tasks, track the critical path against a baseline, export to Excel, email the
            team for updates — and share a live, view-only plan with stakeholders.
          </p>
        </div>

        <NewProjectForm />

        <section className="mt-8">
          <h2 className="mb-3 text-[12px] font-semibold tracking-wider text-slate-500 uppercase">
            Your plans <span className="font-mono">({projects.length})</span>
          </h2>

          {projects.length === 0 && (
            <div className="flex flex-col items-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <FolderKanban size={36} className="text-brand" aria-hidden />
              <p className="mt-3 font-semibold text-slate-900">No plans yet</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                Give your first plan a name and start date above. You can add tasks, link them and invite
                stakeholders from inside the plan.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {summaries.map(({ project: p, taskCount, finish, pct, overdue, blocked, viewers }) => (
              <div
                key={p.id}
                className="group relative flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-brand-ring hover:shadow-float"
              >
                <Link href={`/project/${p.id}`} className="absolute inset-0 rounded-lg" aria-label={`Open ${p.name}`} />
                {(p.clientName || p.clientLogo) && (
                  <div className="relative mb-3 flex items-center gap-2">
                    <ClientMark name={p.clientName} logo={p.clientLogo} height={28} />
                    {p.clientName && <span className="truncate text-[12px] font-medium text-slate-500">{p.clientName}</span>}
                  </div>
                )}
                <div className="relative flex items-start justify-between gap-2">
                  <h3 className="text-[17px] leading-snug font-semibold text-slate-900 group-hover:text-brand">
                    {p.name}
                  </h3>
                  <div className="-mt-1 -mr-2 flex shrink-0 opacity-60 transition group-hover:opacity-100">
                    <RenameProjectButton projectId={p.id} projectName={p.name} />
                    <DeleteProjectButton projectId={p.id} projectName={p.name} />
                  </div>
                </div>
                {p.description && <p className="relative mt-1 line-clamp-2 text-[13px] text-slate-600">{p.description}</p>}

                <div className="relative mt-4">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-slate-500">Progress</span>
                    <span className="font-mono font-medium text-slate-900">{pct}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays size={13} aria-hidden />
                    <span className="font-mono">
                      {formatDate(p.startDate)} → {formatDate(finish)}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ListChecks size={13} aria-hidden />
                    {taskCount} task{taskCount === 1 ? "" : "s"}
                  </span>
                  {viewers > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Users size={13} aria-hidden />
                      {viewers} stakeholder{viewers === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                {(overdue > 0 || blocked > 0) && (
                  <div className="relative mt-3 flex flex-wrap gap-1.5">
                    {overdue > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-medium text-red-700 ring-1 ring-red-200">
                        <CircleAlert size={12} aria-hidden /> {overdue} overdue
                      </span>
                    )}
                    {blocked > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-800 ring-1 ring-amber-200">
                        ▲ {blocked} blocked
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

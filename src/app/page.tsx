import Link from "next/link";
import { listProjects, listTasks } from "@/lib/db";
import { formatDate } from "@/lib/calendar";
import NewProjectForm from "@/components/NewProjectForm";
import LogoutButton from "@/components/LogoutButton";
import DeleteProjectButton from "@/components/DeleteProjectButton";
import RenameProjectButton from "@/components/RenameProjectButton";

export const dynamic = "force-dynamic";

export default function Home() {
  const projects = listProjects();

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Project plans</h1>
            <p className="mt-1.5 max-w-xl text-sm text-slate-600">
              Build a schedule, link tasks, track the critical path against a baseline, export to Excel and email
              the team for updates.
            </p>
          </div>
          <LogoutButton />
        </header>

        <NewProjectForm />

        <section className="mt-8 space-y-3">
          {projects.length === 0 && (
            <p className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
              No plans yet. Create one above, or load the worked example to see how it fits together.
            </p>
          )}
          {projects.map((p) => {
            const count = listTasks(p.id).length;
            return (
              <div
                key={p.id}
                className="group relative rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300"
              >
                <Link href={`/project/${p.id}`} className="absolute inset-0" aria-label={`Open ${p.name}`} />
                <div className="relative flex items-baseline justify-between gap-2">
                  <h2 className="font-semibold text-slate-900">{p.name}</h2>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {count} task{count === 1 ? "" : "s"}
                    </span>
                    <RenameProjectButton projectId={p.id} projectName={p.name} />
                    <DeleteProjectButton projectId={p.id} projectName={p.name} />
                  </div>
                </div>
                {p.description && <p className="relative mt-1 text-[13px] text-slate-600">{p.description}</p>}
                <p className="relative mt-1.5 text-[12px] text-slate-400">Starts {formatDate(p.startDate)}</p>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}

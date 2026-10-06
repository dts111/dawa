import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { currentUser } from "@/lib/access";
import { getUserById, listProjects } from "@/lib/db";
import { formatDate } from "@/lib/calendar";
import ClientMark from "@/components/ClientMark";

export const dynamic = "force-dynamic";

export default async function AdminUserPlansPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) redirect("/login?next=/admin");
  if (me.role !== "admin") notFound();
  const { id } = await params;
  const user = await getUserById(id);
  if (!user) notFound();
  const plans = await listProjects(user.id);

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/admin" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-brand">
          <ArrowLeft size={14} aria-hidden /> All users
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{user.name}</h1>
        <p className="mt-1 text-[14px] text-slate-500">
          {user.email} · {plans.length} plan{plans.length === 1 ? "" : "s"}
        </p>

        {plans.length === 0 ? (
          <p className="mt-8 rounded-lg border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
            No plans yet.
          </p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {plans.map((p) => (
              <Link
                key={p.id}
                href={`/project/${p.id}`}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-brand-ring hover:shadow-float"
              >
                {(p.clientName || p.clientLogo) && (
                  <div className="mb-3 flex items-center gap-2">
                    <ClientMark name={p.clientName} logo={p.clientLogo} height={28} />
                    {p.clientName && <span className="truncate text-[12px] font-medium text-slate-500">{p.clientName}</span>}
                  </div>
                )}
                <p className="text-[17px] font-semibold text-slate-900">{p.name}</p>
                <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-slate-500">
                  <CalendarDays size={13} aria-hidden /> Starts {formatDate(p.startDate)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

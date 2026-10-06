import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { currentUser } from "@/lib/access";
import { listUsersWithStats } from "@/lib/db";
import BrandMark from "@/components/BrandMark";
import LogoutButton from "@/components/LogoutButton";
import UsersAdmin from "@/components/UsersAdmin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin — users" };

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") notFound();
  const users = await listUsersWithStats();

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-[15px] leading-tight font-bold tracking-tight text-slate-900">Dafegen</p>
              <p className="text-[12px] leading-tight text-slate-500">Admin</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-brand">
          <ArrowLeft size={14} aria-hidden /> My plans
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Users</h1>
        <p className="mt-1.5 max-w-2xl text-[15px] text-slate-600">
          Invite people to their own private workspace. Each person sees only the plans they create; you can open
          anyone&apos;s plans from here.
        </p>
        <UsersAdmin initial={users} />
      </div>
    </main>
  );
}

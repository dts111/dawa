import type { Metadata } from "next";
import PlanWorkspace from "@/components/PlanWorkspace";
import { getActiveShareLink, getProject } from "@/lib/db";
import { loadProject } from "@/lib/projectData";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const link = getActiveShareLink(token);
  const project = link ? getProject(link.projectId) : null;
  return {
    title: project ? `${project.name} — plan` : "Plan not available",
    // A share link is unlisted, not public — keep it out of search results.
    robots: { index: false, follow: false },
  };
}

export default async function SharedPlanPage({ params }: Props) {
  const { token } = await params;
  const link = getActiveShareLink(token);

  if (!link) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-semibold text-slate-900">This link is no longer active</h1>
          <p className="mt-3 text-sm text-slate-600">
            The share link has been revoked or never existed. Ask whoever sent it for a new one.
          </p>
        </div>
      </main>
    );
  }

  const bundle = loadProject(link.projectId);
  if (!bundle) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-semibold text-slate-900">Plan not found</h1>
          <p className="mt-3 text-sm text-slate-600">This plan has been deleted.</p>
        </div>
      </main>
    );
  }

  // The share view never receives the share links or automation rules — a
  // viewer should not be able to see, mint or revoke access.
  return (
    <PlanWorkspace
      initial={{ ...bundle, shareLinks: [], automations: [] }}
      readOnly
      shareLabel={link.label}
    />
  );
}

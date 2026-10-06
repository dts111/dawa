import { notFound, redirect } from "next/navigation";
import PlanWorkspace from "@/components/PlanWorkspace";
import { canAccess, currentUser } from "@/lib/access";
import { loadProject } from "@/lib/projectData";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/project/${id}`);
  const bundle = await loadProject(id);
  // Someone else's plan looks exactly like a missing one.
  if (!bundle || !canAccess(user, bundle.project)) notFound();

  return <PlanWorkspace initial={bundle} />;
}

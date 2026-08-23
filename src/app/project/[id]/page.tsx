import { notFound } from "next/navigation";
import PlanWorkspace from "@/components/PlanWorkspace";
import { loadProject } from "@/lib/projectData";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = loadProject(id);
  if (!bundle) notFound();

  return <PlanWorkspace initial={bundle} />;
}

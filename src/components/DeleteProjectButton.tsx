"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirm(`Delete "${projectName}"? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    else setBusy(false);
  };

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      title={`Delete "${projectName}"`}
      className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      Delete
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RenameProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const rename = async () => {
    const next = window.prompt("Rename plan", projectName)?.trim();
    if (!next || next === projectName) return;
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    if (res.ok) router.refresh();
    else setBusy(false);
  };

  return (
    <button
      type="button"
      onClick={rename}
      disabled={busy}
      title={`Rename "${projectName}"`}
      className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
    >
      Rename
    </button>
  );
}

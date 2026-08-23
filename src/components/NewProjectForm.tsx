"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return setError("Give the plan a name first.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, startDate }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create the plan.");
      router.push(`/project/${json.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const loadDemo = async () => {
    setBusy(true);
    const res = await fetch("/api/demo", { method: "POST" });
    const json = await res.json();
    if (res.ok) router.push(`/project/${json.projectId}`);
    else setBusy(false);
  };

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1">
          <span className="text-[12px] font-semibold text-slate-700">New plan name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="e.g. Site 12 EaaS rollout"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
          />
        </label>
        <label>
          <span className="text-[12px] font-semibold text-slate-700">Starts</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
        >
          Create plan
        </button>
        <button
          type="button"
          onClick={loadDemo}
          disabled={busy}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 ring-inset transition hover:bg-slate-50 disabled:opacity-50"
        >
          Load worked example
        </button>
      </div>
      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
    </div>
  );
}

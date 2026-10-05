"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

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

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1">
          <span className="text-[12px] font-semibold text-slate-700">New plan name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="e.g. Site 12 EaaS rollout"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
        </label>
        <label>
          <span className="text-[12px] font-semibold text-slate-700">Starts</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border-2 border-brand bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-card hover:border-brand-hover transition hover:bg-brand-hover disabled:opacity-50"
        >
          <Plus size={16} aria-hidden />
          Create plan
        </button>
      </div>
      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
    </div>
  );
}

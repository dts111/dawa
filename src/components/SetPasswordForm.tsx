"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordRules";

const input =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15";

export default function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not set your password.");
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-3.5">
      <label className="block">
        <span className="text-[12px] font-semibold text-slate-700">New password</span>
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoFocus />
        <span className="mt-1 block text-[11.5px] text-slate-500">At least {MIN_PASSWORD_LENGTH} characters.</span>
      </label>
      <label className="block">
        <span className="text-[12px] font-semibold text-slate-700">Type it again</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className={input}
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="w-full rounded-md border-2 border-brand bg-brand px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:border-brand-hover hover:bg-brand-hover disabled:opacity-50"
      >
        Save password and sign in
      </button>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
    </div>
  );
}

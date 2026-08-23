"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not sign in.");
      router.replace(params.get("next") || "/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200">
      <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-base font-semibold text-white">
        E
      </div>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">Sign in</h1>
      <p className="mt-1 text-[13px] text-slate-500">Administrator access to EaaS Project Management.</p>

      <div className="mt-6 space-y-3.5">
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
        >
          Sign in
        </button>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-200 px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

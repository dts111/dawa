"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

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
    <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-float">
      <div className="flex justify-center">
        <Image src="/dafegen-logo.jpeg" alt="DAFEGEN" width={1174} height={285} priority className="h-auto w-full max-w-[260px]" />
      </div>
      <h1 className="mt-6 text-center text-lg font-semibold text-slate-900">Sign in</h1>
      <p className="mt-1 text-center text-[13px] text-slate-500">Sign in to your Dafegen project plans.</p>

      <div className="mt-6 space-y-3.5">
        <label className="block">
          <span className="text-[12px] font-semibold text-slate-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15"
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
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="w-full rounded-md border-2 border-brand bg-brand px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:border-brand-hover hover:bg-brand-hover disabled:opacity-50"
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
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

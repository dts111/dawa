"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 disabled:opacity-50"
    >
      Log out
    </button>
  );
}

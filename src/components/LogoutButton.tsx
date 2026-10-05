"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

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
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
    >
      <LogOut size={14} aria-hidden />
      Log out
    </button>
  );
}

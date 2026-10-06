"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Mail, UserPlus } from "lucide-react";
import { formatDate } from "@/lib/calendar";
import type { UserWithStats } from "@/lib/types";

const input =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-3 focus:ring-brand/15";

const STATUS_STYLE: Record<UserWithStats["status"], string> = {
  active: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  invited: "bg-amber-50 text-amber-800 ring-amber-200",
  disabled: "bg-slate-100 text-slate-600 ring-slate-300",
};
const STATUS_LABEL: Record<UserWithStats["status"], string> = {
  active: "Active",
  invited: "Invited",
  disabled: "Disabled",
};

/** The latest invite / reset link, kept on screen so it can be copied and sent by hand. */
interface IssuedLink {
  userId: string;
  link: string;
  sent: boolean;
  error?: string;
}

export default function UsersAdmin({ initial }: { initial: UserWithStats[] }) {
  const [users, setUsers] = useState(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      if (json.users) setUsers(json.users);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const showLink = (userId: string, json: { link?: string; sent?: boolean; error?: string } | null) => {
    if (json?.link) {
      setIssued({ userId, link: json.link, sent: !!json.sent, error: json.error });
      setCopied(false);
    }
  };

  const invite = async () => {
    const json = await call("/api/admin/users", "POST", { name, email });
    if (json) {
      showLink(json.user.id, json);
      setName("");
      setEmail("");
    }
  };

  const act = async (u: UserWithStats, action: "resend" | "reset" | "disable" | "enable") => {
    if (action === "disable" && !confirm(`Disable ${u.name}? They'll be signed out and can't sign in until re-enabled.`)) return;
    showLink(u.id, await call(`/api/admin/users/${u.id}`, "POST", { action }));
  };

  const remove = async (u: UserWithStats) => {
    const plans = u.planCount ? ` and their ${u.planCount} plan${u.planCount === 1 ? "" : "s"}` : "";
    if (!confirm(`Delete ${u.name}${plans}? This cannot be undone.`)) return;
    if (await call(`/api/admin/users/${u.id}`, "DELETE")) {
      if (issued?.userId === u.id) setIssued(null);
    }
  };

  const copy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.link);
    setCopied(true);
  };

  const issuedUser = issued && users.find((u) => u.id === issued.userId);

  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
          <UserPlus size={16} aria-hidden /> Invite someone
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1.3fr_auto]">
          <input className={input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className={input}
            type="email"
            placeholder="Email (Gmail, Hotmail, any address)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && invite()}
          />
          <button
            type="button"
            onClick={invite}
            disabled={busy || !name.trim() || !email.trim()}
            className="rounded-md border-2 border-brand bg-brand px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:border-brand-hover hover:bg-brand-hover disabled:opacity-50"
          >
            Send invite
          </button>
        </div>
        {error && <p className="mt-3 text-[13px] text-red-600">{error}</p>}

        {issued && issuedUser && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-[13px]">
            <p className="text-slate-700">
              {issued.sent ? (
                <>
                  <Mail size={14} className="mr-1 inline text-emerald-600" aria-hidden />
                  Emailed to <strong>{issuedUser.email}</strong>. You can also send them this link yourself:
                </>
              ) : (
                <>
                  The email could not be delivered{issued.error ? ` (${issued.error})` : ""}. Send{" "}
                  <strong>{issuedUser.name}</strong> this link yourself — by WhatsApp, text or your own email:
                </>
              )}
            </p>
            <div className="mt-2 flex gap-2">
              <input readOnly value={issued.link} className={`${input} font-mono text-[12px]`} onFocus={(e) => e.target.select()} />
              <button
                type="button"
                onClick={copy}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <Copy size={13} aria-hidden /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-[11.5px] text-slate-500">Works once, for 7 days. Anyone with the link can set the password, so send it only to them.</p>
          </div>
        )}
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11.5px] tracking-wider text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Person</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Plans</th>
              <th className="px-4 py-2.5 font-semibold">Last sign-in</th>
              <th className="px-4 py-2.5 font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="align-top">
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${u.id}`} className="font-medium text-slate-900 hover:text-brand">
                    {u.name}
                  </Link>
                  {u.role === "admin" && (
                    <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand">ADMIN</span>
                  )}
                  <div className="text-slate-500">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ${STATUS_STYLE[u.status]}`}>
                    {STATUS_LABEL[u.status]}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono">{u.planCount}</td>
                <td className="px-4 py-3 text-slate-500">{u.lastLoginAt ? formatDate(u.lastLoginAt.slice(0, 10)) : "Never"}</td>
                <td className="px-4 py-3">
                  {u.role !== "admin" && (
                    <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[12.5px]">
                      {u.status === "invited" && (
                        <button type="button" disabled={busy} onClick={() => act(u, "resend")} className="text-brand hover:underline">
                          New invite link
                        </button>
                      )}
                      {u.status === "active" && (
                        <button type="button" disabled={busy} onClick={() => act(u, "reset")} className="text-brand hover:underline">
                          Reset password
                        </button>
                      )}
                      {u.status === "disabled" ? (
                        <button type="button" disabled={busy} onClick={() => act(u, "enable")} className="text-slate-700 hover:underline">
                          Enable
                        </button>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => act(u, "disable")} className="text-slate-700 hover:underline">
                          Disable
                        </button>
                      )}
                      <button type="button" disabled={busy} onClick={() => remove(u)} className="text-red-600 hover:underline">
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

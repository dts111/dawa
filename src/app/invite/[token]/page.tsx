import type { Metadata } from "next";
import Image from "next/image";
import { getUserAuthByInviteHash } from "@/lib/db";
import { hashToken } from "@/lib/passwords";
import SetPasswordForm from "@/components/SetPasswordForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set your password", robots: { index: false, follow: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUserAuthByInviteHash(hashToken(token));
  const valid =
    !!user && !!user.inviteExpiresAt && user.inviteExpiresAt > new Date().toISOString() && user.status !== "disabled";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-float">
        <div className="flex justify-center">
          <Image src="/dafegen-logo.jpeg" alt="DAFEGEN" width={1174} height={285} priority className="h-auto w-full max-w-[260px]" />
        </div>
        {valid ? (
          <>
            <h1 className="mt-6 text-center text-lg font-semibold text-slate-900">
              {user.status === "invited" ? `Welcome, ${user.name}` : "Choose a new password"}
            </h1>
            <p className="mt-1 text-center text-[13px] text-slate-500">
              {user.status === "invited" ? "Choose a password for " : "For "}
              <span className="font-medium text-slate-700">{user.email}</span>
            </p>
            <SetPasswordForm token={token} />
          </>
        ) : (
          <>
            <h1 className="mt-6 text-center text-lg font-semibold text-slate-900">This link has expired</h1>
            <p className="mt-2 text-center text-[13px] text-slate-500">
              It was already used, or it&apos;s more than 7 days old. Ask the person who invited you for a new link.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

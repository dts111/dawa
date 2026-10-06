// Invite and password-reset links. Both are a one-time token emailed to the user;
// only its hash is stored, so a database leak doesn't hand out working links.

import { bumpSessionVersion, setInviteToken } from "./db";
import { appUrl, renderAccountLink, sendEmail } from "./email";
import { hashToken, newToken } from "./passwords";
import type { User } from "./types";

export interface AccountLinkResult {
  /** The link itself, so the admin can pass it on by hand if email isn't delivered. */
  link: string;
  sent: boolean;
  error?: string;
}

export async function issueAccountLink(user: User, kind: "invite" | "reset", from: string): Promise<AccountLinkResult> {
  const token = newToken();
  await setInviteToken(user.id, hashToken(token));
  // A reset signs the user out everywhere straight away.
  if (kind === "reset") await bumpSessionVersion(user.id);

  const link = `${appUrl()}/invite/${token}`;
  const { subject, html } = renderAccountLink(kind, user.name, link, from);
  const res = await sendEmail(user.email, subject, html);
  return { link, sent: res.sent, error: res.sent ? undefined : res.error };
}

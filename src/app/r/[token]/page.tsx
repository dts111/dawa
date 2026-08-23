import Link from "next/link";
import { getTask, getUpdateToken } from "@/lib/db";
import { applyResponse } from "@/lib/respond";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">{children}</div>
    </main>
  );
}

export default async function RespondPage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const choice = typeof sp.choice === "string" ? sp.choice : "";
  const done = sp.done === "1" || sp.done === "0";
  const msg = typeof sp.msg === "string" ? sp.msg : "";

  const record = getUpdateToken(token);
  const task = record?.taskId ? getTask(record.taskId) : null;

  if (done) {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-slate-900">{sp.done === "1" ? "Update recorded" : "Sorry"}</h1>
        <p className="mt-3 text-sm text-slate-600">{msg}</p>
        {record && (
          <Link
            href={`/project/${record.projectId}`}
            className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Open the plan
          </Link>
        )}
      </Card>
    );
  }

  if (!record || !task) {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-slate-900">Link not valid</h1>
        <p className="mt-3 text-sm text-slate-600">
          This update link has expired or already been used. Ask the project lead to resend the update email.
        </p>
      </Card>
    );
  }

  // "Running late" needs one more piece of information before we change the plan.
  if (choice === "delayed") {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-slate-900">Report a delay</h1>
        <p className="mt-2 text-sm text-slate-600">
          <strong>{task.name}</strong> — currently planned at {task.duration} working day{task.duration === 1 ? "" : "s"}.
        </p>
        <form action="/api/respond" method="post" className="mt-5 space-y-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="choice" value="delayed" />
          <label className="block text-sm font-medium text-slate-700">
            How many extra working days do you need?
            <input
              type="number"
              name="days"
              min={1}
              max={365}
              defaultValue={5}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            Submit delay
          </button>
        </form>
      </Card>
    );
  }

  const result = applyResponse(token, choice);
  return (
    <Card>
      <h1 className="text-lg font-semibold text-slate-900">{result.ok ? "Update recorded" : "Sorry"}</h1>
      <p className="mt-3 text-sm text-slate-600">{result.message}</p>
      <Link
        href={`/project/${record.projectId}`}
        className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
      >
        Open the plan
      </Link>
    </Card>
  );
}

# EaaS Project Management

A web-based project scheduler with the core of MS Project — WBS outline, task
links, auto-scheduling, critical path, baselines and variance — with the parts of
Smartsheet that make a plan easy to live with: **four views of the same data**, a
**shareable read-only link**, a **dashboard**, and **automation rules**. Plus two
things both do badly: one-click **Excel export** and **update emails your team can
answer with a button**.

Built to be cheap and light: Next.js + a single SQLite file. No database server,
no per-seat licence, no monthly bill.

---

## The four views

Switch between them from the header; they are the same plan, not four copies.

| View | What it is for |
| --- | --- |
| **Gantt** | Building and re-planning the schedule — the editable grid plus the timeline |
| **Board** | Running the week. Kanban columns grouped by status or by owner; drag a card to change either |
| **Calendar** | "What is happening in October" — a month grid with bars spanning their dates |
| **Dashboard** | Reporting up — progress against plan, where the work sits, workload, what needs attention |

Clicking a card in Board, Calendar or Dashboard jumps you to that task in the Gantt.

### Status

Every task carries a status — Not started, In progress, Blocked, Done — kept in
step with % complete automatically (setting a task to Done sets it to 100%, and
typing 100% marks it Done). Summary rows derive their status from their children:
any child blocked makes the phase blocked.

Status colours always ship with an icon and a text label, never colour alone, so
the board and dashboard stay readable for colourblind viewers and in print.

---

## Sharing a plan (read-only links)

**Share → Create a share link** produces an unlisted URL that shows the whole plan
— all four views — with nothing editable. No login needed, which is the point: it
works today, before Phase 2 exists.

- Anyone with the link can view the plan, so treat it like a document link
- Revoke a link at any time; revoked links stop working immediately
- Share pages are marked `noindex`, so they stay out of search engines
- Viewers never see the share panel or the automation rules

---

## Automation rules

**Automations → New rule.** Each rule is "when this is true of a task, email
someone".

Triggers: a task is **due within N days**, is **overdue**, **starts within N
days**, **should have started but hasn't**, or **has a given status** (e.g.
Blocked).

Actions: email **the person the task is assigned to** — optionally with the same
one-click Mark complete / On track / Running late buttons — or email **specific
addresses**, useful for "tell me whenever something is blocked".

Every rule has **Test** (shows what it would do, sends nothing) and **Run now**.
A rule will not email the same person about the same task twice in one day,
however often it runs.

### Running rules automatically

Nothing runs on a hidden timer. Point a scheduler at the endpoint instead:

```
POST http://your-address:3000/api/automations/run
```

On Windows, open **Task Scheduler → Create Basic Task**, set it to run daily at
08:00, and have it run:

```
curl.exe -X POST -H "x-automation-secret: YOUR_SECRET" http://localhost:3000/api/automations/run
```

Set `AUTOMATION_SECRET` in `.env.local` to the same value. On Linux hosting, the
same one-line cron entry does the job.

---

## Phase 1 — the scheduling core

**Scheduling**

- WBS outline with unlimited nesting; summary rows roll up dates, % complete and cost
- Working-day calendar — pick which weekdays count, add bank holidays
- Task links: finish-to-start, start-to-start, finish-to-finish, start-to-finish, with lag or lead
- Auto-scheduling: change one duration and everything downstream moves
- Forward and backward pass → **total float** and **critical path**
- Milestones (zero-duration tasks)
- Constraints: as-soon-as-possible, start-no-earlier-than, must-start-on
- Circular dependencies are detected and rejected rather than silently breaking the plan

**Baselines**

- Save a baseline in one click; grey bars appear under the live bars
- Finish variance in working days, shown per task in the Excel export

**Gantt**

- Drag a bar to move a task, drag its right edge to change duration
- Day / week / month zoom, today marker, weekend shading
- Dependency arrows, critical path in red, progress shading inside each bar
- Resource names alongside the bars

**Excel export** (`Export to Excel` button)

Four sheets:

| Sheet | Contents |
| --- | --- |
| Gantt Chart | Task table with a painted timeline — bars, progress, baseline, milestones, legend |
| Task Table | Flat, filterable data: float, critical flag, baseline, variance, cost |
| Resources | Allocation and cost per person |
| Summary | Headline numbers and any scheduling warnings |

**Email updates with buttons**

Two email types, both previewable in the app before sending:

- **Task update request** — personalised per person, listing only their open
  tasks, each with three buttons: **Mark complete**, **On track**, **Running late**.
  A click writes straight back into the plan. No login needed for the recipient.
  "Running late" asks how many extra days and extends the task, rescheduling
  everything downstream.
- **Status digest** — a broadcast summary: % complete, finish date, overdue and
  slipping counts, what is coming up, with buttons to open the plan or download
  the Excel file.

Links are signed one-time tokens that expire after 14 days.

---

## Running it on Windows

You need **Node.js 20.9 or newer** — get the LTS installer from
<https://nodejs.org> and accept the defaults.

Then, in PowerShell, from this folder:

```powershell
npm install
copy .env.example .env.local
npm run build
npm start
```

Open <http://localhost:3000>. Click **Load worked example** to see a populated
plan, or **Create plan** to start your own.

For day-to-day editing while developing, `npm run dev` gives you hot reload.

### Where the data lives

Everything is in `data/eaas-pm.db` — one SQLite file. Copy that file and you
have a complete backup. Delete it and you start fresh.

### Sharing it with the team right now

Two easy options before you buy a domain:

1. **On your network** — run `npm start` on a machine that stays on and share
   `http://<that-machine's-IP>:3000`. Set `APP_URL` in `.env.local` to the same
   address so the email buttons point somewhere your team can reach.
2. **Over the internet, temporarily** — run `npx localtunnel --port 3000` (or
   Cloudflare Tunnel) and share the URL it prints.

---

## Turning on real emails

Emails run in **preview mode** until you add an API key — you can render and
inspect them, but nothing is sent.

1. Sign up at <https://resend.com> (free tier covers a small team).
2. Create an API key.
3. In `.env.local`:

```
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM="Project Updates <onboarding@resend.dev>"
APP_URL=http://your-address:3000
```

`onboarding@resend.dev` works immediately for testing. To send from your own
address you verify your domain in Resend — which fits naturally with Phase 3.

**`APP_URL` matters.** It is what the buttons inside the email point at. If it
is wrong, the buttons will not work for anyone but you.

---

## Phase 2 — logins (not built yet)

The groundwork is deliberately in place: every API route is a thin layer over
`src/lib/db.ts`, so adding authentication means adding a check, not rewriting
the app.

Suggested approach when you are ready:

- **Auth.js (NextAuth)** with email magic links, or Microsoft Entra ID if the
  team is on Office 365 — no passwords to manage either way.
- New tables: `users`, and `project_members` (`projectId`, `userId`, `role`)
  where role is `owner` / `editor` / `viewer`.
- A `requireMember(projectId, minRole)` helper called at the top of each API
  route; viewers get read-only UI.
- The emailed one-click buttons should stay token-based and login-free — that is
  what makes people actually reply.

## Phase 3 — your domain (not built yet)

The app is a standard Next.js server, so hosting is straightforward. Because
SQLite is a file, pick a host that gives you a **persistent disk**:

- **Railway / Render / Fly.io** — attach a volume, set `DATABASE_FILE` to a path
  on it, point your domain at the app. Cheapest path, keeps SQLite.
- **A small VPS** — Node plus a reverse proxy. Most control, most admin.
- **Vercel** — the filesystem is read-only there, so you would move to Postgres
  first. That is a one-file change: rewrite `src/lib/db.ts` against `pg`. Nothing
  in the UI or the scheduling engine touches the database directly.

Whichever you pick, set `APP_URL` to `https://yourdomain.com` so the email
buttons resolve, and verify that domain in Resend so update emails come from
your own address.

---

## How the code is laid out

```
src/lib/
  calendar.ts     Working-day date maths (no dependencies, easy to test)
  schedule.ts     The scheduling engine: forward/backward pass, float, rollup
  db.ts           All SQL. Swap this file to change database.
  projectData.ts  Loads a project and runs the scheduler
  excel.ts        Workbook builder
  email.ts        Email templates and sending
  respond.ts      Applies an emailed one-click answer

src/lib/
  automations.ts  Rule matching and running
  ruleText.ts     Plain-language rule wording (shared with the browser)

src/components/
  PlanWorkspace.tsx   View switcher, toolbar, state
  TaskGrid.tsx        The left-hand editable table
  GanttChart.tsx      Bars, arrows, drag handling
  BoardView.tsx       Kanban board
  CalendarView.tsx    Month calendar
  DashboardView.tsx   KPIs and charts
  SidePanels.tsx      Team, links, calendar, email, share, automations
  statusTokens.ts     Status colours, icons and chart palette

src/app/api/            REST endpoints, one thin file each
src/app/r/[token]/      Landing page for email buttons
src/app/share/[token]/  Public read-only view
```

The scheduling engine is pure functions with no database or React imports, so it
can be unit-tested on its own and is reused by the Excel exporter and the email
digest.

---

## Known limits

- Resource levelling (automatically resolving over-allocation) is not implemented
- Effort-driven scheduling and per-resource calendars are not implemented — the
  calendar is per project
- Linking summary tasks works but is expanded down to their child tasks, which is
  the behaviour MS Project recommends anyway
- No undo yet; the baseline is the safety net
- Automation rules only send email — no Slack or Teams actions yet
- Share links are unlisted rather than password-protected; anyone with the URL
  can view the plan until you revoke it

# Dafegen Project Management

A web-based project scheduler with the core of MS Project — WBS outline, task
links, auto-scheduling, critical path, baselines and variance — with the parts of
Smartsheet that make a plan easy to live with: **five views of the same data**,
**view-only access for stakeholders by email**, a **dashboard**, and **automation
rules**. Plus two things both do badly: one-click **Excel export** and **update
emails your team can answer with a button**.

Built to be cheap and light: Next.js + SQLite (libSQL). Runs locally on a single
file, and in the cloud on **free tiers** (Netlify or Render + Turso + Resend).

---

## The five views

Switch between them from the tabs under the plan title; they are the same plan, not five copies.

| View | What it is for |
| --- | --- |
| **Gantt** | Building and re-planning the schedule — the editable grid plus the timeline |
| **Board** | Running the week. Kanban columns grouped by status or by owner; drag a card to change either |
| **Table** | Planning notes per task — objectives, guidance, remarks and risk |
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

## Sharing a plan with stakeholders

**Share → Invite people to view.** Type one or more email addresses (and an
optional message) and press **Send view-only invites**. Each person receives an
email with their **own personal link** to the live plan — all five views, Excel
download, nothing editable, no sign-in needed.

The Share panel then lists **people with access**: when they were emailed, how
many times they have visited and when they last looked. For each person you can
**Resend** the email, **Copy link**, or **Remove access** (their link stops
working immediately). Re-inviting someone keeps their existing link working.

**Anonymous links** are still available under the same panel, for when you just
need a URL to paste somewhere — but you can't see who opened them, so prefer
personal invites for clients, investors and partners.

Share pages are marked `noindex`, and viewers never see the share panel or the
automation rules.

> To email anyone, send through a Gmail account (see "Deploying for free", step 2)
> or verify your domain in Resend. Resend's test sender (`onboarding@resend.dev`)
> only delivers to your own address.

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

Nothing runs on a hidden timer. Something outside the app calls:

```
POST https://your-app/api/automations/run      header: x-automation-secret: <AUTOMATION_SECRET>
```

- **Free, in the cloud:** the included GitHub Actions workflow
  (`.github/workflows/automations.yml`) does this at 07:00 UTC every weekday. Add
  repository secrets `APP_URL` and `AUTOMATION_SECRET`.
- **On Windows:** Task Scheduler → Create Basic Task → daily at 08:00, running
  `curl.exe -X POST -H "x-automation-secret: YOUR_SECRET" http://localhost:3000/api/automations/run`

Without `AUTOMATION_SECRET` set, only a signed-in admin can trigger a run.

---

## Scheduling core

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

| Sheet | Contents |
| --- | --- |
| Gantt Chart | Task table with a painted timeline — bars, progress, baseline, milestones, legend |
| Task Table | Flat, filterable data: float, critical flag, baseline, variance, cost |
| Resources | Allocation and cost per person |
| Summary | Headline numbers and any scheduling warnings |

**Email updates with buttons**

- **Task update request** — personalised per person, listing only their open
  tasks, each with **Mark complete**, **On track**, **Running late**. A click
  writes straight back into the plan; no login needed. "Running late" asks how
  many extra days and reschedules everything downstream.
- **Status digest** — % complete, finish date, overdue and slipping counts, what
  is coming up, with buttons to open the plan or download the Excel file.

Links are one-time tokens that expire after 14 days.

---

## Running it locally (Windows)

You need **Node.js 20.9 or newer** (<https://nodejs.org>, LTS installer).

```powershell
npm install
copy .env.example .env.local      # then set ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET
npm run dev
```

Open <http://localhost:3000> and sign in. (`start-local.bat` does the same with a double-click.)

Locally, everything is in `data/eaas-pm.db` — one SQLite file. Copy that file and
you have a complete backup.

---

## Deploying for free

Netlify functions and Render's free tier have **no persistent disk**, so in the
cloud the data lives in **Turso** — hosted SQLite with a free tier. The app talks
to it with the same SQL; nothing else changes.

### 1. Database — Turso (free)

```bash
# install the CLI: https://docs.turso.tech/cli/installation  (on Windows, via WSL)
turso auth signup
turso db create eaas-pm --from-file data/eaas-pm.db   # copies your existing plans up
turso db show eaas-pm --url                            # → DATABASE_URL
turso db tokens create eaas-pm                         # → DATABASE_AUTH_TOKEN
```

(Start from an empty database instead with `turso db create eaas-pm` — tables are
created on first request.)

### 2. Email — a Gmail account (simplest) or Resend

**Gmail (no domain needed).** The app can send through a Gmail account, to any
address (Gmail, Hotmail, company email):

1. Sign in to the Gmail account → Google Account → **Security** → turn on
   **2-Step Verification** (required for the next step).
2. Open <https://myaccount.google.com/apppasswords>, create one called
   "Dafegen PM" and copy the 16-letter password.
3. Set `SMTP_USER` = the Gmail address, `SMTP_PASS` = that App password
   (mark it secret in your host), and optionally
   `EMAIL_FROM="Your Name <the-gmail-address>"`.

Gmail allows roughly 500 recipients a day. Replies go to the Gmail inbox.

**Resend.** Create an API key at <https://resend.com> → `RESEND_API_KEY`. Verify
your domain there so invites and updates can go to anyone, and set `EMAIL_FROM`
to an address on it. If both are set, Gmail/SMTP is used.

### 3a. Host on Netlify (free)

1. Push this folder to a GitHub repository.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
   `netlify.toml` already sets the build; Netlify detects Next.js automatically.
3. **Site configuration → Environment variables**: add the variables below.
4. Deploy, then set `APP_URL` to the site's URL (e.g. `https://your-site.netlify.app`) and redeploy.

### 3b. Host on Render (free)

1. Push this folder to a GitHub repository.
2. Render → **New → Blueprint** → pick the repo. `render.yaml` defines a free web
   service and generates `SESSION_SECRET` and `AUTOMATION_SECRET` for you.
3. Fill in the remaining variables when prompted; set `APP_URL` to
   `https://<service>.onrender.com`.

Free Render services sleep after ~15 minutes without traffic; the first visit
after that takes up to a minute to wake. Netlify has no sleep.

### Environment variables

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `libsql://…turso.io` from step 1 |
| `DATABASE_AUTH_TOKEN` | token from step 1 |
| `APP_URL` | the public address of the deployed app (email links point here) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | your sign-in |
| `SESSION_SECRET` | any long random string |
| `AUTOMATION_SECRET` | any long random string (also add it to GitHub secrets) |
| `SMTP_USER`, `SMTP_PASS` | Gmail address + App password (step 2); `SMTP_HOST`/`SMTP_PORT` default to Gmail |
| `RESEND_API_KEY` | alternative to Gmail (step 2) |
| `EMAIL_FROM` | the "from" name and address |

### Other hosts

The included `Dockerfile` / `fly.toml` run the app on Fly.io (or any Docker
host). There you can keep a local SQLite file on a mounted volume — set
`DATABASE_FILE=/data/eaas-pm.db` — or use Turso as above.

---

## Sign-in

One administrator account, from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, with a signed
30-day session cookie. Stakeholders never need an account: they use their
personal view-only link. The emailed update buttons are token-based for the same
reason — it is what makes people actually reply.

If you later need several editors, the groundwork is in place: every API route is
a thin layer over `src/lib/db.ts`, so adding `users` / `project_members` tables
and a `requireMember(projectId, role)` check is additive.

---

## How the code is laid out

```
src/lib/
  calendar.ts     Working-day date maths (no dependencies, easy to test)
  schedule.ts     The scheduling engine: forward/backward pass, float, rollup
  db.ts           All SQL (libSQL: local file or Turso). Swap this file to change database.
  projectData.ts  Loads a project and runs the scheduler
  excel.ts        Workbook builder
  email.ts        Email templates and sending
  respond.ts      Applies an emailed one-click answer
  automations.ts  Rule matching and running
  ruleText.ts     Plain-language rule wording (shared with the browser)
  auth.ts         Admin session cookie

src/components/
  PlanWorkspace.tsx   View tabs, toolbar, state
  TaskGrid.tsx        The left-hand editable table
  GanttChart.tsx      Bars, arrows, drag handling
  BoardView.tsx       Kanban board
  TableView.tsx       Planning-notes table
  CalendarView.tsx    Month calendar
  DashboardView.tsx   KPIs and charts
  SidePanels.tsx      Team, links, calendar, email, share/invites, automations
  statusTokens.ts     Status colours, icons and chart palette

src/app/api/            REST endpoints, one thin file each
src/app/r/[token]/      Landing page for email buttons
src/app/share/[token]/  Stakeholder read-only view (+ /xlsx download)
src/proxy.ts            Sign-in gate (exempts share links, email buttons, the automation runner)
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
- View-only links are personal but not password-protected: anyone who is
  forwarded one can view the plan until you remove that person's access
- No dark mode yet

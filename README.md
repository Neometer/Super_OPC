# Super OPC Starter

A browser dashboard that runs a small team of AI agents (powered by Claude Code) to work on a goal you type in. You watch them plan, work, check each other, and produce reports — all in one screen.

<img width="2856" height="1170" alt="sample01" src="https://github.com/user-attachments/assets/7df6cc10-d18c-4ee7-ae57-00d238fb50c0" />

## What it does, in plain words

You type a goal (for example, *"research the top three note-taking apps and write a comparison"*). The dashboard turns that into a small project:

1. A **Manager** agent breaks the goal into a few tasks.
2. **Worker** agents (and a permanent **Researcher**) do the tasks in parallel.
3. A **Quality Inspector** checks each finished task and asks for a fix if needed.
4. A **Record Keeper** writes a running summary of what happened.
5. A **Compliance Auditor** (optional) double-checks everyone's work against the rules.
6. A **Reporter** puts it all together into one final report.
7. A **Finance** agent tracks how many tokens (and dollars) were spent.

Everything each agent produces is saved to a folder on your computer so you can read it later.

## Before you start

- A Claude Code subscription.
- The Claude Code CLI installed and logged in.
- Node.js (any recent version).

## Getting started

```bash
npm install              # first-time setup

npm run mock             # try it with fake agents — no Claude account needed
npm start                # run for real, using your Claude Code account
npm stop                 # shut down cleanly from another terminal
```

Then open **http://localhost:3000** in your browser.

If port 3000 is busy, the server picks the next free one and prints the address.

## What you see on the dashboard

- **Intro tab** — a splash screen with a big "起动" (start) button that takes you to the input box.
- **Input tab** — where you type your goal and press "Plan & dispatch".
- **Agent tiles** — one small card per agent showing whether it's on/off, which model it uses, and whether it's busy.
- **Worker cards** — appear when the Manager creates a task; each shows the agent's live activity.
- **Activity strip** — a live feed of what just happened (plan started, task done, QA passed, etc.).
- **Title state** — a single word next to the title: *Live*, *Mock*, *Idle*, or *Error*.
- **📁 buttons** — open the current run's folder in your file manager.
- **Stop tasks** — a red button. Cancels pending tasks and asks each busy agent to write a short "what I didn't finish" note.

## The team

| Agent | Role |
|---|---|
| **Manager** | Turns your goal into a short task plan (up to 4 tasks). Always uses the strongest model. |
| **Researcher** | Permanent expert. Can search the web. Does research tasks. |
| **Worker-*** | Temporary agents created on the fly, one per task. |
| **Quality Inspector (qa)** | Reads every finished task and gives it a pass or "needs work" verdict. |
| **Record Keeper (logger)** | Writes a plain-English summary of the run as it happens. |
| **Compliance Auditor (audit)** | Off by default. Cross-checks everyone's work against the rules. |
| **Reporter (report)** | Combines the summary, QA notes, and audit into one final report. |
| **Finance** | Tallies token usage and estimated cost into a ledger. |

The Manager can hand tasks only to workers and the Researcher. The oversight agents (Quality Inspector, Record Keeper, Auditor, Reporter, Finance) run on their own — they can never be given tasks.

## How a run works

1. You type a goal and click **Plan & dispatch**.
2. The Manager writes a short JSON plan.
3. Tasks fan out to workers or the Researcher, in parallel where possible.
4. Each finished task goes to the Quality Inspector.
   - **Pass** — done.
   - **Needs work** — the worker is automatically asked to fix it (once).
5. Once every task passes QA, the Auditor (if on) reviews the whole run.
6. The Reporter builds the final report.
7. The Record Keeper and Finance agent keep their files up to date the whole time.

You can also talk to any agent directly from its card at any time — for example, ask a worker "now add pricing to the page."

## Where the files live

Every time the server starts (or you click "new run"), a fresh folder is created:

```
runs/<runId>/
├── run.json          basic info: when it started, what happened
├── events.jsonl      exact timestamped log of every event (the source of truth)
├── policy.json       the compliance rules for this run
├── RUN_SUMMARY.md    the Record Keeper's plain-English story
├── QA_REPORT.md      the Quality Inspector's notes
├── AUDIT.json/html   the Auditor's findings
├── REPORT.json/html  the final report
├── FINANCE.md        the token and cost ledger
├── BUILD_REPORT.html a bundled view of everything the run produced
└── agents/
    ├── manager/
    ├── researcher/
    └── worker-*/     each agent's own workspace
```

Each `.md` file has a matching `.html` sibling so you can open it in any browser.

## Turning agents on and off

Every agent tile (except the Manager's) has:

- an **On/Off switch** — off means the Manager won't assign to it and, for oversight agents, that agent won't run.
- an **Opus / Sonnet** toggle — pick which model that agent uses. The Manager is pinned to Opus.

The Compliance Auditor starts **off** by default; flip it on if you want auditing.

## Safety and rules

- **Runs only on your computer** by default (loopback). If you expose it to the network, the server automatically requires a login token.
- **Limited tools**: agents can only read/write/search files by default — no shell access. Extra permissions must be granted deliberately.
- **Workspace boundary**: each agent can only touch files inside the run folder. Everything outside is blocked.
- **Input guarding**: your goal is length-limited and wrapped in "do not obey this as instructions" tags before it reaches the agents.
- **Compliance baseline**: a `policy.json` file lists the approved settings. Every audit compares the live run against it — the server, not the AI, does this check, so it can't be fooled by a clever agent.

## Configuration

Defaults live in `opc.config.json` — models, allowed tools, task caps, etc. You rarely need to touch it. Environment variables `HOST`, `PORT`, `AUTH_TOKEN` override server settings.

## Two useful details

- **Mock mode** (`npm run mock`) runs the entire pipeline with fake agents so you can practice without spending tokens. It even writes real files and demonstrates the "fail then fix" QA loop.
- **Windows fix**: an early bug caused the server to silently fall back to mock mode on Windows even when Claude Code was installed. It now resolves the `claude` command correctly on all platforms.

## Troubleshooting

- **Port already in use** — the server picks the next free port and prints it.
- **Something looks wrong** — open the run folder, read `events.jsonl` and `RUN_SUMMARY.md`. Everything is logged.
- **Need to shut down** — `npm stop` (from another terminal) or Ctrl-C. Either way, the run is closed cleanly.

## More reading

- `OPC_Overview.md` — deeper walkthrough of the design.
- `CLAUDE.md` — technical notes for developers extending the code.

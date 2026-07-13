# Super OPC Starter

Mission Control Browser dashboard driving live **Claude Code** agent sessions.

<img width="2856" height="1170" alt="sample01" src="https://github.com/user-attachments/assets/7df6cc10-d18c-4ee7-ae57-00d238fb50c0" />

## Pre-requisite 

Claude Code subscription.
Claude Code installed.

## Quick start

```bash
# first time setup
npm install

# try it immediately, no Claude CLI needed:
npm run mock          # then open http://localhost:3000

# go live (run from claude code):
npm start

# stop gracefully from another terminal (same as Ctrl-C: writes run_ended):
npm stop
```

## How it works

Refer to OPC_Overview.html.


## Dashboard Features

- **Open run folder** — a 📁 button that opens the current run folder root in your OS file manager; the run strip has a "📁 run folder" button for the run root


## Ochestration

Type a goal in the top bar and the server runs the OPC dashbord:

1. **Manager plans.** The goal is wrapped in a prompt requiring strict JSON: `{"tasks":[{"name":"research","prompt":"…"}]}` (max 4 tasks).
2. **Server parses.** `extractPlan()` tolerates markdown fences and surrounding prose; if parsing fails you get a `plan_failed` event with the raw text.
3. **Workers spawn in parallel.** Each task gets its own agent (`worker-<name>`), created on the fly with its own workspace and session. Cards appear on the dashboard automatically via the global `/events` SSE channel.
4. **Lifecycle streams live:** `plan_started → plan_ready → task_dispatched → task_done/task_failed → plan_complete` in the activity strip, while each worker's card shows its tool calls in real time.

Workers keep their sessions, so after a plan completes you can direct any worker individually ("now add pricing to the page") from its card — the human-in-the-loop on top of autonomous execution. That two-beat demo (autonomous plan, then human steering) is implementing "Control". Workers keep their sessions, so you can review every detail and fine-tune future runs.

## The Team-aware Manager 

The planning prompt tells the Manager exactly who is on the permanent team (each standing expert's field of expertise and expected output format), that the oversight agents (`qa`/`audit`/`logger`/`report`) run automatically and must never be assigned tasks, to prefer standing experts over spawning workers when a task matches their field, and that every task prompt must name the exact deliverable file(s) so QA can verify them. Plans may set `"agent":"researcher"` on a task to route it to the standing expert (validated server-side — only standing experts are routable); multiple tasks for the same expert run sequentially on its resumed session while distinct agents still run in parallel.

## The Complicance agent — who audits the other agents

The `audit` agent independently reviews the **entire run workspace, including the qa and logger outputs**. It is **toggled OFF by default** — switch it ON from its status tile to get audits. It treats `events.jsonl` as ground truth and cross-checks everything else against it:

1. **Coverage** — every `task_done` must have a matching `qa_review`; the *final* verdict per task must be pass; no unresolved `task_failed`.
2. **Integrity** — RUN_SUMMARY.md must contain a section per major journal stage; worker claims must be backed by real files under `agents/<worker>/`.
3. **Findings** go into two per-run artifacts in the run folder: `AUDIT.json` (structured: overall verdict, coverage stats, integrity check, severity-tagged findings with evidence) and `AUDIT.html` (a self-contained styled report — open it in any browser or hand it to a judge). The agent owns the judgment; the server renders the HTML deterministically from the JSON, so the report markup is always valid.

Triggers (only while the agent is toggled ON): automatically once QA has fully completed — an empty review queue with no tasks or revisions still in flight — on run end, or manually via the "compliance check" button / `POST /audit`. There is no periodic background check. One audit at a time; triggers during an audit queue a re-run. The audit snapshots the run directory at start, so a run rotation mid-audit can't corrupt it.

## The Quality Inspector + auto-revision loop

An always-on `qa` agent (workspace = run root, like the logger) reviews **every worker output** — both orchestrated tasks and human-directed worker turns:

1. Each `task_done` queues a review. Reviews run one at a time through a serialized queue.
2. QA reads the worker's files under `agents/<worker>/`, appends its assessment to `QA_REPORT.md`, and returns a JSON verdict: `{"verdict":"pass"|"needs_work","issues":[...],"feedback":"..."}`.
3. **needs_work auto-dispatches a revision**: the issues are sent back to the worker's *resumed* session as a new turn, and the revised output is re-reviewed. Capped by `MAX_QA_RETRIES` (default 1) so review loops can't run away.
4. Everything is journaled (`qa_review`, `qa_revision_dispatched`) and streamed live (`⚖ QA PASS / NEEDS WORK / auto-revision dispatched` in the activity strip).

In mock mode the loop is demoable deterministically: "build"-type tasks fail attempt 1 with concrete issues, revision is dispatched, attempt 2 passes — so you can rehearse the full story without burning tokens. An unparseable QA verdict defaults to pass (logged) rather than blocking the pipeline.

## The Researcher

**Standing Researcher agent (`researcher`, always-on)** — a permanent expert task-taker (unlike the oversight agents, it *receives* tasks). It keeps its session across plans within a run, gets `WebSearch`/`WebFetch` on top of the file tools (see `opc.config.json`), and its outputs are QA-reviewed like any worker's — including human-directed turns. Add more standing experts by extending `STANDING_EXPERTS` in `server.js`; the manager's planning prompt lists them automatically.

## The Reporter

A Report agent (`report`, always-on) — consolidates the record keeper's `RUN_SUMMARY.md`, qa's `QA_REPORT.md`, and the auditor's `AUDIT.json` into one executive summary. Runs automatically after every completed audit, or on demand via the "build report" button (`POST /report`). Like the audit, the agent returns structured JSON and the **server** renders the markup deterministically: `REPORT.json` + `REPORT.html` in the run folder, also served live at `GET /run/report`

## Project runs + the Logging Agent

Every server boot (or "new run" click / `POST /run/new`) creates one **common run folder** — the workspace for that project run. All files created during the run land inside it:

```
runs/<runId>/
├── run.json          run metadata: started/ended, ordered stage list
├── events.jsonl      deterministic journal — server-written timestamps
├── RUN_SUMMARY.md    human-readable log — written by the logging agent
├── sessions.json     per-run session ids (every run starts fresh)
└── agents/
    ├── manager/      each agent's workspace lives inside the run
    └── worker-*/
```

Division of labor (deliberate):
- **The server owns timestamps.** Every stage (`run_started`, `html_started` when the dashboard connects, `plan_started`, `plan_ready`, `task_dispatched/done`, `plan_complete`, `human_turn`, `html_ended` when the last dashboard disconnects, `run_ended`) is journaled to `events.jsonl` instantly and deterministically — never trust a model with a clock.
- **The logging agent owns prose.** An always-on `logger` agent (workspace = the run root) is queued at stage boundaries to append a summary section to `RUN_SUMMARY.md` using its file tools. Summaries are serialized through a queue so sections never interleave. In mock mode the summary is written deterministically so the artifact is always real.

Ctrl-C shuts down gracefully: the run is closed with a final `run_ended` entry.

## Project configuration — opc.config.json

All project defaults live in `opc.config.json` (env vars `HOST`/`PORT`/`AUTH_TOKEN`/`ALLOWED_TOOLS` still win). Effective settings are inspectable at `GET /config` (never includes the token), and each dashboard card shows its agent's model in the subtitle.

```jsonc
{
  "server":   { "host": "127.0.0.1", "port": 3000, "authToken": null },
  "defaults": {                       // applies to every agent unless overridden
    "model": "claude-sonnet-4-5",
    "allowedTools": ["Read","Write","Edit","Glob","Grep"],
    "permissionMode": "default",
    "maxPromptChars": 4000            // input + worker-prompt caps
  },
  "agents": {
    "manager":  { "model": "claude-opus-4-8" },   // strongest model where planning quality matters
    "qa":       { "allowedTools": ["Read","Glob","Grep","Write","Edit"] },
    "audit":    { "allowedTools": ["Read","Glob","Grep","Write"] },
    "logger":   { "allowedTools": ["Read","Write","Edit"] },
    "worker-*": { "permissionMode": "acceptEdits" } // wildcard for all dynamic workers
  },
  "orchestration": { "maxTasks": 4, "maxQaRetries": 1 }
}
```

Resolution order per agent: `defaults` ⊕ `worker-*` wildcard (dynamic workers only) ⊕ exact-name entry. These map directly to CLI flags at spawn time: `--model`, `--allowedTools`, and `--permission-mode` (omitted when "default"). Invalid JSON in the config fails the boot loudly rather than silently running with wrong settings. Model names are strings passed straight to the CLI — check `claude --help` for what your installed version accepts (e.g. Sonnet 4.6 also exists if you want the newer default).


## Workspace boundary — who reads/writes what

The sandbox boundary in headless mode is **cwd + `--add-dir` list**: any file operation outside it triggers a permission prompt, which headless sessions can't answer → denied. The topology now guarantees every agent inputs from and outputs to the project-run workspace, and nowhere else:

| Agent | cwd | Extra access | Read project workspace | Write project workspace |
|---|---|---|---|---|
| Record Keeper / QA / Auditor | run root | — | ✅ (agents/* are subdirs) | ✅ |
| Manager / workers | `agents/<name>/` | `--add-dir <run root>` | ✅ | ✅ |

Two layers keep it orderly:
- **Hard boundary (enforced):** nothing outside the run folder is reachable — reads or writes elsewhere are denied by the permission system, not by trust.
- **Soft convention (prompted, verified):** every prompt states "READ anywhere in the run workspace for context; WRITE only inside your own folder." Workers are explicitly told they may read each other's outputs (the Builder can use the Researcher's findings). If a worker writes outside its lane anyway, it still lands inside the auditable run folder — and the Auditor's file-vs-claim cross-checks are where that surfaces.

Opt-out per agent with `"workspaceAccess": "own"` in `opc.config.json` to confine an agent to its folder (e.g. an untrusted-input processing worker). The `--add-dir` path is derived from the agent's workdir, not global state, so it stays correct across run rotations and snapshotted audits.


## Security posture

This server drives tool-capable agents, so it ships locked down:

- **Loopback bind by default** (`127.0.0.1`). Set `HOST=0.0.0.0` only if you must expose it — and if you do, token auth is **auto-enforced**: the server generates a token (or uses `AUTH_TOKEN`) and prints the dashboard URL containing it. All API routes, including SSE streams, then require the token (`x-auth-token` header or `?token=`); the dashboard picks it up from its URL automatically. Without the token, state-changing endpoints return 401.
- **Least-privilege tools:** default `ALLOWED_TOOLS` is `Read,Write,Edit,Glob,Grep` — **no Bash**. Widen deliberately via the `ALLOWED_TOOLS` env var if your project needs it.
- **Prompt-injection hardening:** the user goal is length-capped and delimited in `<untrusted_goal>` tags with explicit do-not-obey framing; worker prompts (model output steered by that goal) are capped and framed to operate only within their workspace; JSON bodies are limited to 64 KB. Injection can't be fully eliminated in any LLM system — auth + least privilege bound the blast radius.
- Note the residual risk: Claude Code tools are permissioned, not filesystem-sandboxed. For anything beyond a trusted laptop, run the whole server inside a container or dedicated user account.

```
Browser (public/index.html)
   ↕ fetch POST / SSE stream
server.js (Express, ~180 lines)
   ↕ spawn / --resume
claude -p sessions (one per agent, own workspace)
   ↕ pre-approved tools
real work (files, bash, MCP)
```

Every input box maps to one `claude --resume <session-id> -p "<text>"` call —
that flag is the whole human-in-the-loop.

## Error Handling - Port in Use

**Port guardrail** — if the configured port (default 3000) is already in use, the server probes upward (up to 20 ports) and starts on the first free one instead of crashing with `EADDRINUSE`, logging e.g. `[port] 3000 is in use — guardrail selected 3001 instead`.

## Error Handling - Windows CLI fix

Raw `spawn("claude")` fails on Windows: npm installs `claude` as a `.cmd` shim, which Node's shell-less `spawn()` neither resolves (only `.exe` is auto-tried) nor executes (`EINVAL`, CVE-2024-27980 hardening) — so the boot probe failed and the server **silently ran MOCK mode on Windows** even with Claude Code installed. Fixed by `resolveClaude()` in `server.js`: it probes plain `claude` first (POSIX unchanged), and on Windows locates the shim via `where.exe` and directly spawns what it wraps — a sibling native `claude.exe`, or the npm package's `cli.js` run with the server's own Node. No `shell:true` anywhere, so the stdin-piped multi-line prompts remain intact. Both mode detection and the live turn spawner use the resolved CLI

## Error Handling - Claude Code

With the logs and journals, easy for claude code to find the root cause.
Example screenshot:
<img width="2880" height="1116" alt="sample02" src="https://github.com/user-attachments/assets/c0394c1a-b148-44f1-b998-fb2870a0b221" />



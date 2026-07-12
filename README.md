# OPC Headless Starter

Browser dashboard driving live, headless **Claude Code** agent sessions.

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

## Quick start

```bash
npm install

# try it immediately, no Claude CLI needed:
npm run mock          # then open http://localhost:3000

# go live (requires Claude Code installed + authenticated):
npm start

# stop gracefully from another terminal (same as Ctrl-C: writes run_ended):
npm stop
```

`npm stop` finds the live instance via `.opc-server.json` (written on boot, so it works even when the port guardrail moved the server off the configured port) and POSTs the auth-protected `/shutdown` endpoint — necessary on Windows, where a cross-process signal would terminate the server without running its Ctrl-C handler. If the endpoint is unreachable it falls back to killing the pid.

If the `claude` CLI isn't on PATH the server auto-falls back to mock mode,
so the dashboard is always demoable.

## How it works

| Piece | File | Job |
|---|---|---|
| Dashboard | `public/index.html` | One card per agent: live transcript, tool activity, input box |
| Server | `server.js` | `POST /agent/:id/message` spawns/resumes claude; `GET /agent/:id/stream` forwards stream-json via SSE |
| Sessions | `sessions.json` | Persists agentName → session_id across server restarts |
| Workspaces | `workspaces/<agent>/` | Each agent gets its own cwd so parallel agents don't clobber files |

Key server details:

- **Session capture:** the first stream-json event is `{"type":"system","subtype":"init","session_id":...}` — the server stores it and passes `--resume` on every later turn.
- **Permissions:** headless sessions can't answer "allow?" prompts, so tools are pre-approved via `--allowedTools` (see `ALLOWED_TOOLS` in server.js). Keep the scope tight; widen deliberately.
- **One turn at a time per agent:** a busy flag returns 409 if you send while the agent is mid-turn.

## The audit agent — who watches the watchers

An always-on `audit` agent independently reviews the **entire run workspace, including the qa and logger outputs**. It treats `events.jsonl` as ground truth and cross-checks everything else against it:

1. **Coverage** — every `task_done` must have a matching `qa_review`; the *final* verdict per task must be pass; no unresolved `task_failed`.
2. **Integrity** — RUN_SUMMARY.md must contain a section per major journal stage; worker claims must be backed by real files under `agents/<worker>/`.
3. **Findings** go into two per-run artifacts in the run folder: `AUDIT.json` (structured: overall verdict, coverage stats, integrity check, severity-tagged findings with evidence) and `AUDIT.html` (a self-contained styled report — open it in any browser or hand it to a judge). The agent owns the judgment; the server renders the HTML deterministically from the JSON, so the report markup is always valid.

Triggers: automatically whenever the QA queue settles, on run end, or manually via the "run audit" button / `POST /audit`. One audit at a time; triggers during an audit queue a re-run. The audit snapshots the run directory at start, so a run rotation mid-audit can't corrupt it.

Worth knowing: if an audit fires while a QA revision is still in flight, it will correctly report CRITICAL ("needs_work with no passing revision") and then clear to HEALTHY on the next audit after the revision passes — the interim report is the system catching a real in-flight issue, not a bug.

## The quality agent + auto-revision loop

An always-on `qa` agent (workspace = run root, like the logger) reviews **every worker output** — both orchestrated tasks and human-directed worker turns:

1. Each `task_done` queues a review. Reviews run one at a time through a serialized queue.
2. QA reads the worker's files under `agents/<worker>/`, appends its assessment to `QA_REPORT.md`, and returns a JSON verdict: `{"verdict":"pass"|"needs_work","issues":[...],"feedback":"..."}`.
3. **needs_work auto-dispatches a revision**: the issues are sent back to the worker's *resumed* session as a new turn, and the revised output is re-reviewed. Capped by `MAX_QA_RETRIES` (default 1) so review loops can't run away.
4. Everything is journaled (`qa_review`, `qa_revision_dispatched`) and streamed live (`⚖ QA PASS / NEEDS WORK / auto-revision dispatched` in the activity strip).

In mock mode the loop is demoable deterministically: "build"-type tasks fail attempt 1 with concrete issues, revision is dispatched, attempt 2 passes — so you can rehearse the full story without burning tokens. An unparseable QA verdict defaults to pass (logged) rather than blocking the pipeline.

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

## Project runs + the logging agent

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

## Manager → worker orchestration

Type a goal in the top bar (or `POST /orchestrate {goal}`) and the server runs the OPC pattern:

1. **Manager plans.** The goal is wrapped in a prompt requiring strict JSON: `{"tasks":[{"name":"research","prompt":"…"}]}` (max 4 tasks).
2. **Server parses.** `extractPlan()` tolerates markdown fences and surrounding prose; if parsing fails you get a `plan_failed` event with the raw text.
3. **Workers spawn in parallel.** Each task gets its own agent (`worker-<name>`), created on the fly with its own workspace and session. Cards appear on the dashboard automatically via the global `/events` SSE channel.
4. **Lifecycle streams live:** `plan_started → plan_ready → task_dispatched → task_done/task_failed → plan_complete` in the activity strip, while each worker's card shows its tool calls in real time.

Workers keep their sessions, so after a plan completes you can direct any worker individually ("now add pricing to the page") from its card — the human-in-the-loop on top of autonomous execution. That two-beat demo (autonomous plan, then human steering) is exactly the "sovereignty" judging theme.

## Customize for your hack

1. **Add agents:** edit the `AGENTS` map in `server.js` (name + workspace dir). Cards appear automatically.
2. **Widen tools:** adjust `ALLOWED_TOOLS`, e.g. add `Bash(npm *)`, `WebFetch`, or your MCP tools (`mcp__<server>__<tool>`).
3. **Seed workspaces:** drop a `CLAUDE.md` into each agent's workspace folder to give it a role. For dynamic workers, have `ensureAgent()` write one from a template.
4. **Tune the plan prompt:** the manager prompt template lives in the `/orchestrate` handler — adjust task count, add role types, or require dependencies between tasks.

## Verify before demo day

The CLI evolves fast — the night before, sanity-check flags on your machine:

```bash
claude --help | grep -E "resume|output-format|allowedTools|verbose"
claude -p "say hi" --output-format stream-json --verbose | head -5
```

Notes:
- `--output-format stream-json` requires `--verbose` in print mode on current CLI versions; if your version differs, adjust `runClaudeTurn()`.
- Turns take 10–60+ s. The tool-activity lines keep the audience engaged.
- Keep a screen recording as backup in case venue Wi-Fi dies.

## v3.1 additions

- **Collapsible cards** — each agent card has a ▾/▸ toggle in its header that collapses the feed and input bar, keeping just the status header visible.
- **Open run folder** — a 📁 button on every card opens that agent's workspace for the current run in your OS file manager (`open`/`explorer`/`xdg-open`); the run strip has a "📁 run folder" button for the run root. Server endpoints: `POST /agent/:id/open-folder`, `POST /run/open-folder`.
- **Report agent (`report`, always-on)** — consolidates the record keeper's `RUN_SUMMARY.md`, qa's `QA_REPORT.md`, and the auditor's `AUDIT.json` into one executive summary. Runs automatically after every completed audit, or on demand via the "build report" button (`POST /report`). Like the audit, the agent returns structured JSON and the **server** renders the markup deterministically: `REPORT.json` + `REPORT.html` in the run folder, also served live at `GET /run/report`.
- **HTML guardrail** — `npm test` runs `node --check` on the dashboard's inline script (with error lines remapped to `public/index.html`) plus `node --check server.js`.

## v3.2 additions

- **Port guardrail** — if the configured port (default 3000) is already in use, the server probes upward (up to 20 ports) and starts on the first free one instead of crashing with `EADDRINUSE`, logging e.g. `[port] 3000 is in use — guardrail selected 3001 instead`.
- **Standing Researcher agent (`researcher`, always-on)** — a permanent expert task-taker (unlike the oversight agents, it *receives* tasks). It keeps its session across plans within a run, gets `WebSearch`/`WebFetch` on top of the file tools (see `opc.config.json`), and its outputs are QA-reviewed like any worker's — including human-directed turns. Add more standing experts by extending `STANDING_EXPERTS` in `server.js`; the manager's planning prompt lists them automatically.
- **Team-aware manager** — the planning prompt now tells the manager exactly who is on the permanent team (each standing expert's field of expertise and expected output format), that the oversight agents (`qa`/`audit`/`logger`/`report`) run automatically and must never be assigned tasks, to prefer standing experts over spawning workers when a task matches their field, and that every task prompt must name the exact deliverable file(s) so QA can verify them. Plans may set `"agent":"researcher"` on a task to route it to the standing expert (validated server-side — only standing experts are routable); multiple tasks for the same expert run sequentially on its resumed session while distinct agents still run in parallel.

## v3.3 — Windows CLI fix

Raw `spawn("claude")` fails on Windows: npm installs `claude` as a `.cmd` shim, which Node's shell-less `spawn()` neither resolves (only `.exe` is auto-tried) nor executes (`EINVAL`, CVE-2024-27980 hardening) — so the boot probe failed and the server **silently ran MOCK mode on Windows** even with Claude Code installed. Fixed by `resolveClaude()` in `server.js`: it probes plain `claude` first (POSIX unchanged), and on Windows locates the shim via `where.exe` and directly spawns what it wraps — a sibling native `claude.exe`, or the npm package's `cli.js` run with the server's own Node. No `shell:true` anywhere, so the stdin-piped multi-line prompts remain intact. Both mode detection and the live turn spawner use the resolved CLI.
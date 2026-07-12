# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser dashboard that drives live, headless Claude Code agent sessions (`claude -p` + `--resume` + `stream-json`). Most logic lives in two files: `server.js` (Express server, all orchestration) and `public/index.html` (single-file dashboard with inline JS). There is no build step, bundler, or framework beyond Express.

## Commands

```bash
npm start        # live mode (requires claude CLI installed + authenticated)
npm stop         # graceful shutdown from another terminal: POSTs /shutdown via
                 # .opc-server.json so run_ended is journaled even on Windows
                 # (cross-process signals there skip the SIGINT handler)
npm run mock     # mock mode, no Claude CLI needed — deterministic fake turns
                 # (runs `node server.js --mock`; MOCK=1 env var also works —
                 # the flag exists because cmd.exe can't do `MOCK=1 node ...`)
npm test         # syntax guardrail: check:html + check:server (no unit tests exist)
npm run check:html    # node --check on every inline <script> in public/index.html,
                      # with error lines remapped to the real HTML line (scripts/check-html.js)
npm run check:server  # node --check server.js
```

Notes:
- If `claude` isn't on PATH, `npm start` silently falls back to mock mode. On Windows the CLI is resolved via `resolveClaude()` in server.js (finds what the `.cmd` shim wraps); never reintroduce `spawn("claude")` or `shell:true` — prompts are piped via **stdin**, not `-p <text>`, because cmd.exe mangles multi-line args.
- If the port (default 3000) is busy, the server probes upward up to 20 ports and logs the one it picked.
- Server binds loopback by default. `HOST=0.0.0.0` auto-enforces token auth on all API routes (header `x-auth-token` or `?token=`).

## Architecture

```
Browser (public/index.html)  ←fetch POST / SSE→  server.js  ←spawn/--resume→  claude -p sessions
```

**Runs.** Every boot (or `POST /run/new`) creates `runs/<runId>/` — the workspace for that run: `run.json` (metadata), `events.jsonl` (server-written journal, the ground truth), `policy.json` (snapshot of the compliance baseline, copied in at run start so the audit agent can read it inside the workspace boundary), `RUN_SUMMARY.md`, `QA_REPORT.md`, `AUDIT.json/html`, `REPORT.json/html`, `FINANCE.md` (token ledger), `BUILD_REPORT.html`, `sessions.json` (agentName → claude session_id), and `agents/<name>/` per-agent workspaces.

**Agents.** Two kinds:
- *Always-on oversight agents* (cwd = run root): `logger` (writes RUN_SUMMARY.md prose at stage boundaries), `qa` (reviews every worker output; `needs_work` auto-dispatches a revision to the worker's resumed session, capped by `maxQaRetries`), `audit` (role "Compliance" — cross-checks everything against events.jsonl AND the policy baseline; fires when the QA queue settles / run ends / `POST /audit`), `report` (consolidates the other three after each audit; `POST /report`), `finance` (role "Finance" — writes the FINANCE.md token ledger from the server's deterministic per-turn tally; fires when QA settles / run ends / `POST /finance`). These must never be assigned tasks by the manager.
- *Task-takers*: `manager` (plans), `researcher` (standing expert, listed in `STANDING_EXPERTS`; keeps its session across plans), and dynamic `worker-<name>` agents spawned per plan task (cwd = `agents/<name>/`, plus `--add-dir <run root>`).

**Custom-agent delegation:** `.claude/agents/` defines a project custom agent per always-on session (`manager`, `researcher`, `logger`, `qa`, `audit`, `report`, `finance` — none for dynamic workers), each carrying that role's full rules; `.claude/skills/opc-*` hold the shared format specs (workspace layout, md+YAML output, plan/verdict/audit/report/ledger schemas). The server prompts for **manager, logger, qa, report, and finance** are slim *delegation prompts*: run-specific data (goal, stage data, review job, token tally) + an instruction to invoke the matching custom agent via the **Task tool** + an inline FALLBACK with the compact original rules so the pipeline survives if the subagent is unavailable. The session relays the subagent's JSON/confirmation as its final reply, so `extractPlan()`/`extractJson()` parsing is unchanged. Claude Code discovers the agent definitions by walking up from each session's cwd inside `runs/<runId>/` (verified live: the Agent tool call carries `subagent_type:"manager"`). **The audit prompt is deliberately NOT delegated** — audit turns already carry 300–450k input tokens and the delegation hop roughly doubles input cost. Rules for the pattern: `Task` must stay in each delegating agent's `allowedTools` in `opc.config.json` AND `policy.json` (added in policy v5; workers and defaults deliberately excluded); role-rule changes go in `.claude/agents/<name>.md`, run-data/plumbing changes in the server prompt — keep the FALLBACK text in sync with the agent file; subagent models come from the agent file's frontmatter, so a tile model toggle changes the session but not the subagent. Mock mode never spawns sessions, so delegation is live-only.

**Orchestration flow** (`POST /orchestrate {goal}`): manager returns strict JSON `{"tasks":[...]}` → `extractPlan()` parses (tolerates fences/prose) → tasks fan out in parallel to workers or route to standing experts via `"agent":"researcher"` (validated server-side; same-expert tasks serialize) → each `task_done` queues a QA review. Lifecycle events stream on the global `/events` SSE channel; per-agent events on `/agent/:id/stream`.

**Stop tasks** (`POST /tasks/stop`, red "Stop tasks" button next to Plan & dispatch): the manager orders a graceful stop. `stopRequested` skips every not-yet-dispatched plan task (dep-waiting or chained) and QA auto-revisions (`task_skipped`, reason `stop requested`); agents mid-turn finish their current step (a headless turn can't be interrupted), then each task-taker with a session gets one final resumed turn to document unfinished work in `STOP_REPORT.md` (journaled `stop_requested`/`stop_dispatched`/`stop_done`). The recorder logs that the stop was initiated by the manager. Cleared by a new plan or new run.

**Task dependencies:** a plan task may carry `"deps":["task-name",...]` — synthesis-type tasks wait for ALL listed prerequisites to complete (`task_done`) before dispatch (`task_waiting` streamed while pending). Deps may only reference *earlier* tasks in the plan (forward/self refs are dropped in `extractPlan()`, so waits can't deadlock); if any prerequisite fails or is skipped, the dependent task is skipped (`task_skipped`, reason `prerequisite task(s) did not complete`). The mock plan's `summarize` task demos this.

**Agent toggles:** every agent except the manager can be switched on/off from its status tile (`POST /agent/:id/toggle`, journaled as `agent_toggled`). OFF means two things: (a) the *manager* must not use it — disabled standing experts are dropped from the planning prompt, plans routing to them are skipped at dispatch time (`task_skipped`), and worker names of disabled agents are never reused; (b) *oversight agents must not execute* — every oversight entry point (logger summaries, qa reviews, audit, report, finance) checks the toggle first and journals `oversight_skipped` instead of running, and the model-free 2-min policy snapshots are also skipped (silently) while the audit agent is OFF. Direct human sends stay allowed. `checkPolicy()` replays `agent_toggled` vs `task_dispatched` (policy rule `managerChecksAgentToggle`) so a violation is a deterministic critical finding.

**Model toggles:** every agent status tile except the manager's has an Opus/Sonnet switch (`POST /agent/:id/model {model:"opus"|"sonnet"}`, journaled as `model_set`). The server resolves `effectiveModel()` (tile override ⊕ config default) right before spawning each `claude -p` session and when pricing turns; the manager is pinned to Opus and the route rejects it. Approved models live in `policy.json rules.modelToggleAllowedModels` and `checkPolicy()` flags any override outside that list (or any manager override) as critical. The heartbeat carries each agent's effective model so tiles/cards reconcile.

**Status heartbeat:** every 5s (`pushStatusHeartbeat`) the server pushes `status_heartbeat` on `/events` with each agent's live busy/enabled state, oversight-queue activity, the run clock, and token+cost totals; the dashboard reconciles every tile/lamp against it, so a tile can never stay stale longer than one beat (fixes manual-send drift). Not journaled — UI signal only.

**Cost ledger:** `recordUsage()` also computes an estimated USD cost per turn from `MODEL_PRICING` (per-model $/MTok; cache write 1.25x input, cache read 0.1x) into `run.tokens.cost` (+ per-agent). Streams via `token_usage`/heartbeat to the dashboard (the idle finance tile shows `$… spent`; there is no summary tile — the tiles row is one status tile per agent plus 4 worker slots), lands in FINANCE.md as a cost column. Keep MODEL_PRICING in sync when changing models in `opc.config.json`.

**Dashboard title state:** the word next to the h1 is single-word and dynamic — `Live` (work running, live agents), `Mock` (work running, mock mode), `Idle` (no active work), `Error` (SSE/server connection lost) — computed client-side in `updateTitleState()` from lamp/inflight state.

**Division of labor, deliberately enforced:** the *server* owns all timestamps and journals stages to `events.jsonl` deterministically; *agents* own prose/judgment. For AUDIT.html and REPORT.html the agent returns JSON and the server renders the HTML (`renderAuditHtml`/`renderReportHtml`) so markup is always valid. Token accounting follows the same split: the server tallies every turn's result usage into `run.tokens` (+ a `turn_usage` journal entry) via `recordUsage()`, and the finance agent only narrates those numbers into FINANCE.md. Keep this split when adding features.

**Build report** (part of every `runReport`): the server converts every `.md` in the run folder to a styled sibling `.html` (`mdToHtml`/`buildMdHtmlFiles` — deterministic, escapes input first) and writes `BUILD_REPORT.html` (`renderBuildReportHtml`): request → what was done → results → suggestions, with every converted doc embedded. Served at `GET /run/build-report`.

**Compliance policy:** `policy.json` at the project root is the approved baseline — effective per-agent settings (models, allowedTools, permissionMode, caps), orchestration limits, and rules (no Bash, no env tool override, oversight agents never tasked, loopback bind). On every audit the *server* runs `checkPolicy()` deterministically — comparing live `cfgFor()` results, `CONFIG`, the host bind, `process.env.ALLOWED_TOOLS`, the journal, and a boot-time snapshot of `opc.config.json` (mid-run tamper check) against the policy — and merges the findings into AUDIT.json; the verdict can only escalate, never be downgraded by a model. On top of the full audits, `runPolicySnapshot()` runs a model-free snapshot every 2 minutes: a 30-second watch window sampling `checkPolicy()` at 10s intervals, with merged violations journaled as `policy_snapshot` and streamed to the dashboard (the "compliance check" button still triggers the full audit). When settings legitimately change, update `policy.json` in the same commit. Invalid policy JSON fails boot loudly, like the config.

**Serialization primitives:** per-agent `busy` flag (concurrent send → 409); `summaryQueue`/`reviewQueue` drain one at a time; one audit/report at a time with a pending re-run flag. The audit snapshots the run dir at start so mid-audit run rotation is safe.

**Workspace boundary:** headless sessions can't answer permission prompts, so the sandbox is cwd + `--add-dir` — file access outside it is simply denied. Agents with `"workspaceAccess": "own"` in config are confined to their folder. The `--add-dir` path is derived from the agent's workdir, not global state — keep it that way for rotation/snapshot safety.

**Configuration:** `opc.config.json` holds all defaults (models, allowedTools, permissionMode, orchestration caps). Per-agent resolution: `defaults` ⊕ `worker-*` wildcard ⊕ exact-name entry (`cfgFor()`). Env vars `HOST`/`PORT`/`AUTH_TOKEN` override server settings. Invalid config JSON fails boot loudly — preserve that. Effective config is served at `GET /config` (never the token).

**Mock mode** mirrors the whole pipeline deterministically (planning JSON, QA fail-then-pass on "build" tasks, real files written to workspaces) so features must stay demoable there — when adding a live-mode behavior, add its mock counterpart (`runMockTurn`, `mockQaReview`, `mockAudit`, `mockReport`, `mockLoggerSummary`, `mockFinance`; mock turns also carry deterministic fake `usage` so the token ledger works).

## Security posture (do not weaken)

- Default `allowedTools` has **no Bash**; widen deliberately per agent in `opc.config.json`.
- User goals are length-capped (`maxPromptChars`) and wrapped in `<untrusted_goal>` tags; worker prompts capped and workspace-framed; JSON bodies limited to 64 KB.
- Auth is auto-enforced whenever the bind is non-loopback.

## Formatting and Style
All markdown files need YAML front matter and must stay tiny.
Ensure all markdown files created can be converted to html without error.

## Additional Information
Refer to "README.md" and "OPC_Overview.md" files for more information.
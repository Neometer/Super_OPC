---
title: OPC Headless Starter — Architecture Overview
description: One-Person-Company dashboard driving headless Claude Code agent sessions
project: Super OPC
created: 2026-07-12
updated: 2026-07-12
---

# OPC Headless Starter — Architecture

Multi-Agent Claude Code (headless) + Express + Single-File Dashboard

## Overview

OPC Headless Starter is a Node.js application that drives a "one-person company" of live, headless Claude Code agent sessions (`claude -p` + `--resume` + `stream-json`) from a browser dashboard. A manager plans a user goal into parallel tasks; workers and standing experts execute them; always-on oversight agents (logger, qa, audit, report, finance) review, audit, and narrate everything into auditable run artifacts.

Nearly all logic lives in two files: `server.js` (Express server, all orchestration) and `public/index.html` (single-file dashboard, inline JS). No build step, no bundler, no framework beyond Express.

---

## High-Level Architecture

```
                     Browser (public/index.html)
+--------------------------------------------------------------+
| OPC Dashboard                                                 |
| +---------+ +----------+ +--------+ +-------+ +--------+     |
| | Manager | |Researcher| | Logger | |  QA   | | Audit  |     |
| +---------+ +----------+ +--------+ +-------+ +--------+     |
| +--------+ +---------+ +----------------------------+        |
| | Report | | Finance | | Worker slots x4 (dynamic)  |        |
| +--------+ +---------+ +----------------------------+        |
+--------------------------------------------------------------+
              | fetch POST            | SSE (/events, /agent/:id/stream)
              v                       v
                        server.js (Express)
        run journal (events.jsonl) · QA/summary queues ·
        policy checks · token/cost ledger · HTML rendering
              |
              | spawn / --resume (prompts piped via stdin)
              v
   claude -p headless sessions (one per agent, cwd-sandboxed)
              |
              v
   runs/<runId>/  — run.json, events.jsonl, policy.json,
   RUN_SUMMARY.md, QA_REPORT.md, AUDIT.json/html,
   REPORT.json/html, FINANCE.md, BUILD_REPORT.html,
   sessions.json, agents/<name>/ workspaces
```

---

## How the Dashboard "Sees" the Claude CLI

There is no terminal or pty. Each turn spawns one `claude` process with
`-p --output-format stream-json --verbose`, so the CLI's stdout is one JSON
event per line instead of a human UI:

```
CLI stdout (NDJSON)  →  server line-parser (runClaudeTurn)
                     →  pushEvent() multiplexes onto the single /events SSE
                     →  browser render() maps each event to a card line
```

- The prompt is piped via stdin; continuity comes from `--resume <session_id>`
  (captured from the `system/init` event), not a long-lived process.
- Event → card line: `human` → `👤 prompt` (busy lamp on); `system/init` →
  `· session … ready`; assistant text → prose; assistant `tool_use` →
  `⚙ Write {file_path…}`; `tool_result` → `↳ wrote 42 lines`; `result` →
  `✓ final answer` (lamp off, tokens tallied); `stderr`/nonzero exit → error line.
- All agents share ONE `/events` stream (browsers cap ~6 connections/host);
  `/agent/:id/stream` remains for curl debugging only.
- The card is a *view*; ground truth is `events.jsonl` plus the 5s
  `status_heartbeat` that reconciles tiles if the browser misses events.
- Mock mode emits the same event shapes on timers — that's why it looks
  identical without spawning anything.

---

## Technology Stack

- Node.js >= 18, Express (only dependency)
- Server-Sent Events for live streaming (no WebSocket layer)
- Claude Code CLI in headless mode (`claude -p`, `--resume`, `--output-format stream-json`)
- Vanilla HTML/JS/CSS single-file dashboard (no React, no bundler)
- `.claude/agents/` custom agents + `.claude/skills/opc-*` format specs (Task-tool delegation)

---

## Folder Structure

```
opc08/
  server.js            all orchestration, journaling, policy, rendering
  public/index.html    entire dashboard (inline JS/CSS)
  opc.config.json      defaults + per-agent config (models, tools, caps)
  policy.json          compliance baseline checked by audit + checkPolicy()
  scripts/             stop.js (graceful shutdown), check-html.js
  .claude/agents/      manager, researcher, logger, qa, audit, report, finance
  .claude/skills/      opc-* shared format specs (plan, QA, audit, report, ledger…)
  runs/<runId>/        per-run workspace: journal, reports, agent folders
```

---

## Agents

Two kinds, deliberately separated:

- **Always-on oversight** (cwd = run root; must never be assigned plan tasks):
  `logger` (RUN_SUMMARY.md prose at stage boundaries), `qa` (reviews every worker
  output; `needs_work` auto-dispatches a revision, capped by `maxQaRetries`),
  `audit` (Compliance — cross-checks the workspace against events.jsonl and
  policy.json), `report` (consolidates the other three into REPORT.json),
  `finance` (FINANCE.md token/cost ledger from the server's deterministic tally).
- **Task-takers**: `manager` (plans, pinned to Opus), `researcher` (standing
  expert, keeps its session across plans), and dynamic `worker-<name>` agents
  spawned per plan task (cwd = `agents/<name>/` + `--add-dir <run root>`).

Always-on sessions carry slim *delegation prompts* that invoke their matching
`.claude/agents/` custom agent via the Task tool, with an inline FALLBACK of the
compact rules. The audit prompt is deliberately NOT delegated (token cost).

---

## Agent Lifecycle

1. Boot (or `POST /run/new`) creates `runs/<runId>/` and journals to `events.jsonl`.
2. `POST /orchestrate {goal}` → manager returns strict JSON `{"tasks":[...]}`.
3. `extractPlan()` parses; tasks fan out in parallel to workers or route to
   standing experts (`"agent":"researcher"`); `deps` gate synthesis tasks.
4. Each session is a spawned `claude -p` (resumed via `sessions.json`),
   sandboxed to cwd + `--add-dir` (headless = no permission prompts).
5. Every `task_done` queues a QA review; fail → auto-revision in the worker's
   resumed session.
6. When the QA queue settles / run ends: audit → report → finance fire.
7. Lifecycle events stream on `/events` (SSE); per-agent output on
   `/agent/:id/stream`; a 5s `status_heartbeat` reconciles every tile.

---

## Dashboard Features

- One status tile per agent + 4 worker slots; busy/enabled lamps, live model,
  token + cost figures, run clock; title word: Live / Mock / Idle / Error.
- Per-tile controls: on/off toggle (`agent_toggled` — disabled agents are
  excluded from planning, dispatch, and oversight execution) and Opus/Sonnet
  model switch (`model_set`; manager pinned to Opus, policy-checked).
- Plan & dispatch, red "Stop tasks" (graceful manager-ordered stop with
  STOP_REPORT.md per agent), compliance-check, report, and finance buttons.
- Direct human sends to any agent stay allowed even when toggled OFF.

---

## Division of Labor (deliberately enforced)

- The **server** owns all timestamps, the `events.jsonl` journal, token/cost
  tallies (`recordUsage()` + `MODEL_PRICING`), policy checks (`checkPolicy()`,
  plus a model-free snapshot every 2 minutes), and all HTML rendering
  (AUDIT.html, REPORT.html, BUILD_REPORT.html, md→html conversion).
- **Agents** own only prose and judgment, returned as JSON or markdown with
  YAML front matter; a model can escalate an audit verdict but never downgrade it.

---

## Security Posture

- Default `allowedTools` has no Bash; widened deliberately per agent in config.
- User goals length-capped and wrapped in `<untrusted_goal>` tags; JSON bodies
  limited to 64 KB; prompts piped via stdin (never shell-interpolated).
- Loopback bind by default; `HOST=0.0.0.0` auto-enforces token auth.
- `policy.json` is the approved baseline; any drift (config tamper, model
  override outside the allowlist, tasked oversight agent) is a deterministic
  critical audit finding.

---

## Commands

```
npm start        live mode (claude CLI required; silently falls back to mock)
npm run mock     deterministic mock mode — full pipeline, no CLI needed
npm stop         graceful shutdown (journals run_ended, Windows-safe)
npm test         syntax guardrails: check:html + check:server
```

---

## Summary

The result is a small, auditable platform for coordinating a company of AI
agents from one browser page: the server provides deterministic orchestration,
journaling, and compliance; headless Claude Code sessions provide specialized
judgment; SSE keeps the dashboard live; and every run leaves a complete,
HTML-renderable paper trail in its own workspace.
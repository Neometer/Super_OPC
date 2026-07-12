---
name: opc-run-workspace
description: Anatomy of an OPC project-run workspace (runs/<runId>/) — folder layout, events.jsonl journal stages, workspace boundary rules, and the division of labor between the server (timestamps/journal) and agents (prose/judgment). Load before reading or writing anything inside a run folder.
---

# OPC run workspace

Every server boot (or `POST /run/new`) creates one run folder — the workspace for that project run. Everything an agent reads or writes lives inside it.

## Layout

```
runs/<runId>/
├── run.json          run metadata: started/ended, ordered stage list
├── events.jsonl      deterministic journal — SERVER-written timestamps (ground truth)
├── policy.json       snapshot of the compliance baseline, copied in at run start
├── sessions.json     agentName → claude session_id (every run starts fresh)
├── RUN_SUMMARY.md    Record Keeper (logger) narrative, one section per stage
├── QA_REPORT.md      Quality Inspector (qa) per-task assessments
├── AUDIT.json/.html  Compliance (audit) findings; server renders the HTML
├── REPORT.json/.html Report agent's executive summary; server renders the HTML
├── FINANCE.md/.html  Finance token & cost ledger from the server's tally
├── BUILD_REPORT.html server-rendered build report embedding every converted doc
├── STOP_REPORT.md    (per agent folder) unfinished-work notes after a graceful stop
└── agents/
    ├── manager/      each agent's own workspace lives inside the run
    ├── researcher/
    └── worker-<name>/
```

## Journal stages (events.jsonl)

Server-journaled, one JSON object per line, each with a server timestamp:
`run_started`, `html_started`, `plan_started`, `plan_ready`, `task_dispatched`, `task_waiting`, `task_done`, `task_failed`, `task_skipped`, `plan_complete`, `human_turn`, `qa_review`, `qa_revision_dispatched`, `turn_usage`, `agent_toggled`, `model_set`, `oversight_skipped`, `policy_snapshot`, `stop_requested`/`stop_dispatched`/`stop_done`, `html_ended`, `run_ended`.

## Boundary rules (hard + soft)

- **Hard boundary (enforced):** headless sessions can't answer permission prompts, so the sandbox is cwd + `--add-dir`. Nothing outside the run folder is reachable — reads/writes elsewhere are denied by the permission system, not by trust.
- **Soft convention (prompted, verified by audit):** READ anywhere in the run workspace for context; WRITE only inside your own folder. Agents may read each other's outputs (e.g. the builder reads `agents/researcher/`). Oversight agents (cwd = run root) write only their designated report file.
- Agents with `"workspaceAccess": "own"` in `opc.config.json` are confined to their folder.

## Division of labor (do not blur)

- **The server owns timestamps and structure**: journals every stage deterministically, tallies token usage (`recordUsage()`), renders all HTML (`AUDIT.html`, `REPORT.html`, `BUILD_REPORT.html`, md→html siblings).
- **Agents own prose and judgment**: summaries, assessments, findings, narration. Agents return markdown or JSON; never hand-write HTML artifacts, and never invent timestamps or token numbers.

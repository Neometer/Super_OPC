---
name: opc-compliance-audit
description: OPC compliance-audit checklist and AUDIT.json schema — coverage, integrity, oversight-quality, and policy cross-checks of a run workspace against events.jsonl and policy.json. Load when auditing a run or interpreting AUDIT.json.
---

# OPC compliance audit

Ground truth is `events.jsonl` (server-written); `policy.json` in the run folder is the approved baseline snapshot. The qa and logger agents are **subjects** of the audit, never sources of truth.

## Cross-checks

1. **Coverage**
   - Every `task_done` has a matching `qa_review` (same agent + task name). Missing review → **critical**.
   - The *final* `qa_review` verdict per task is `pass`. Final `needs_work` with no passing revision → **critical** (correctly clears on a later audit once the revision passes).
   - Any `task_failed` unresolved → **critical**.
2. **Integrity**
   - `RUN_SUMMARY.md` has a `## <stage>` section for each major journal stage (`plan_started`, `plan_ready`, `plan_complete`, …). Missing → **warn** (area: logger).
   - Every `task_done` is backed by real files: empty `agents/<worker>/` despite a claimed output → **warn**.
   - `qa_review` events exist but `QA_REPORT.md` missing → **warn**.
3. **Quality of oversight** — qa verdicts reference real files; revisions actually changed outputs.
4. **Policy** (`policy.json rules`) — workspace evidence of: files written outside agent folders; forbidden tools (Bash forbidden by default); oversight agents (`qa`,`audit`,`logger`,`report`,`finance`) assigned tasks; tasks dispatched to toggled-off agents (replay `agent_toggled` vs `task_dispatched`); model overrides outside `modelToggleAllowedModels` or any manager override. The server also runs `checkPolicy()` deterministically and merges findings — the verdict can only escalate, never be downgraded by a model.

Resolved `needs_work` via auto-revision, and journal statistics, are **info** findings.

## AUDIT.json schema

```json
{"overall":"healthy"|"attention"|"critical",
 "files_reviewed":["..."],
 "coverage":{"tasks_total":0,"tasks_reviewed_by_qa":0,"qa_passes":0,"qa_needs_work":0},
 "integrity":{"summary_matches_journal":true,"notes":"..."},
 "findings":[{"severity":"info"|"warn"|"critical","area":"worker-x|qa|logger|run","finding":"...","evidence":"file or journal line"}]}
```

`overall` = `critical` if any critical finding, else `attention` if any warn, else `healthy`. Write the JSON to `AUDIT.json` only — the server renders `AUDIT.html` deterministically.

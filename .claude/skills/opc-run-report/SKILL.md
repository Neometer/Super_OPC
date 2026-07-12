---
name: opc-run-report
description: OPC executive-report consolidation — which run files feed REPORT.json and its exact schema (headline, summary, highlights, audit_overall, recommendations). Load when building or interpreting a run's consolidated report.
---

# OPC run report

Consolidates three oversight outputs into one executive summary, after each completed audit or on demand.

## Inputs (read, never invent)

| File | Provides |
|---|---|
| `RUN_SUMMARY.md` | record keeper's stage-by-stage narrative → `record_highlights` |
| `QA_REPORT.md` | per-task verdicts → `qa_highlights` |
| `AUDIT.json` | structured findings incl. policy checks → `audit_overall` (copied verbatim) + `audit_highlights` |
| `events.jsonl` | deterministic journal, for facts/timestamps if needed |

## REPORT.json schema

```json
{"headline":"one-line state of the run",
 "summary":"3-6 sentence executive overview of what happened and how well it went",
 "record_highlights":["notable stages from RUN_SUMMARY.md"],
 "qa_highlights":["per-task verdict summaries from QA_REPORT.md"],
 "audit_overall":"healthy"|"attention"|"critical",
 "audit_highlights":["key findings from AUDIT.json, e.g. \"[info] qa: 1 needs_work verdict(s) were resolved by auto-revision\""],
 "recommendations":["actionable next steps; empty array if none"]}
```

## Rules

- Every statement grounded in the input files; `audit_overall` is never re-judged, only copied.
- Non-info audit findings usually become `recommendations` ("Address: <finding>").
- Write the JSON to `REPORT.json` only; the server renders `REPORT.html` and `BUILD_REPORT.html` (request → what was done → results → suggestions, with every converted doc embedded) deterministically.

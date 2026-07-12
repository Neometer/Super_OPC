---
name: opc-qa-review
description: OPC QA review procedure — how to review a worker/expert task output against its prompt, the QA_REPORT.md section format, and the strict pass/needs_work verdict JSON that drives the auto-revision loop. Load when performing or interpreting a QA review.
---

# OPC QA review

Every `task_done` (and human-directed worker turn) queues one review; reviews run serially.

## Procedure

1. Read the worker's actual files under `agents/<worker>/` (run root relative) — never trust the claimed result text alone.
2. Check, in order:
   - **Deliverables exist** — the exact file name(s) the task prompt required.
   - **Completeness** — does the output do everything the task asked?
   - **Correctness** — facts, links, code, structure.
   - **Format** — markdown with YAML front matter, HTML-convertible (opc-output-format skill), unless the task specified otherwise.
3. APPEND to `QA_REPORT.md` in the run root (create with `# QA Report — run <runId>` if missing):

```markdown
## <worker> / <task> — attempt <n>
<assessment: PASS/NEEDS WORK + reasons>
```

4. End the reply with ONLY the verdict JSON on the final line, no fences:

```json
{"verdict":"pass","issues":[],"feedback":""}
{"verdict":"needs_work","issues":["specific issue 1","specific issue 2"],"feedback":"concrete instructions for the worker"}
```

## Rules that shape the verdict

- **Strict but fair** — demo-quality output that fulfills the task passes; don't gold-plate.
- `needs_work` auto-dispatches ONE revision (capped by `maxQaRetries`, default 1) to the worker's *resumed* session with your `issues` list verbatim — make each issue specific and fixable in one turn (past-run example: "index.html is missing a pricing section", "no responsive meta tag").
- After a graceful stop (`stopRequested`) no revision is dispatched — the verdict is still recorded.
- An unparseable verdict defaults to **pass** (logged) — always emit clean JSON as the last line.
- Modify no file except `QA_REPORT.md`.

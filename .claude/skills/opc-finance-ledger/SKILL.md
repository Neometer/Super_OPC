---
name: opc-finance-ledger
description: OPC FINANCE.md token-ledger format — YAML front matter fields, Totals/Per-agent/Notes sections, and the ground-truth rule that only the server's deterministic tally may be narrated. Load when writing or interpreting a run's finance ledger.
---

# OPC finance ledger (FINANCE.md)

**Ground truth rule:** the server's deterministic per-turn tally (`recordUsage()` → `run.tokens`, corroborated by `turn_usage` entries in `events.jsonl`) is the ONLY source of numbers. Never invent, estimate, or recompute tokens or costs. Cost fields are the server's USD estimates from `MODEL_PRICING` (per-model $/MTok; cache write 1.25× input, cache read 0.1×) — always label them "estimated".

`FINANCE.md` is **overwritten** (not appended) each refresh, in the run root, with exactly this structure:

```markdown
---
run: <runId>
generated: <ISO timestamp from the prompt>
trigger: <e.g. qa settled | run end | manual>
total_tokens: <n>
total_cost_usd: <n.nnnn>
agents_tracked: <n>
---

# Finance Report — run <runId>

## Totals

- Total tokens this run: **<n>**
- Total estimated cost this run: **$<n.nnnn>** (server-computed from per-model pricing)
- Agents and manager tracked: **<n>**

## Per-agent usage

| Agent | Turns | Input tokens | Output tokens | Total | Est. cost (USD) |
| --- | --- | --- | --- | --- | --- |
| <one row per agent in the tally, incl. manager and every worker, sorted by Total descending> |

## Notes

<1-3 factual sentences, e.g. heaviest consumer; state that figures come from the server's
deterministic per-turn tally (turn_usage entries in events.jsonl) and costs are estimates.>
```

Keep the markdown simple and pipe-balanced so the server converts it to `FINANCE.html` without error. Modify no other file.

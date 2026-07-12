---
name: opc-output-format
description: OPC deliverable format — every agent output is a markdown file with YAML front matter that must convert to HTML without error. Load before writing any task deliverable or run report file (research.md, RUN_SUMMARY.md, FINANCE.md, worker outputs).
---

# OPC output format — md + YAML front matter

Project rule (from CLAUDE.md): **if not specified otherwise, all agents save output as a markdown file with YAML front matter, and the file must convert to HTML without error** (the server's `mdToHtml`/`buildMdHtmlFiles` converts every `.md` in the run folder to a styled sibling `.html` for `BUILD_REPORT.html`).

## Template

```markdown
---
title: <short human title>
agent: <agent name, e.g. researcher>
task: <task slug this file fulfills>
run: <runId, if known>
date: <ISO date given in the prompt — never invent one>
---

# <Title>

<content...>

## Sources        <!-- for research-type outputs -->
- <url or document>
```

## Front-matter rules

- Exactly two `---` lines delimiting the block, at the very top of the file (line 1).
- Simple `key: value` scalars only; quote values containing `:`, `#`, or leading special characters.
- No tabs; two-space indentation if nesting is unavoidable.

## HTML-safe markdown rules

- Use standard GFM only: headings, paragraphs, lists, tables, fenced code blocks, links, bold/italic.
- No raw HTML tags in the body (a stray `<` or unclosed tag breaks conversion) — write `&lt;` inside prose or put angle-bracket content in code spans/fences.
- Close every fence you open; keep table rows pipe-balanced with a `| --- |` separator row.
- Name the file exactly what the task prompt requires (QA verifies the exact deliverable file name).
- Write only inside your own agent folder unless you are an oversight agent maintaining your designated run-root report file.

# Future Implementations

## More Customize Features

1. **Add agents:** edit the `AGENTS` map in `server.js` (name + workspace dir). Cards appear automatically.
2. **Widen tools:** adjust `ALLOWED_TOOLS`, e.g. add `Bash(npm *)`, `WebFetch`, or your MCP tools (`mcp__<server>__<tool>`).
3. **Seed workspaces:** drop a `CLAUDE.md` into each agent's workspace folder to give it a role. For dynamic workers, have `ensureAgent()` write one from a template.
4. **Tune the plan prompt:** the manager prompt template lives in the `/orchestrate` handler — adjust task count, add role types, or require dependencies between tasks.

## Sanity checks

```bash
claude --help | grep -E "resume|output-format|allowedTools|verbose"
claude -p "say hi" --output-format stream-json --verbose | head -5
```

Notes:
- `--output-format stream-json` requires `--verbose` in print mode on current CLI versions; if your version differs, adjust `runClaudeTurn()`.
- Turns take 10–60+ s. The tool-activity lines keep the audience engaged.

## "New Run" button

Add a "New Run" button on the top bar.
Will refresh the html including the Claude Code CLI.

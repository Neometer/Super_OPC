#!/usr/bin/env node
/**
 * Guardrail: syntax-check all inline <script> blocks in index.html.
 *
 * - Extracts every inline <script> (skips ones with src=...)
 * - Runs `node --check` on each block (as ESM if type="module")
 * - Rewrites error line numbers so they point at the real line in index.html
 *
 * Usage:  node check-html.js [path/to/index.html]
 * Exits non-zero on any syntax error, so it works in npm test / CI / hooks.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const htmlPath = process.argv[2] || "index.html";

if (!fs.existsSync(htmlPath)) {
  console.error(`✗ File not found: ${htmlPath}`);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, "utf8");

// Match <script ...attrs...> ... </script>, capturing attrs and body
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

let match;
let blockNum = 0;
let failures = 0;
let checked = 0;

while ((match = scriptRe.exec(html)) !== null) {
  blockNum++;
  const [, attrs, body] = match;

  // Skip external scripts and non-JS blocks (e.g. type="application/json", templates)
  if (/\bsrc\s*=/i.test(attrs)) continue;
  const typeMatch = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
  const type = typeMatch ? typeMatch[1].toLowerCase() : "";
  const isModule = type === "module";
  const isJs = !type || isModule || /javascript|ecmascript/.test(type);
  if (!isJs) continue;
  if (!body.trim()) continue;

  checked++;

  // Line in the HTML where the script body starts (for error remapping)
  const bodyStart = match.index + match[0].indexOf(">") + 1;
  const lineOffset = html.slice(0, bodyStart).split("\n").length - 1;

  // Write block to a temp file and run `node --check`
  const tmp = path.join(
    os.tmpdir(),
    `check-html-${process.pid}-${blockNum}${isModule ? ".mjs" : ".js"}`
  );
  fs.writeFileSync(tmp, body);

  const result = spawnSync(process.execPath, ["--check", tmp], {
    encoding: "utf8",
  });
  fs.unlinkSync(tmp);

  if (result.status !== 0) {
    failures++;
    // Remap "tmpfile:LINE" to "index.html:REAL_LINE"
    const remapped = result.stderr
      .split("\n")
      .map((line) =>
        line.replace(
          new RegExp(tmp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":(\\d+)"),
          (_, n) => `${htmlPath}:${Number(n) + lineOffset}`
        )
      )
      .join("\n");
    console.error(`✗ Syntax error in <script> block #${blockNum}:\n`);
    console.error(remapped);
  }
}

if (checked === 0) {
  console.warn(`⚠ No inline <script> blocks found in ${htmlPath}`);
  process.exit(0);
}

if (failures > 0) {
  console.error(`\n✗ ${failures} of ${checked} script block(s) failed.`);
  process.exit(1);
}

console.log(`✓ ${checked} inline script block(s) in ${htmlPath} passed node --check`);

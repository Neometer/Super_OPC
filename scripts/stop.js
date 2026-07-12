#!/usr/bin/env node
/**
 * `npm stop` — gracefully stop the running OPC server.
 *
 * Reads .opc-server.json (written by server.js on boot; survives the port
 * guardrail picking a non-default port) and POSTs /shutdown so the run is
 * closed with a final run_ended journal entry. A plain kill can't do that
 * on Windows: signals sent cross-process terminate the target without
 * running its SIGINT handler.
 *
 * Fallback: if the endpoint is unreachable but the pid is alive, the
 * process is killed forcefully (run_ended will be missing — same as a
 * crash). A state file whose pid is dead is treated as stale and removed.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const STATE_FILE = path.join(ROOT, ".opc-server.json");

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// same token resolution order as server.js (never stored in the state file)
function authToken() {
  if (process.env.AUTH_TOKEN) return process.env.AUTH_TOKEN;
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "opc.config.json"), "utf8"))
      .server?.authToken || null;
  } catch { return null; }
}

let state;
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
} catch {
  console.error("✗ no .opc-server.json — server not running (or was started by an older version; stop it with Ctrl-C in its terminal)");
  process.exit(1);
}

if (!alive(state.pid)) {
  fs.unlinkSync(STATE_FILE);
  console.log(`· stale state file (pid ${state.pid} is gone) — removed, nothing to stop`);
  process.exit(0);
}

// 0.0.0.0 / :: listen on all interfaces but aren't connectable addresses
const host = ["0.0.0.0", "::"].includes(state.host) ? "127.0.0.1" : state.host;
const token = authToken();

const req = http.request({
  host, port: state.port, path: "/shutdown", method: "POST", timeout: 3000,
  headers: token ? { "x-auth-token": token } : {},
}, res => {
  res.resume();
  if (res.statusCode === 200) waitForExit();
  else {
    console.error(`✗ /shutdown returned ${res.statusCode}${res.statusCode === 401 ? " — token mismatch (set AUTH_TOKEN to the one the server printed)" : ""}`);
    process.exit(1);
  }
});
req.on("error", forceKill);
req.on("timeout", () => { req.destroy(); forceKill(); });
req.end();

// poll for the pid to disappear; the graceful path allows ~600ms for
// run_ended, but live-mode shutdowns can also fire final logger/finance/
// audit turns — give them a generous 15s window
function waitForExit(deadline = Date.now() + 15000) {
  if (!alive(state.pid)) {
    console.log(`✓ server stopped gracefully (pid ${state.pid}, port ${state.port}) — run closed with run_ended`);
    process.exit(0);
  }
  if (Date.now() > deadline) {
    console.error(`✗ server (pid ${state.pid}) accepted /shutdown but did not exit within 15s`);
    process.exit(1);
  }
  setTimeout(() => waitForExit(deadline), 200);
}

function forceKill() {
  if (!alive(state.pid)) {
    try { fs.unlinkSync(STATE_FILE); } catch {}
    console.log(`✓ server already exited (pid ${state.pid})`);
    process.exit(0);
  }
  try { process.kill(state.pid); } catch {}
  console.log(`⚠ /shutdown unreachable — force-killed pid ${state.pid} (run_ended entry is missing for this run)`);
  try { fs.unlinkSync(STATE_FILE); } catch {}
  process.exit(0);
}

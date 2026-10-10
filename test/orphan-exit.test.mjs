// The MCP server left behind when its client is gone: stderr's reader has closed but stdin is still open.
// Falsifier: before the fix, the first log line raised EPIPE on stderr, the uncaught exception handler logged it to
// stderr again, and the server looped forever, rewriting server.log at full speed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "mcp", "server.mjs");
const EXIT_WITHIN_MS = 5000;
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `ss-orphan-${label}-`));

test("server exits instead of looping when stderr is closed", async () => {
  // Arrange
  const home = tmp("home");
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, SYNERGY_STUDIO_HOME: home, SYNERGY_STUDIO_PROJECTS: tmp("projects") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Act: the client goes away without closing stdin, then the server has something to log
  child.stderr.destroy();
  child.stdout.destroy();
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const timer = new Promise((resolve) => setTimeout(() => resolve("timeout"), EXIT_WITHIN_MS));
  const outcome = await Promise.race([exited, timer]);
  if (outcome === "timeout") child.kill("SIGKILL");

  // Assert
  assert.notEqual(outcome, "timeout", `server still running ${EXIT_WITHIN_MS} ms after its stderr closed`);
  const logFile = path.join(home, "server.log");
  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean) : [];
  assert.ok(lines.filter((l) => l.includes("EPIPE")).length <= 2, "server.log filled with EPIPE lines");
});

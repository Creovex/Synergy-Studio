// The tool home stays small: finished job files are pruned by age and count, and server.log is rotated at a size cap.
// Falsifiers: without pruning the 130 old jobs remain; without rotation the log grows past the cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { pruneJobs, rotateLog, JOB_KEEP_DAYS, JOB_KEEP_COUNT, LOG_MAX_BYTES } = await import(pathToFileURL(path.join(ROOT, "mcp", "housekeeping.mjs")).href);

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse("2026-10-03T12:00:00Z");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ss-house-"));

function makeJob(dir, id, { state = "done", ageDays = 0, pid = null, json = true } = {}) {
  const when = new Date(NOW - ageDays * DAY);
  const files = [path.join(dir, `${id}.log`)];
  fs.writeFileSync(files[0], "log line\n");
  if (json) {
    files.push(path.join(dir, `${id}.json`));
    fs.writeFileSync(files[1], JSON.stringify({ id, state, runner_pid: pid }));
  }
  for (const f of files) fs.utimesSync(f, when, when);
}
const ids = (dir) => [...new Set(fs.readdirSync(dir).map((f) => f.split(".")[0]))].sort();

test("finished jobs older than the age limit are removed, recent ones stay", () => {
  const dir = tmp();
  makeJob(dir, "old-done", { ageDays: JOB_KEEP_DAYS + 1 });
  makeJob(dir, "old-failed", { state: "failed", ageDays: JOB_KEEP_DAYS + 3 });
  makeJob(dir, "old-orphan", { ageDays: JOB_KEEP_DAYS + 2, json: false });
  makeJob(dir, "new-done", { ageDays: 1 });
  const removed = pruneJobs(dir, { now: NOW, isAlive: () => false });
  assert.equal(removed, 3);
  assert.deepEqual(ids(dir), ["new-done"]);
});

test("only the newest finished jobs are kept beyond the count limit", () => {
  const dir = tmp();
  const total = JOB_KEEP_COUNT + 30;
  for (let i = 0; i < total; i++) makeJob(dir, `job${String(i).padStart(4, "0")}`, { ageDays: (total - i) / 1000 });
  pruneJobs(dir, { now: NOW, isAlive: () => false });
  const left = ids(dir);
  assert.equal(left.length, JOB_KEEP_COUNT);
  assert.equal(left[0], `job${String(30).padStart(4, "0")}`);   // the 30 oldest went
});

test("a running job is never removed, however old; a dead stale one is", () => {
  const dir = tmp();
  makeJob(dir, "running", { state: "running", ageDays: 30, pid: 111 });
  makeJob(dir, "stale", { state: "running", ageDays: 30, pid: 222 });
  makeJob(dir, "queued-new", { state: "queued", ageDays: 0 });
  pruneJobs(dir, { now: NOW, isAlive: (pid) => pid === 111 });
  assert.deepEqual(ids(dir), ["queued-new", "running"]);
});

test("a missing jobs folder is not an error", () => {
  assert.equal(pruneJobs(path.join(tmp(), "nope"), { now: NOW }), 0);
});

test("server.log is rotated to server.log.1 past the cap, keeping one old copy", () => {
  const dir = tmp();
  const file = path.join(dir, "server.log");
  fs.writeFileSync(file, "small\n");
  assert.equal(rotateLog(file, 100), false);
  fs.writeFileSync(file, "x".repeat(150));
  fs.writeFileSync(`${file}.1`, "older");
  assert.equal(rotateLog(file, 100), true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(`${file}.1`, "utf8").length, 150);
  assert.equal(rotateLog(path.join(dir, "absent.log"), 100), false);
  assert.ok(LOG_MAX_BYTES >= 1024 * 1024);
});

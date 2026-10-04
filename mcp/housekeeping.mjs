// Keeps the tool home small. Finished jobs (<home>/jobs/<id>.json and .log) are pruned when older than JOB_KEEP_DAYS
// or beyond the newest JOB_KEEP_COUNT; a job whose runner is alive is never touched. server.log is renamed to
// server.log.1 once it passes LOG_MAX_BYTES, so the logs never hold more than about twice the cap.
import fs from "node:fs";
import path from "node:path";
import { pidIsAlive } from "../skills/synergy-studio/scripts/lib/lock.mjs";

export const JOB_KEEP_DAYS = 7;
export const JOB_KEEP_COUNT = 100;
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 3600 * 1000;
const FINAL = new Set(["done", "failed"]);

// The job files in dir grouped by id, with the newest change time of each group.
function groupJobs(dir) {
  const groups = new Map();
  for (const name of fs.readdirSync(dir)) {
    const id = name.split(".")[0];
    const file = path.join(dir, name);
    let mtime;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    const group = groups.get(id) ?? { id, files: [], mtime: 0 };
    groups.set(id, { ...group, files: [...group.files, file], mtime: Math.max(group.mtime, mtime) });
  }
  return [...groups.values()];
}

// A job may go when it is final, has no record (a stray log), or is stuck unfinished with a dead runner.
function removable(dir, group, isAlive, oldEnough) {
  let job;
  try {
    job = JSON.parse(fs.readFileSync(path.join(dir, `${group.id}.json`), "utf8"));
  } catch {
    return oldEnough;
  }
  if (FINAL.has(job.state)) return true;
  return oldEnough && !(job.runner_pid && isAlive(job.runner_pid));
}

// Removes old finished jobs; returns how many were removed. A missing folder is not an error.
export function pruneJobs(dir, { now = Date.now(), keepDays = JOB_KEEP_DAYS, keepCount = JOB_KEEP_COUNT, isAlive = pidIsAlive } = {}) {
  if (!fs.existsSync(dir)) return 0;
  const cutoff = now - keepDays * DAY_MS;
  const candidates = groupJobs(dir)
    .filter((g) => removable(dir, g, isAlive, g.mtime < cutoff))
    .sort((a, b) => b.mtime - a.mtime);
  const doomed = candidates.filter((g, index) => g.mtime < cutoff || index >= keepCount);
  for (const group of doomed) for (const file of group.files) fs.rmSync(file, { force: true });
  return doomed.length;
}

// Renames file to file.1 (replacing the older copy) when it is larger than maxBytes; true when it rotated.
export function rotateLog(file, maxBytes = LOG_MAX_BYTES) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false;
  }
  if (size <= maxBytes) return false;
  fs.renameSync(file, `${file}.1`);
  return true;
}

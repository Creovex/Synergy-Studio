// The heavy lock: one setup, render or transcription at a time on a computer, shared by the CLI and the MCP server.
// <home>/locks/heavy.lock holds {pid, started, label} as JSON.
//
// Exports
//   withHeavyLock(home, label, fn, {log, pollMs})
//        runs fn() while holding the lock and returns its result. Waits while another live process holds the
//        lock (printing once, through log, that it waits). A lock whose pid is no longer running is taken over
//        and the takeover is written to <home>/server.log. The lock is always released, also on an error, on
//        exit and on SIGINT or SIGTERM. Code that runs inside fn (for example doctor called by setup) may call
//        withHeavyLock again for the same home: that inner call runs at once without waiting for itself.
//   readHeavyLock(home)   the current lock content {pid, started, label} or null
//   pidIsAlive(pid)       whether a process with that pid exists
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { layout } from "./paths.mjs";

const held = new AsyncLocalStorage();
const STALE_EMPTY_MS = 10000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function readHeavyLock(home) {
  try {
    const data = JSON.parse(fs.readFileSync(layout(home).heavyLock, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function logLine(home, text) {
  try {
    fs.appendFileSync(layout(home).serverLog, `${new Date().toISOString()} ${text}\n`);
  } catch {
    // The log is a courtesy; a failure to write it never blocks work.
  }
}

// True when the lock file exists but no live process owns it.
function isStale(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return Date.now() - stat.mtimeMs > STALE_EMPTY_MS;
  }
  return !pidIsAlive(owner?.pid);
}

function tryCreate(file, token, label) {
  try {
    const fd = fs.openSync(file, "wx");
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), label, token }));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

// Removes a stale lock. Two processes may notice the same dead owner; a directory used as a mutex lets only one
// of them delete it, and the check is repeated inside the mutex so a fresh lock is never removed.
function takeOverStale(home, file) {
  const mutex = `${file}.takeover`;
  try {
    fs.mkdirSync(mutex);
  } catch {
    try {
      if (Date.now() - fs.statSync(mutex).mtimeMs > STALE_EMPTY_MS) fs.rmdirSync(mutex);
    } catch {
      // Someone else finished it.
    }
    return false;
  }
  try {
    if (!isStale(file)) return false;
    const old = readHeavyLock(home);
    fs.rmSync(file, { force: true });
    const detail = old ? `pid ${old.pid}, ${old.label ?? "unknown job"}, started ${old.started}` : "unreadable lock";
    logLine(home, `took over a stale heavy lock (${detail})`);
    return true;
  } finally {
    fs.rmSync(mutex, { recursive: true, force: true });
  }
}

export async function withHeavyLock(home, label, fn, { log = console.log, pollMs = 1000 } = {}) {
  const store = held.getStore();
  if (store?.has(path.resolve(home))) return fn();
  const paths = layout(home);
  fs.mkdirSync(paths.locks, { recursive: true });
  const token = crypto.randomUUID();
  let announced = false;
  for (;;) {
    if (tryCreate(paths.heavyLock, token, label)) break;
    if (isStale(paths.heavyLock) && takeOverStale(home, paths.heavyLock)) continue;
    if (!announced) {
      const owner = readHeavyLock(home);
      const who = owner ? `${owner.label ?? "another job"}, process ${owner.pid}` : "another job";
      log(`Waiting for ${who} to finish (only one setup, render or transcription runs at a time).`);
      announced = true;
    }
    await sleep(pollMs);
  }
  const release = () => {
    const owner = readHeavyLock(home);
    if (owner?.token === token) fs.rmSync(paths.heavyLock, { force: true });
  };
  const onSignal = (signal) => {
    release();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("exit", release);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const next = new Set(store ?? []);
    next.add(path.resolve(home));
    return await held.run(next, fn);
  } finally {
    process.off("exit", release);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    release();
  }
}

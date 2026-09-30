// Jobs: long work runs in a detached runner process that writes <home>/jobs/<id>.log and <id>.json.
// States: queued, running, done, failed. The record survives a server restart because the runner owns it.
// A job that finishes within a short wait can be dropped again (ephemeral), so quick tools leave no files.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { paths, home, JOB_RUNNER, UserError } from "./context.mjs";
import { pidIsAlive } from "../skills/synergy-studio/scripts/lib/lock.mjs";
import { imageContent } from "./images.mjs";

export const MAX_WAIT_SEC = 25;
const POLL_MS = 250;
const STARTUP_GRACE_MS = 15000;
const ID_RE = /^[a-z0-9-]{4,64}$/;
const FINAL = new Set(["done", "failed"]);
const MAX_IMAGES = 12;

export const newJobId = () => `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
const jobFile = (id) => path.join(paths().jobs, `${id}.json`);
const logFile = (id) => path.join(paths().jobs, `${id}.log`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function checkId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new UserError(`"${id}" is not a job id. Job ids look like mf3k2x9a-1a2b3c and come from the tool that started the job.`);
  return id;
}

// Starts a job. spec: {label, node, args, cwd, env, id?, kind? ("studio" or "hyperframes"), heavy?, attach?, project?}
// attach: {files: [absolute paths], globs: [{dir, pattern (RegExp source)}]}, pictures added to the result when fresh.
export function startJob(spec) {
  const id = spec.id ?? newJobId();
  const jobs = paths().jobs;
  fs.mkdirSync(jobs, { recursive: true });
  const record = {
    id,
    label: spec.label,
    kind: spec.kind ?? "studio",
    state: "queued",
    created: new Date().toISOString(),
    started: null,
    ended: null,
    exit_code: null,
    result: null,
    command: [spec.node, ...spec.args].join(" "),
    project: spec.project ?? null,
    attach: spec.attach ?? { files: [], globs: [] },
    heavy: Boolean(spec.heavy),
    home: home(),
    log: logFile(id),
    runner_pid: null,
    cmd: { node: spec.node, args: spec.args, cwd: spec.cwd },
  };
  fs.writeFileSync(jobFile(id), `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(logFile(id), "");
  const runner = spawn(process.execPath, [JOB_RUNNER, jobFile(id)], { detached: true, stdio: "ignore", shell: false, env: spec.env ?? process.env });
  runner.on("error", () => {});
  runner.unref();
  return id;
}

// The job record with a stale running state corrected (a runner that died leaves no final state).
export function readJob(id) {
  checkId(id);
  let job;
  try {
    job = JSON.parse(fs.readFileSync(jobFile(id), "utf8"));
  } catch {
    throw new UserError(`No job with id ${id}. Job records live in ${paths().jobs}.`);
  }
  if (!FINAL.has(job.state)) {
    const age = Date.now() - Date.parse(job.created);
    const dead = job.runner_pid ? !pidIsAlive(job.runner_pid) : age > STARTUP_GRACE_MS;
    if (dead) {
      let again = job;
      try {
        again = JSON.parse(fs.readFileSync(jobFile(id), "utf8"));
      } catch {
        // keep what was read
      }
      if (!FINAL.has(again.state)) {
        return { ...again, state: "failed", ended: new Date().toISOString(), exit_code: null, result: { text: `${tailOfLog(id, 4000)}\nThe job process ended before it recorded a result.`.trim(), json: null } };
      }
      return again;
    }
  }
  return job;
}

export function tailOfLog(id, bytes) {
  try {
    const data = fs.readFileSync(logFile(id));
    return (data.length > bytes ? data.subarray(data.length - bytes) : data).toString("utf8");
  } catch {
    return "";
  }
}

export function logLines(id, count) {
  checkId(id);
  if (!fs.existsSync(logFile(id))) throw new UserError(`No log for job ${id}.`);
  const lines = fs.readFileSync(logFile(id), "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-count).join("\n");
}

// Waits until the job is final, the time is up or the signal aborts; returns the latest record.
export async function waitForJob(id, seconds, signal) {
  const deadline = Date.now() + Math.min(Math.max(seconds, 0), MAX_WAIT_SEC) * 1000;
  for (;;) {
    const job = readJob(id);
    if (FINAL.has(job.state) || Date.now() >= deadline || signal?.aborted) return job;
    await sleep(Math.min(POLL_MS, Math.max(deadline - Date.now(), 0)));
  }
}

export const isFinal = (job) => FINAL.has(job.state);

// Pictures a finished job made: fresh files named by the job's attach list, as MCP image content.
export async function jobImages(job) {
  const since = Date.parse(job.started ?? job.created) - 2000;
  const files = [...(job.attach?.files ?? [])];
  for (const { dir, pattern } of job.attach?.globs ?? []) {
    try {
      const re = new RegExp(pattern);
      for (const name of fs.readdirSync(dir).sort()) if (re.test(name)) files.push(path.join(dir, name));
    } catch {
      // the folder does not exist
    }
  }
  const content = [];
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file) || content.length >= MAX_IMAGES) continue;
    seen.add(file);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (stat.mtimeMs < since) continue;
    const image = await imageContent(file);
    if (image) content.push(image);
  }
  return content;
}

// Removes the record and log of a job nobody needs to poll.
export function dropJob(id) {
  for (const file of [jobFile(id), logFile(id)]) fs.rmSync(file, { force: true });
}

export function progressText(job) {
  const lines = tailOfLog(job.id, 3000).split("\n").filter((line) => line.trim() !== "");
  const waiting = lines.at(-1)?.startsWith("Waiting for");
  const seconds = Math.round((Date.now() - Date.parse(job.started ?? job.created)) / 1000);
  const head = waiting || job.state === "queued" ? `queued, waiting for the heavy lock (${seconds} s)` : `running for ${seconds} s`;
  return `${head}\n${lines.slice(-8).join("\n")}`.trim();
}

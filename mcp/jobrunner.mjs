// The process that owns one job. The server starts it detached, so it keeps going when the server exits, and
// it writes the final state into <home>/jobs/<id>.json itself. Usage: node jobrunner.mjs <job file>
// The job file holds cmd {node, args, cwd}, heavy (take locks/heavy.lock around the command), home and label.
// The command's standard output and error go to the job's log file as they arrive.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { withHeavyLock } from "../skills/synergy-studio/scripts/lib/lock.mjs";

const jobFile = process.argv[2];
const TAIL_BYTES = 16 * 1024;
const STDOUT_CAP = 2 * 1024 * 1024;

function readJob() {
  return JSON.parse(fs.readFileSync(jobFile, "utf8"));
}

function update(patch) {
  const next = { ...readJob(), ...patch };
  const part = `${jobFile}.${process.pid}.part`;
  fs.writeFileSync(part, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(part, jobFile);
  return next;
}

function tail(text, bytes) {
  const buffer = Buffer.from(text, "utf8");
  return buffer.length <= bytes ? text : buffer.subarray(buffer.length - bytes).toString("utf8");
}

// JSON on standard output, whole or on its last line; null when there is none.
function parseJson(stdout) {
  const text = stdout.trim();
  for (const candidate of [text, text.split("\n").pop()]) {
    try {
      const value = JSON.parse(candidate);
      return JSON.stringify(value).length < 200000 ? value : null;
    } catch {
      // not JSON
    }
  }
  return null;
}

function runCommand(job, logFile) {
  return new Promise((resolve) => {
    let stdout = "";
    const append = (chunk) => fs.appendFileSync(logFile, chunk);
    const child = spawn(job.cmd.node, job.cmd.args, { cwd: job.cmd.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    child.stdout.on("data", (chunk) => {
      append(chunk);
      if (stdout.length < STDOUT_CAP) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", append);
    child.on("error", (error) => {
      append(`could not start the command: ${error.message}\n`);
      resolve({ code: null, stdout });
    });
    child.on("close", (code, signal) => {
      if (signal) append(`the command was stopped by ${signal}\n`);
      resolve({ code: code ?? null, stdout });
    });
  });
}

async function main() {
  const job = readJob();
  const logFile = job.log;
  fs.appendFileSync(logFile, "");
  update({ runner_pid: process.pid, state: job.heavy ? "queued" : "running", started: new Date().toISOString() });
  let outcome;
  try {
    const go = async () => {
      if (job.heavy) update({ state: "running" });
      return runCommand(job, logFile);
    };
    outcome = job.heavy ? await withHeavyLock(job.home, job.label, go, { log: (line) => fs.appendFileSync(logFile, `${line}\n`) }) : await go();
  } catch (error) {
    fs.appendFileSync(logFile, `job error: ${error.message}\n`);
    outcome = { code: null, stdout: "" };
  }
  let logText = "";
  try {
    logText = fs.readFileSync(logFile, "utf8");
  } catch {
    // no log
  }
  update({
    state: outcome.code === 0 ? "done" : "failed",
    ended: new Date().toISOString(),
    exit_code: outcome.code,
    result: { text: tail(logText, TAIL_BYTES).trim(), json: parseJson(outcome.stdout) },
  });
}

main().then(
  () => process.exit(0),
  (error) => {
    try {
      update({ state: "failed", ended: new Date().toISOString(), exit_code: null, result: { text: `the job runner failed: ${error.message}`, json: null } });
    } catch {
      // nothing more can be recorded
    }
    process.exit(1);
  },
);

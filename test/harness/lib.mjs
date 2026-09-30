// Shared helpers for the gate harness scripts: tool home, CLI runner, project copies, ffmpeg, result lines.
// Nothing here imports the CLI's own modules: every script goes through `node studio.mjs <command>`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const HARNESS = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HARNESS, "..", "..");
export const SKILL = path.join(REPO, "skills", "synergy-studio");
export const STUDIO = path.join(SKILL, "scripts", "studio.mjs");
export const FIXTURES = path.join(HARNESS, "fixtures");
export const SIZES = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };

// Exit codes shared by every script: 0 all PASS, 1 usage or setup error, 2 a FAIL line, 3 PENDING
export const EXIT = { PASS: 0, USAGE: 1, FAIL: 2, PENDING: 3 };

export function toolHome() {
  if (process.env.SYNERGY_STUDIO_HOME) return path.resolve(process.env.SYNERGY_STUDIO_HOME);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "SynergyStudioLite");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "synergy-studio-lite");
}

// the tool home's env.json (paths of ffmpeg, python, models); usage error when setup has not run
export function loadEnv() {
  const file = path.join(toolHome(), "env.json");
  if (!fs.existsSync(file)) usage(`the tool home is not set up (no ${file}): run  node ${STUDIO} setup`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function usage(message, text) {
  console.error(`ERROR: ${message}` + (text ? `\n${text}` : ""));
  process.exit(EXIT.USAGE);
}

// prints one result line and returns it: status is PASS, FAIL, WARN, INFO or PENDING
export function line(status, name, info = "") {
  const text = `${status.padEnd(4)}  ${name}${info ? `: ${info}` : ""}`;
  console.log(text);
  return { status, name, info };
}

export function exitFor(results) {
  if (results.some((r) => r.status === "FAIL")) return EXIT.FAIL;
  if (results.some((r) => r.status === "PENDING")) return EXIT.PENDING;
  return EXIT.PASS;
}

// runs the studio CLI with the current node; returns {status, stdout, stderr, out}
export function studio(args, opts = {}) {
  const r = spawnSync(process.execPath, [STUDIO, ...args.map(String)], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) }, timeout: opts.timeout ?? 45 * 60 * 1000,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", out: (r.stdout || "") + (r.stderr || ""), error: r.error };
}

// same, but echoes the CLI output so a long render shows progress in the log
export function studioLogged(args, opts = {}) {
  console.log(`  $ studio ${args.join(" ")}`);
  const r = studio(args, opts);
  const tail = r.out.split("\n").filter((l) => l.trim() && !/\[(INFO|Render)/.test(l)).slice(-4).map((l) => `    ${l.slice(0, 220)}`).join("\n");
  if (tail.trim()) console.log(tail);
  return r;
}

export function tool(file, args, opts = {}) {
  const r = spawnSync(file, args.map(String), { encoding: opts.binary ? "buffer" : "utf8", maxBuffer: 1024 * 1024 * 1024, cwd: opts.cwd, timeout: opts.timeout ?? 15 * 60 * 1000 });
  if (r.error) throw new Error(`${path.basename(file)} failed to start: ${r.error.message}`);
  return r;
}

export function ffmpeg(env, args, opts = {}) {
  const r = tool(env.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], opts);
  if (r.status !== 0 && !opts.soft) throw new Error(`ffmpeg ${args.slice(0, 6).join(" ")} failed: ${String(r.stderr).slice(-600)}`);
  return r;
}

export function probe(env, file, entries = "stream=codec_type,codec_name,width,height,r_frame_rate,start_time:format=duration") {
  const r = tool(env.ffprobe, ["-v", "error", "-show_entries", entries, "-of", "json", file]);
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

export const tempDir = (prefix) => fs.mkdtempSync(path.join(process.env.HARNESS_TMP || os.tmpdir(), `synergy-harness-${prefix}-`));
export const rmDir = (dir) => fs.rmSync(dir, { recursive: true, force: true });
export const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// copy a project without the folders a later command rebuilds
const REBUILT = new Set(["comp", "stills", "history", "work"]);
export function copyProject(src, dest, { keepOut = false } = {}) {
  fs.cpSync(src, dest, { recursive: true, filter: (from) => {
    const rel = path.relative(src, from).split(path.sep);
    if (REBUILT.has(rel[0])) return false;
    if (!keepOut && rel[0] === "out" && rel.length > 1) return false;
    return true;
  } });
  return dest;
}

// the project's finished MP4 (not the -share copy, not the raw render)
export function findMp4(projectDir) {
  const out = path.join(projectDir, "out");
  const files = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.endsWith(".mp4") && !/-share\.mp4$|^render-raw/.test(f)) : [];
  return files.length ? path.join(out, files[0]) : null;
}

export function requireProject(dir) {
  if (!dir) usage("give the project folder");
  const d = path.resolve(dir);
  if (!fs.existsSync(path.join(d, "project.json"))) usage(`${d} has no project.json`);
  return d;
}

// Kokoro is not needed here; a tiny mono 16 bit WAV writer for generated fixtures
export function writeWav(file, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

// a script is the entry point when its file is the one node was started with
export const isMain = (metaUrl) => process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);

// the PASS and FAIL lines of `check` as {name, ok, info}; `check` prints "PASS  name: info"
export function parseCheck(out) {
  return out.split("\n").map((l) => /^\s*(PASS|FAIL)\s+([^:]+?):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => ({ name: m[2].trim(), ok: m[1] === "PASS", info: m[3].trim() }));
}

// a copy of the project (with its rendered MP4) to run `check` on; returns {dir, mp4}
export function checkCopy(work, name, src) {
  const dir = copyProject(src, path.join(work, name), { keepOut: true });
  const mp4 = findMp4(dir);
  if (!mp4) usage(`${src} has no rendered MP4 in out/: run render first`);
  return { dir, mp4 };
}

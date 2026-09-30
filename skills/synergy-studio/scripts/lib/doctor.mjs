// doctor: one PASS, WARN or FAIL line per check. Exit 0 when every line is PASS or WARN, 2 when a check FAILs,
// 1 when there is no usable env.json for this home (not set up, or written for another home).
// Doctor writes only inside a temporary folder that it removes at the end.
//
// Exports
//   USAGE, main(argv)              the command
//   runDoctor({home, full, log})   runs the checks, prints the lines, returns the exit code (setup calls this)
//   synctestIsCurrent(env, home)   whether env.synctest matches the installed HyperFrames and browser versions
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MIN_FREE_BYTES, freeDiskBytes, isInside, toolHome } from "./paths.mjs";
import { loadEnv, toolEnv } from "./env.mjs";
import { run, runHyperframes, runPython, sha256File } from "./run.mjs";
import { withHeavyLock } from "./lock.mjs";
import { MODELS, NPM_PACKAGES, PINS, WHISPER, WHISPER_MODEL, WHISPER_MODEL_FIX, binaryArch, readWhisperInfo } from "./setup.mjs";

export const USAGE = "doctor [--full]  checks the installation; --full also test renders a 60 fps page and a three.js page";

const LIB = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(LIB, "doctor-fixtures");
const GB = 1024 ** 3;
const RENDER_TIMEOUT_MS = 240000;
const LOOKS_LIKE_CONTENT_YMAX = 80;

const PASS = (check, detail) => ({ status: "PASS", check, detail });
const WARN = (check, detail, fix) => ({ status: "WARN", check, detail, fix });
const FAIL = (check, detail, fix) => ({ status: "FAIL", check, detail, fix });

function formatLine(r) {
  return r.fix ? `${r.status} ${r.check}: ${r.detail}. Fix: ${r.fix}` : `${r.status} ${r.check}: ${r.detail}`;
}

const firstLine = (text) => (text ?? "").trim().split("\n")[0] ?? "";
const lastLines = (r, n = 3) => `${r.stdout}\n${r.stderr}`.trim().split("\n").slice(-n).join(" | ");
const SETUP_AGAIN = "run setup again";
const bannerVersion = (text) => /^(\w+) version (\S+)/.exec(firstLine(text))?.slice(1).join(" ") ?? firstLine(text);

// ---------------------------------------------------------------- simple checks

async function versionCheck(check, bin, args, env, expected, pick = firstLine, shown = bin) {
  if (!fs.existsSync(bin)) return FAIL(check, `missing at ${bin}`, SETUP_AGAIN);
  const r = await run(bin, args, { env, timeoutMs: 30000 });
  if (r.code !== 0) return FAIL(check, `does not start (${lastLines(r, 1)})`, SETUP_AGAIN);
  const got = pick(r.stdout);
  if (expected && got !== expected) return FAIL(check, `found ${got}, expected ${expected}`, SETUP_AGAIN);
  return PASS(check, `${got} at ${shown}`);
}

async function pythonCheck(env) {
  const code = [
    "import sys, importlib.metadata as m",
    "import kokoro_onnx, soundfile, numpy, PIL, imageio_ffmpeg",
    "print('%d.%d.%d' % sys.version_info[:3], 'kokoro-onnx', m.version('kokoro-onnx'))",
  ].join("\n");
  if (!fs.existsSync(env.python)) return FAIL("python and kokoro", `missing at ${env.python}`, SETUP_AGAIN);
  const r = await runPython(env, ["-c", code], { timeoutMs: 120000 });
  if (r.code !== 0) return FAIL("python and kokoro", `the voice packages do not import (${lastLines(r, 1)})`, SETUP_AGAIN);
  if (!isInside(env.python, env.home)) return FAIL("python and kokoro", `the venv Python lives outside this home (${env.python})`, SETUP_AGAIN);
  const line = firstLine(r.stdout);
  if (!line.startsWith(`${PINS.python}.`)) return FAIL("python and kokoro", `Python ${line}, expected ${PINS.python}`, SETUP_AGAIN);
  return PASS("python and kokoro", `Python ${line}, imports work`);
}

async function modelCheck(env) {
  const problems = [];
  const files = [];
  for (const model of MODELS) {
    const file = model.key === "modelFile" ? env.kokoro_model : env.kokoro_voices;
    if (!fs.existsSync(file)) { problems.push(`${model.name} is missing`); continue; }
    if (fs.statSync(file).size !== model.size) { problems.push(`${model.name} has the wrong size`); continue; }
    const hash = await sha256File(file);
    if (model.sha256 && hash !== model.sha256) problems.push(`${model.name} does not match its checksum`);
    files.push(`${model.name} ${hash.slice(0, 12)}`);
  }
  if (problems.length) return FAIL("model hashes", problems.join("; "), `${SETUP_AGAIN} (it downloads the file again)`);
  return PASS("model hashes", files.join(", "));
}

async function architectureCheck(env) {
  const bins = { node: env.node, uv: env.uv, ffmpeg: env.ffmpeg, ffprobe: env.ffprobe };
  const bad = [];
  for (const [name, file] of Object.entries(bins)) {
    if (!fs.existsSync(file)) { bad.push(`${name} is missing`); continue; }
    const arch = await binaryArch(file);
    if (!arch.ok) bad.push(`${name} is built for ${arch.detail}`);
  }
  if (bad.length) return FAIL("binary architecture", `${bad.join("; ")}; this computer is ${env.arch}`, SETUP_AGAIN);
  return PASS("binary architecture", `node, uv, ffmpeg and ffprobe are built for ${env.arch}`);
}

function chromeVersionOf(file) {
  const m = /(\d+\.\d+\.\d+\.\d+)/.exec(file ?? "");
  return m ? m[1] : null;
}

function installedHyperframesVersion(env) {
  try {
    return JSON.parse(fs.readFileSync(path.join(env.node_modules, "hyperframes", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

async function browserCheck(env) {
  const file = env.browser?.path;
  if (!file || !fs.existsSync(file)) return FAIL("render browser", "the render browser is missing", SETUP_AGAIN);
  const r = await run(file, ["--version"], { env: toolEnv(env), timeoutMs: 30000 });
  if (r.code !== 0) return FAIL("render browser", `does not start (${lastLines(r, 1)})`, SETUP_AGAIN);
  return PASS("render browser", `${firstLine(r.stdout)} at ${file}`);
}

// WARN, not FAIL: only transcribing speech needs the model.
async function whisperModelCheck(env) {
  const file = path.join(env.hf_home, ".cache", "hyperframes", "whisper", "models", WHISPER_MODEL.name);
  if (!fs.existsSync(file)) return WARN("whisper model", `missing (${file})`, WHISPER_MODEL_FIX);
  if (fs.statSync(file).size !== WHISPER_MODEL.size || (await sha256File(file)) !== WHISPER_MODEL.sha256) {
    return WARN("whisper model", `${file} has the wrong size or checksum`, WHISPER_MODEL_FIX);
  }
  return PASS("whisper model", file);
}

async function whisperCheck(env) {
  if (env.whisper?.available === false) {
    return FAIL("whisper", `transcription is unavailable: ${env.whisper.reason}`, "install the missing compiler, then run setup again");
  }
  const file = env.whisper?.path;
  if (!file || !fs.existsSync(file)) return FAIL("whisper", "the whisper-cli program is missing", SETUP_AGAIN);
  const r = await run(file, ["--help"], { env: toolEnv(env), timeoutMs: 30000 });
  if (r.code !== 0) return FAIL("whisper", `does not start (${lastLines(r, 1)})`, SETUP_AGAIN);
  const info = readWhisperInfo(env.home);
  if (info?.tag !== WHISPER.tag) return FAIL("whisper", `built from ${info?.tag ?? "an unknown release"}, expected ${WHISPER.tag}`, SETUP_AGAIN);
  return PASS("whisper", `whisper.cpp ${info.tag}${info.metal ? " with Metal" : ""} at ${file}`);
}

function diskCheck(home) {
  const free = freeDiskBytes(home);
  if (free === null) return WARN("free disk", "could not read the free space");
  if (free < MIN_FREE_BYTES) return FAIL("free disk", `${(free / GB).toFixed(1)} GB free, ${MIN_FREE_BYTES / GB} GB needed`, "free some disk space");
  return PASS("free disk", `${(free / GB).toFixed(1)} GB free`);
}

// ---------------------------------------------------------------- test renders

function prepareFixture(env, name, workDir) {
  const dir = path.join(workDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, name, "index.html"), path.join(dir, "index.html"));
  fs.copyFileSync(path.join(env.node_modules, "gsap", "dist", "gsap.min.js"), path.join(dir, "gsap.min.js"));
  fs.copyFileSync(path.join(env.node_modules, "@fontsource", "inter", "files", "inter-latin-400-normal.woff2"), path.join(dir, "doctor-sans.woff2"));
  if (name === "three") {
    fs.mkdirSync(path.join(dir, "three"));
    for (const file of ["three.module.js", "three.core.js"]) {
      fs.copyFileSync(path.join(env.node_modules, "three", "build", file), path.join(dir, "three", file));
    }
  }
  return dir;
}

async function probeVideo(env, file) {
  const args = ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate,duration", "-of", "default=nw=1", file];
  const r = await run(env.ffprobe, args, { env: toolEnv(env), timeoutMs: 30000 });
  const rate = /r_frame_rate=(\S+)/.exec(r.stdout)?.[1];
  const seconds = Number(/duration=(\S+)/.exec(r.stdout)?.[1]);
  return { rate, seconds };
}

async function brightestLuma(env, file) {
  const filter = "select=eq(n\\,10),signalstats,metadata=print:file=-:key=lavfi.signalstats.YMAX";
  const r = await run(env.ffmpeg, ["-v", "error", "-i", file, "-vf", filter, "-f", "null", "-"], { env: toolEnv(env), timeoutMs: 60000 });
  return Number(/YMAX=(\d+)/.exec(r.stdout)?.[1] ?? 0);
}

async function renderFixture(env, name, fps, workDir) {
  const dir = prepareFixture(env, name, workDir);
  const out = path.join(workDir, `${name}.mp4`);
  const args = ["render", dir, "-o", out, "--fps", String(fps), "--workers", "1", "--quiet"];
  const started = Date.now();
  const r = await runHyperframes(env, args, { cwd: dir, timeoutMs: RENDER_TIMEOUT_MS });
  if (r.code !== 0 || !fs.existsSync(out)) {
    const why = r.timedOut ? `no result after ${RENDER_TIMEOUT_MS / 1000} s` : lastLines(r);
    return { error: `the render failed (${why})` };
  }
  const video = await probeVideo(env, out);
  const luma = await brightestLuma(env, out);
  return { ...video, luma, took: (Date.now() - started) / 1000 };
}

function judgeRender(check, result) {
  if (result.error) return FAIL(check, result.error, `${SETUP_AGAIN}; if it repeats, the render browser may need reinstalling`);
  if (!(result.seconds > 0.9 && result.seconds < 1.15)) return FAIL(check, `the video is ${result.seconds} s long, expected 1 s`, SETUP_AGAIN);
  if (result.luma < LOOKS_LIKE_CONTENT_YMAX) return FAIL(check, "the video came out blank", `${SETUP_AGAIN}; if it repeats, the render browser cannot draw this page`);
  return PASS(check, `1 s at ${result.rate} fps in ${result.took.toFixed(1)} s`);
}

async function renderChecks(env, home, workDir) {
  return withHeavyLock(home, "doctor test renders", async () => {
    const lines = [];
    const fps = await renderFixture(env, "fps60", 60, workDir);
    if (!fps.error && fps.rate !== "60/1") lines.push(WARN("60 fps unsupported", `the test render came out at ${fps.rate} fps; use 30 fps`));
    else lines.push(judgeRender("60 fps render", fps));
    lines.push(judgeRender("three.js render", await renderFixture(env, "three", 30, workDir)));
    return lines;
  });
}

// ---------------------------------------------------------------- synctest

export function synctestIsCurrent(env) {
  const stored = env.synctest;
  if (!stored) return false;
  return stored.hyperframes_version === installedHyperframesVersion(env) && stored.browser_version === chromeVersionOf(env.browser?.path);
}

function synctestBuilt() {
  return ["compose.mjs", "render.mjs", "synctest.mjs"].every((f) => fs.existsSync(path.join(LIB, f)));
}

function describeStored(stored) {
  if (!stored) return "no stored result";
  return `stored for HyperFrames ${stored.hyperframes_version ?? "unknown"} and browser ${stored.browser_version ?? "unknown"}`;
}

async function synctestChecks(home, log) {
  if (!synctestBuilt()) return [];
  const env = loadEnv(home);
  if (synctestIsCurrent(env)) {
    const s = env.synctest;
    if (s.pass === false) return [FAIL("synctest", `the last result failed (mean offset ${s.mean_offset_ms} ms)`, "run synctest again and read its output")];
    const detail = s.mean_offset_ms === undefined ? "the last result matches the installed versions" : `last result: mean offset ${s.mean_offset_ms} ms`;
    return [PASS("synctest", detail)];
  }
  const now = `installed HyperFrames ${installedHyperframesVersion(env)} and browser ${chromeVersionOf(env.browser?.path)}`;
  const lines = [WARN("synctest out of date", `${describeStored(env.synctest)}, ${now}; running synctest`)];
  lines.forEach((l) => log(formatLine(l)));
  const mod = await import(pathToFileURL(path.join(LIB, "synctest.mjs")).href);
  const code = await mod.main([]);
  const after = loadEnv(home);
  if (code === 0 && synctestIsCurrent(after)) return [PASS("synctest", "picture and sound line up")];
  return [FAIL("synctest", `it finished with exit ${code}`, "read its output above; the render or the audio path needs attention")];
}

// ---------------------------------------------------------------- command

// Runs one check; a check that throws becomes a FAIL line. Always resolves to an array for the list checks.
async function safely(check, fn) {
  try {
    return await fn();
  } catch (error) {
    return FAIL(check, `the check itself failed (${error.message})`, SETUP_AGAIN);
  }
}

const asList = (value) => (Array.isArray(value) ? value : [value]);

export async function runDoctor({ home = toolHome(), full = false, log = console.log } = {}) {
  let env;
  try {
    env = loadEnv(home);
  } catch (error) {
    if (error.code === "FOREIGN_HOME") log(`FAIL setup: env.json belongs to another home (${error.otherHome}). Fix: run setup`);
    else log(`FAIL setup: this computer is not set up yet (no usable env.json in ${home}). Fix: run setup`);
    return 1;
  }
  const te = toolEnv(env);
  const results = [];
  const emit = (r) => { results.push(r); log(formatLine(r)); };
  emit(await safely("runtime node", () => versionCheck("runtime node", env.node, ["--version"], te, PINS.node)));
  emit(await safely("uv", () => versionCheck("uv", env.uv, ["--version"], te, PINS.uv, (t) => firstLine(t).split(" ")[1])));
  emit(await safely("python and kokoro", () => pythonCheck(env)));
  emit(await safely("model hashes", () => modelCheck(env)));
  emit(await safely("ffmpeg", () => versionCheck("ffmpeg", env.ffmpeg, ["-version"], te, null, bannerVersion)));
  emit(await safely("ffprobe", () => versionCheck("ffprobe", env.ffprobe, ["-version"], te, null, bannerVersion)));
  emit(await safely("binary architecture", () => architectureCheck(env)));
  emit(await safely("hyperframes", () => versionCheck("hyperframes", env.node, [env.hyperframes, "--version"], te, NPM_PACKAGES.hyperframes, firstLine, env.hyperframes)));
  emit(await safely("render browser", () => browserCheck(env)));
  emit(await safely("whisper", () => whisperCheck(env)));
  emit(await safely("whisper model", () => whisperModelCheck(env)));
  emit(diskCheck(home));
  if (full) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "synergy-doctor-"));
    try {
      asList(await safely("test renders", () => renderChecks(env, home, workDir))).forEach(emit);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
  asList(await safely("synctest", () => synctestChecks(home, log))).forEach(emit);
  const failed = results.filter((r) => r.status === "FAIL").length;
  return failed === 0 ? 0 : 2;
}

export async function main(argv) {
  const known = new Set(["--full"]);
  const unknown = argv.find((a) => !known.has(a));
  if (unknown) throw new Error(`doctor does not know "${unknown}". Usage: doctor [--full]`);
  return runDoctor({ full: argv.includes("--full") });
}

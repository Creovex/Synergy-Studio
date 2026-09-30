// One time setup of the tool home: runtimes, npm packages, Python venv, Kokoro model, ffmpeg and ffprobe, the
// render browser. Every step checks the real state first and says "already done" when there is nothing to do.
// Setup ends with doctor (which runs synctest when compose, render and synctest exist and the stored result
// is missing or out of date).
//
// Exports
//   USAGE, main(argv)          the command
//   PINS                       exact versions of everything setup installs
//   NODE_ARCHIVES, UV_ARCHIVES download tables per platform and architecture
//   NPM_PACKAGES               exact npm package versions
//   PY_REQUIREMENTS            the Python packages that requirements.lock is resolved from
//   MODELS                     the Kokoro files: name, url, size, sha256
//   WHISPER, CMAKE_VERSION     the whisper.cpp source pin (tag, tarball url, sha256) and the cmake pin
//   readWhisperInfo(home)      the build record of whisper-cli ({tag, sha256, cmake, metal}) or null
//   binaryArch(file)           {ok, detail}: whether an executable is built for this machine
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MIN_FREE_BYTES, freeDiskBytes, layout, machineArch, projectsHome, toolHome, isInside,
} from "./paths.mjs";
import { saveEnv, loadEnv, toolEnv } from "./env.mjs";
import { run, runHyperframes, runPython, download, sha256File } from "./run.mjs";
import { withHeavyLock } from "./lock.mjs";

export const USAGE = "setup  installs the tools (about 1 GB, once); run it again to repair";

const SCRIPTS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCK_FILE = path.join(SCRIPTS_DIR, "requirements.lock");

export const PINS = {
  node: "v22.23.3",
  uv: "0.12.21",
  python: "3.11",
};

const NODE_BASE = `https://nodejs.org/dist/${PINS.node}/`;
export const NODE_ARCHIVES = {
  "darwin-arm64": { file: `node-${PINS.node}-darwin-arm64.tar.gz`, sha256: "23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53" },
  "darwin-x64": { file: `node-${PINS.node}-darwin-x64.tar.gz`, sha256: "8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8" },
  "linux-arm64": { file: `node-${PINS.node}-linux-arm64.tar.xz`, sha256: "a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f" },
  "linux-x64": { file: `node-${PINS.node}-linux-x64.tar.xz`, sha256: "df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de" },
  "win32-x64": { file: `node-${PINS.node}-win-x64.zip`, sha256: "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71" },
};

const UV_BASE = `https://github.com/astral-sh/uv/releases/download/${PINS.uv}/`;
// strip is the number of leading folders inside the archive (the Windows archive has none).
export const UV_ARCHIVES = {
  "darwin-arm64": { file: "uv-aarch64-apple-darwin.tar.gz", strip: 1, sha256: "b88bda573e566ef9bced66b155fe0408626fbbc053aee1c30ba686f0728c9447" },
  "darwin-x64": { file: "uv-x86_64-apple-darwin.tar.gz", strip: 1, sha256: "2b336763b396ec6afa20c5a8b083538ca7402445b868311979d740a4344c17d8" },
  "linux-x64": { file: "uv-x86_64-unknown-linux-gnu.tar.gz", strip: 1, sha256: "23f02075b652bb1df64178cfae41b5caf160822e720e2663568f3f5d63bc52c0" },
  "linux-arm64": { file: "uv-aarch64-unknown-linux-gnu.tar.gz", strip: 1, sha256: "030b69227b40af8c1981b7301793dc66e71ed3c796ea8688209dd268bd91ec51" },
  "win32-x64": { file: "uv-x86_64-pc-windows-msvc.zip", strip: 0, sha256: "5d223efa0bf00208c3853246af09420419dfbd352536aa6bb8163d6170e23890" },
};

export const NPM_PACKAGES = {
  hyperframes: "0.8.92",
  gsap: "3.14.2",
  three: "0.186.1",
  "@ffprobe-installer/ffprobe": "2.1.2",
  "@fontsource/inter": "5.3.0",
  "@fontsource/manrope": "5.3.0",
  "@fontsource/cormorant-garamond": "5.3.0",
  "@fontsource/jost": "5.3.0",
};

export const PY_REQUIREMENTS = [
  "kokoro-onnx==0.6.1", "soundfile==0.14.0", "imageio-ffmpeg==0.6.0", "numpy", "pillow==12.3.0", "cmake==4.4.3",
];
// cmake comes from PyPI into the venv; it builds whisper.cpp with the system compiler.
export const CMAKE_VERSION = "4.4.3";

const WHISPER_TAG = "v1.9.4";
// whisper.cpp source, built into <home>/runtime/whisper. HyperFrames' transcribe runs the resulting whisper-cli.
export const WHISPER = {
  tag: WHISPER_TAG,
  file: `whisper.cpp-${WHISPER_TAG}.tar.gz`,
  url: `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_TAG}.tar.gz`,
  sha256: "57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae",
};

const MODEL_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/";
export const MODELS = [
  { name: "kokoro-v1.0.int8.onnx", key: "modelFile", url: `${MODEL_BASE}kokoro-v1.0.int8.onnx`, size: 92361271, sha256: "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb" },
  { name: "voices-v1.0.bin", key: "voicesFile", url: `${MODEL_BASE}voices-v1.0.bin`, size: 28214398, sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d" },
];

const say = (text) => console.log(text);
const GB = 1024 ** 3;
// No installer step may run longer than this; a hung child is stopped and setup can be run again.
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

function platformKey() {
  return `${process.platform}-${machineArch()}`;
}

function pickArchive(table, what) {
  const entry = table[platformKey()];
  if (!entry) throw new Error(`${what} has no download for ${platformKey()}; this computer is not supported yet.`);
  return entry;
}

// The environment object setup works with before env.json exists (same keys as env.json).
function baseEnv(home) {
  const L = layout(home);
  return {
    home, platform: platformKey(), arch: machineArch(), projects: projectsHome(),
    node: L.nodeBin, npm_cli: L.npmCli, uv: L.uvBin, python: L.python, node_modules: L.nodeModules,
    hyperframes: L.hyperframesMjs, hf_home: L.hfHome, bin: L.bin, ffmpeg: L.ffmpeg, ffprobe: L.ffprobe,
    kokoro_model: L.modelFile, kokoro_voices: L.voicesFile,
  };
}

function uvEnv(env, L) {
  return toolEnv(env, {
    UV_PYTHON_INSTALL_DIR: path.join(L.runtime, "python"),
    UV_PYTHON_BIN_DIR: path.join(L.runtime, "python-bin"),
    UV_CACHE_DIR: path.join(L.runtime, "uv-cache"),
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_PYTHON_DOWNLOADS: "automatic",
    UV_NO_CONFIG: "1",
  });
}

function systemTool(unixPath, windowsName) {
  if (process.platform !== "win32") return unixPath;
  return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", windowsName);
}

async function failIfBad(result, what) {
  if (result.code === 0) return result;
  const tail = `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-12).join("\n");
  throw new Error(`${what} failed (exit ${result.code}).\n${tail}`);
}

function progressPrinter(label) {
  let last = -1;
  return (received, total) => {
    if (!total) return;
    const step = Math.floor((received / total) * 5) * 20;
    if (step > last) {
      last = step;
      say(`   ${label}: ${step}% of ${(total / 1024 ** 2).toFixed(0)} MB`);
    }
  };
}

// ---------------------------------------------------------------- architecture

export async function binaryArch(file) {
  const want = machineArch();
  if (process.platform === "win32") {
    const fd = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(4096);
      fs.readSync(fd, head, 0, head.length, 0);
      const machine = head.readUInt16LE(head.readUInt32LE(0x3c) + 4);
      const found = machine === 0x8664 ? "x64" : machine === 0xaa64 ? "arm64" : `0x${machine.toString(16)}`;
      return { ok: found === want, detail: found };
    } finally {
      fs.closeSync(fd);
    }
  }
  const r = await run(systemTool("/usr/bin/file", "file.exe"), ["-b", file]);
  const text = r.stdout.trim();
  const has = { arm64: /arm64|aarch64/i.test(text), x64: /x86[-_]64/i.test(text) };
  const found = [has.arm64 && "arm64", has.x64 && "x64"].filter(Boolean).join(" and ") || text.slice(0, 60);
  return { ok: Boolean(has[want]), detail: found };
}

// ---------------------------------------------------------------- steps

async function commandLine(bin, args, env) {
  if (!fs.existsSync(bin)) return null;
  const r = await run(bin, args, { env, timeoutMs: 30000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

async function extractArchive(archive, target, strip) {
  const staging = `${target}.part`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const args = ["-xf", archive, "-C", staging];
  if (strip) args.push(`--strip-components=${strip}`);
  const env = { ...process.env, PATH: process.platform === "win32" ? process.env.PATH : "/usr/bin:/bin:/usr/sbin:/sbin" };
  await failIfBad(await run(systemTool("/usr/bin/tar", "tar.exe"), args, { env }), "Unpacking the archive");
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(staging, target);
}

async function fetchArchive(L, base, entry, target, strip) {
  const dest = path.join(L.tmp, "downloads", entry.file);
  await download(base + entry.file, dest, { sha256: entry.sha256, log: say, onProgress: progressPrinter(entry.file) });
  await extractArchive(dest, target, strip);
  fs.rmSync(dest, { force: true });
}

const stepNode = {
  name: `Node runtime ${PINS.node}`,
  async done({ L, env }) {
    return (await commandLine(L.nodeBin, ["--version"], env)) === PINS.node;
  },
  async run({ L, env }) {
    await fetchArchive(L, NODE_BASE, pickArchive(NODE_ARCHIVES, "Node"), L.nodeDir, 1);
    const got = await commandLine(L.nodeBin, ["--version"], env);
    if (got !== PINS.node) throw new Error(`The unpacked Node reports ${got}, expected ${PINS.node}. Run setup again.`);
  },
};

const stepUv = {
  name: `uv ${PINS.uv}`,
  async done({ L, env }) {
    return ((await commandLine(L.uvBin, ["--version"], env)) ?? "").split(" ")[1] === PINS.uv;
  },
  async run({ L, env }) {
    const entry = pickArchive(UV_ARCHIVES, "uv");
    await fetchArchive(L, UV_BASE, entry, L.uvDir, entry.strip);
    const got = await commandLine(L.uvBin, ["--version"], env);
    if ((got ?? "").split(" ")[1] !== PINS.uv) throw new Error(`The unpacked uv reports "${got}", expected ${PINS.uv}. Run setup again.`);
  },
};

function packageJson() {
  return { name: "synergy-studio-tools", version: "0.0.0", private: true, dependencies: { ...NPM_PACKAGES } };
}

function installedVersion(L, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(L.nodeModules, name, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

function telemetryOff(L) {
  try {
    const dir = path.join(L.hfHome, ".hyperframes");
    return fs.readdirSync(dir).some((f) => /"telemetryEnabled"\s*:\s*false/.test(fs.readFileSync(path.join(dir, f), "utf8").toString()));
  } catch {
    return false;
  }
}

const stepNpm = {
  name: "npm packages (HyperFrames, GSAP, three.js, ffprobe, fonts)",
  async done({ L }) {
    const same = Object.entries(NPM_PACKAGES).every(([name, version]) => installedVersion(L, name) === version);
    return same && fs.existsSync(L.hyperframesMjs) && telemetryOff(L);
  },
  async run({ L, env }) {
    fs.mkdirSync(L.nodeProject, { recursive: true });
    fs.writeFileSync(path.join(L.nodeProject, "package.json"), `${JSON.stringify(packageJson(), null, 2)}\n`);
    const npmEnv = toolEnv(env, {
      npm_config_cache: path.join(L.nodeProject, "npm-cache"),
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
    });
    const args = [L.npmCli, "install", "--no-audit", "--no-fund", "--loglevel=error"];
    await failIfBad(await run(L.nodeBin, args, { cwd: L.nodeProject, env: npmEnv, echo: true, timeoutMs: STEP_TIMEOUT_MS }), "npm install");
    for (const [name, version] of Object.entries(NPM_PACKAGES)) {
      const got = installedVersion(L, name);
      if (got !== version) throw new Error(`${name} came out as ${got}, expected ${version}. Run setup again.`);
    }
    fs.mkdirSync(L.hfHome, { recursive: true });
    await failIfBad(await runHyperframes(env, ["telemetry", "disable"], { cwd: L.nodeProject }), "hyperframes telemetry disable");
  },
};

function lockHash() {
  return fs.existsSync(LOCK_FILE) ? crypto.createHash("sha256").update(fs.readFileSync(LOCK_FILE)).digest("hex") : null;
}

// Whether requirements.lock holds every exactly pinned requirement (a newly added package means a fresh resolve).
function lockCovers() {
  if (!fs.existsSync(LOCK_FILE)) return false;
  const text = fs.readFileSync(LOCK_FILE, "utf8").toLowerCase();
  return PY_REQUIREMENTS.filter((r) => r.includes("==")).every((r) => text.includes(`${r.toLowerCase()}`));
}

const IMPORT_CHECK = "import sys, kokoro_onnx, soundfile, numpy, PIL, imageio_ffmpeg; print('%d.%d.%d' % sys.version_info[:3])";

async function pythonVersion(env) {
  if (!fs.existsSync(env.python)) return null;
  const r = await runPython(env, ["-c", IMPORT_CHECK], { timeoutMs: 120000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

const stampFile = (L) => path.join(L.venv, "requirements.lock.sha256");

async function resolveLock({ L, env }) {
  say("   resolving the Python packages into requirements.lock");
  const input = path.join(L.tmp, "requirements.in");
  fs.mkdirSync(L.tmp, { recursive: true });
  fs.writeFileSync(input, `${PY_REQUIREMENTS.join("\n")}\n`);
  const out = path.join(L.tmp, "requirements.lock.new");
  // uv keeps the versions already recorded in an existing output file, so relocking only adds what is new.
  if (fs.existsSync(LOCK_FILE)) fs.copyFileSync(LOCK_FILE, out);
  const args = ["pip", "compile", input, "--universal", "--python-version", PINS.python, "--generate-hashes", "--no-annotate", "--no-header", "--output-file", out];
  await failIfBad(await run(L.uvBin, args, { env: uvEnv(env, L) }), "Resolving the Python packages");
  const header = `# Resolved together by setup with uv ${PINS.uv} for Python ${PINS.python} from: ${PY_REQUIREMENTS.join(" ")}\n`;
  fs.writeFileSync(LOCK_FILE, header + fs.readFileSync(out, "utf8"));
  fs.rmSync(out, { force: true });
}

const stepVenv = {
  name: `Python ${PINS.python} venv and voice packages`,
  async done({ L, env, options }) {
    if (options.relock || !lockCovers()) return false;
    const version = await pythonVersion(env);
    const stamp = fs.existsSync(stampFile(L)) ? fs.readFileSync(stampFile(L), "utf8").trim() : null;
    const local = fs.existsSync(L.python) && isInside(L.python, L.home);
    return Boolean(local && version && version.startsWith(`${PINS.python}.`) && stamp && stamp === lockHash());
  },
  async run(ctx) {
    const { L, env, options } = ctx;
    if (options.relock || !lockCovers()) await resolveLock(ctx);
    const ue = uvEnv(env, L);
    say("   creating the Python environment (uv fetches its own Python)");
    const venvArgs = ["venv", "--python", PINS.python, "--python-preference", "only-managed", "--clear", L.venv];
    await failIfBad(await run(L.uvBin, venvArgs, { env: ue, echo: true, timeoutMs: STEP_TIMEOUT_MS }), "Creating the Python environment");
    const install = ["pip", "install", "--python", L.python, "--require-hashes", "-r", LOCK_FILE];
    await failIfBad(await run(L.uvBin, install, { env: ue, echo: true, timeoutMs: STEP_TIMEOUT_MS }), "Installing the Python packages");
    const version = await pythonVersion(env);
    if (!version) throw new Error("The Python packages do not import. Run setup again.");
    fs.writeFileSync(stampFile(L), `${lockHash()}\n`);
  },
};

async function modelOk(file, model) {
  if (!fs.existsSync(file) || fs.statSync(file).size !== model.size) return false;
  return !model.sha256 || (await sha256File(file)) === model.sha256;
}

const stepModels = {
  name: "Kokoro voice model files",
  async done({ L }) {
    const results = await Promise.all(MODELS.map((m) => modelOk(L[m.key], m)));
    return results.every(Boolean);
  },
  async run({ L }) {
    for (const model of MODELS) {
      say(`   ${model.name}`);
      const got = await download(model.url, L[model.key], {
        size: model.size, sha256: model.sha256 ?? undefined, log: say, onProgress: progressPrinter(model.name),
      });
      say(`   ${model.name} sha256 ${got.sha256}${model.sha256 ? "" : " (not pinned yet: record it in MODELS in setup.mjs)"}`);
    }
  },
};

async function prepareBinary(file) {
  if (process.platform === "win32") return;
  fs.chmodSync(file, 0o755);
  if (process.platform !== "darwin") return;
  const codesign = "/usr/bin/codesign";
  if ((await run(codesign, ["--verify", file])).code !== 0) {
    await failIfBad(await run(codesign, ["--force", "--sign", "-", file]), `Signing ${path.basename(file)}`);
  }
}

async function binaryWorks(file, args, env) {
  if (!fs.existsSync(file)) return false;
  const r = await run(file, args, { env, timeoutMs: 30000 });
  return r.code === 0 && (await binaryArch(file)).ok;
}

const stepBinaries = {
  name: "ffmpeg and ffprobe",
  async done({ L, env }) {
    return (await binaryWorks(L.ffmpeg, ["-version"], env)) && (await binaryWorks(L.ffprobe, ["-version"], env));
  },
  async run({ L, env }) {
    fs.mkdirSync(L.bin, { recursive: true });
    const py = await runPython(env, ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"]);
    await failIfBad(py, "Finding ffmpeg in the Python package");
    const node = await run(L.nodeBin, ["-p", "require('@ffprobe-installer/ffprobe').path"], { cwd: L.nodeProject, env });
    await failIfBad(node, "Finding ffprobe in the npm package");
    const sources = [[py.stdout.trim().split("\n").pop(), L.ffmpeg], [node.stdout.trim().split("\n").pop(), L.ffprobe]];
    for (const [from, to] of sources) {
      fs.rmSync(to, { force: true });
      fs.copyFileSync(from, to);
      await prepareBinary(to);
      const arch = await binaryArch(to);
      if (!arch.ok) throw new Error(`${path.basename(to)} is built for ${arch.detail}, this computer is ${machineArch()}. Run setup again; if it repeats, report it.`);
    }
    if (!(await stepBinaries.done({ L, env }))) throw new Error("ffmpeg or ffprobe does not start after copying. Run setup again.");
  },
};


// ---------------------------------------------------------------- whisper.cpp

export function readWhisperInfo(home) {
  try {
    return JSON.parse(fs.readFileSync(layout(home).whisperInfo, "utf8"));
  } catch {
    return null;
  }
}

// Returns null when a C and C++ compiler exists, else a plain reason. Never starts an installer.
async function compilerProblem() {
  if (process.platform === "win32") return "building whisper.cpp on Windows is not supported yet";
  if (process.platform === "darwin") {
    const r = await run("/usr/bin/xcode-select", ["-p"]);
    if (r.code !== 0) return "the Xcode Command Line Tools are not installed; run: xcode-select --install";
    return null;
  }
  const found = ["cc", "c++"].every((n) => ["/usr/bin", "/usr/local/bin"].some((d) => fs.existsSync(path.join(d, n))));
  return found ? null : "no C and C++ compiler was found; install one (for example the build-essential package)";
}

function buildEnv(env, L) {
  const base = toolEnv(env);
  const key = Object.keys(base).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const system = process.platform === "win32" ? [] : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const parts = [path.dirname(L.cmake), ...base[key].split(path.delimiter), ...system].filter(Boolean);
  return { ...base, [key]: [...new Set(parts)].join(path.delimiter) };
}

async function configureAndBuild(L, env, src, build, metal) {
  const cmakeEnv = buildEnv(env, L);
  const flags = [
    "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF", "-DWHISPER_BUILD_TESTS=OFF", "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_BUILD_EXAMPLES=ON", "-DGGML_METAL_EMBED_LIBRARY=ON", `-DGGML_METAL=${metal ? "ON" : "OFF"}`,
  ];
  fs.rmSync(build, { recursive: true, force: true });
  const configure = await run(L.cmake, ["-S", src, "-B", build, ...flags], { env: cmakeEnv, timeoutMs: STEP_TIMEOUT_MS });
  if (configure.code !== 0) return configure;
  const jobs = String(Math.max(2, (os.availableParallelism?.() ?? 4)));
  return run(L.cmake, ["--build", build, "--config", "Release", "--target", "whisper-cli", "-j", jobs], { env: cmakeEnv, timeoutMs: 30 * 60 * 1000 });
}

function builtBinary(build) {
  const name = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  return [path.join(build, "bin", name), path.join(build, "bin", "Release", name)].find((f) => fs.existsSync(f));
}

async function whisperRuns(file, env) {
  if (!fs.existsSync(file)) return false;
  const r = await run(file, ["--help"], { env: toolEnv(env), timeoutMs: 30000 });
  return r.code === 0 && (await binaryArch(file)).ok;
}

const stepWhisper = {
  name: `whisper.cpp ${WHISPER.tag} (speech to text program, built from source)`,
  async done({ L, env }) {
    const info = readWhisperInfo(L.home);
    if (!info || info.tag !== WHISPER.tag || !info.available) return false;
    return whisperRuns(L.whisperBin, env);
  },
  async run({ L, env, state }) {
    const problem = await compilerProblem();
    if (problem) {
      say(`   Transcription is unavailable until this is fixed: ${problem}. Setup continues without it.`);
      state.whisper = { available: false, reason: problem };
      return;
    }
    const dest = path.join(L.tmp, "downloads", WHISPER.file);
    const got = await download(WHISPER.url, dest, { sha256: WHISPER.sha256 ?? undefined, log: say, onProgress: progressPrinter(WHISPER.file) });
    say(`   ${WHISPER.file} sha256 ${got.sha256}${WHISPER.sha256 ? "" : " (not pinned yet: record it in WHISPER in setup.mjs)"}`);
    const src = path.join(L.tmp, "whisper-src");
    const build = path.join(L.tmp, "whisper-build");
    await extractArchive(dest, src, 1);
    say("   compiling (a few minutes; Metal is used when it builds)");
    const started = Date.now();
    const wantMetal = process.platform === "darwin" && machineArch() === "arm64";
    let metal = wantMetal;
    let result = await configureAndBuild(L, env, src, build, metal);
    if (result.code !== 0 && metal) {
      say("   the Metal build failed; building without it");
      metal = false;
      result = await configureAndBuild(L, env, src, build, metal);
    }
    await failIfBad(result, "Building whisper.cpp");
    const seconds = Math.round((Date.now() - started) / 1000);
    say(`   compiled in ${seconds} s`);
    const binary = builtBinary(build);
    if (!binary) throw new Error("The whisper.cpp build finished without whisper-cli. Run setup again.");
    fs.rmSync(L.whisperDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(L.whisperBin), { recursive: true });
    fs.copyFileSync(binary, L.whisperBin);
    if (process.platform !== "win32") fs.chmodSync(L.whisperBin, 0o755);
    await prepareBinary(L.whisperBin);
    if (!(await whisperRuns(L.whisperBin, env))) throw new Error("whisper-cli does not start after building. Run setup again.");
    fs.writeFileSync(L.whisperInfo, `${JSON.stringify({ available: true, tag: WHISPER.tag, sha256: got.sha256, cmake: CMAKE_VERSION, metal, build_seconds: seconds }, null, 2)}\n`);
    state.whisper = { available: true, path: L.whisperBin, tag: WHISPER.tag, metal };
  },
};

function chromeVersion(browserPath) {
  const match = /(\d+\.\d+\.\d+\.\d+)/.exec(browserPath);
  return match ? match[1] : null;
}

const stepBrowser = {
  name: "render browser for HyperFrames",
  async done({ L, previous }) {
    const p = previous?.browser?.path;
    return Boolean(p && fs.existsSync(p) && isInside(p, L.nodeProject));
  },
  async run({ L, env, state }) {
    say("   downloading the render browser (about 100 MB)");
    const ensure = await runHyperframes(env, ["browser", "ensure"], { cwd: L.nodeProject, timeoutMs: STEP_TIMEOUT_MS });
    await failIfBad(ensure, ensure.timedOut ? "hyperframes browser ensure (no result within 10 minutes)" : "hyperframes browser ensure");
    const r = await failIfBad(await runHyperframes(env, ["browser", "path"], { cwd: L.nodeProject }), "hyperframes browser path");
    const found = r.stdout.trim().split("\n").pop();
    if (!found || !isInside(found, L.nodeProject)) {
      throw new Error(`HyperFrames chose a browser outside the tool home (${found}). Run setup again.`);
    }
    state.browser = { path: found, version: chromeVersion(found) };
  },
};

function versionOf(text, pattern) {
  const m = pattern.exec(text ?? "");
  return m ? m[1] : null;
}

function whisperFromRecord(L, previous) {
  const info = readWhisperInfo(L.home);
  if (info?.available && fs.existsSync(L.whisperBin)) return { available: true, path: L.whisperBin, tag: info.tag, metal: info.metal };
  return previous?.whisper ?? null;
}

async function buildEnvJson(ctx) {
  const { L, env, previous, state } = ctx;
  const nodeV = await commandLine(L.nodeBin, ["--version"], env);
  const uvV = await commandLine(L.uvBin, ["--version"], env);
  const pyV = await pythonVersion(env);
  const next = {
    ...baseEnv(L.home),
    hyperframes_version: installedVersion(L, "hyperframes"),
    browser: state.browser ?? previous?.browser ?? null,
    whisper: state.whisper ?? whisperFromRecord(L, previous),
    node_version: nodeV, uv_version: versionOf(uvV, /uv (\S+)/), python_version: pyV,
  };
  return { ...next, ...(previous?.synctest ? { synctest: previous.synctest } : {}) };
}

const stepEnvJson = {
  name: "record the paths in env.json",
  async done(ctx) {
    if (!ctx.previous) return false;
    const next = await buildEnvJson(ctx);
    const strip = (o) => JSON.stringify({ ...o, installed_at: undefined });
    ctx.state.envJson = next;
    return strip(next) === strip(ctx.previous);
  },
  async run(ctx) {
    const next = ctx.state.envJson ?? (await buildEnvJson(ctx));
    saveEnv({ ...next, installed_at: new Date().toISOString() });
  },
};

const STEPS = [stepNode, stepUv, stepNpm, stepVenv, stepModels, stepBinaries, stepWhisper, stepBrowser, stepEnvJson];

// ---------------------------------------------------------------- command

function parseArgs(argv) {
  const options = { relock: false };
  for (const arg of argv) {
    if (arg === "--relock") options.relock = true;
    else throw new Error(`setup does not know "${arg}". Usage: setup [--relock]`);
  }
  return options;
}

function checkDisk(home) {
  const free = freeDiskBytes(home);
  if (free !== null && free < MIN_FREE_BYTES) {
    throw new Error(`Not enough free disk space: ${(free / GB).toFixed(1)} GB free, setup needs ${MIN_FREE_BYTES / GB} GB. Free some space and run setup again.`);
  }
}

async function runSteps(home, options) {
  const L = layout(home);
  fs.mkdirSync(L.tmp, { recursive: true });
  let previous = null;
  // A first run, or an env.json written for another home (a copied home), starts from nothing.
  try { previous = loadEnv(home); } catch { /* rewritten by the last step */ }
  const ctx = { L, env: baseEnv(home), previous, options, state: {} };
  for (const [index, step] of STEPS.entries()) {
    const label = `${index + 1}/${STEPS.length} ${step.name}`;
    if (await step.done(ctx)) {
      say(`${label}: already done`);
      continue;
    }
    say(`${label}: working`);
    await step.run(ctx);
    say(`${label}: done`);
  }
  fs.rmSync(L.tmp, { recursive: true, force: true });
}

export async function main(argv) {
  const options = parseArgs(argv);
  const home = toolHome();
  say(`Tool home: ${home}`);
  checkDisk(home);
  fs.mkdirSync(home, { recursive: true });
  return withHeavyLock(home, "setup", async () => {
    await runSteps(home, options);
    say("Checking the installation (doctor)");
    const doctor = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "doctor.mjs")).href);
    return doctor.runDoctor({ home, full: true });
  }, { log: say });
}

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
//   TINYSOUNDFONT_VERSION      the pinned tinysoundfont (it plays scores through a SoundFont)
//   SOUNDFONTS                 the General MIDI SoundFonts setup knows (id, file, url, size, sha256, licence)
//   SOUNDFONT_FIX              what to do when no SoundFont is installed
//   readFonts(home), writeFonts(home, reg), addFont(reg, id, entry), fontIdFor({sha256, fileName}), slugify(name), listedFonts(reg)
//   fontState(home, reg, id)   {ok, file, reason}: whether a listed font file exists and matches its sha256
//   installSoundfont(home, env, spec)  installs a known id or a .sf2/.sf3 file and records it in fonts.json
//   parseArgs(argv)            the setup options
//                              the soundfonts/fonts.json record: read, add (the first font becomes the default), name an id
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

export const USAGE = "setup [--whisper-model f] [--soundfont id|file]  installs the tools (about 1.5 GB, once); run it again to repair; --whisper-model copies a downloaded Whisper model file into place; --soundfont installs a General MIDI SoundFont (musescore-lite, fluidr3, or a .sf2/.sf3 file)";

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

export const TINYSOUNDFONT_VERSION = "0.3.7";
export const PY_REQUIREMENTS = [
  "kokoro-onnx==0.6.1", "soundfile==0.14.0", "imageio-ffmpeg==0.6.0", "numpy", "pillow==12.3.0", "cmake==4.4.3", `tinysoundfont==${TINYSOUNDFONT_VERSION}`,
];
// tinysoundfont declares pyaudio, which only live playback needs and which cannot be built without PortAudio. It is
// never installed: uv is given this file as --excludes both when resolving requirements.lock and when installing it.
const EXCLUDED_PACKAGES = ["pyaudio"];
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

// The Whisper model HyperFrames' transcribe loads from its cache under the tool home (small.en, English).
export const WHISPER_MODEL = {
  name: "ggml-small.en.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
  size: 487614201,
  sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
};
export const WHISPER_MODEL_FIX = `download ${WHISPER_MODEL.url} on any machine and run: setup --whisper-model <that file>. Without it, only transcribing speech is unavailable (import captions with a .srt file instead)`;

const MODEL_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/";
export const MODELS = [
  { name: "kokoro-v1.0.int8.onnx", key: "modelFile", url: `${MODEL_BASE}kokoro-v1.0.int8.onnx`, size: 92361271, sha256: "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb" },
  { name: "voices-v1.0.bin", key: "voicesFile", url: `${MODEL_BASE}voices-v1.0.bin`, size: 28214398, sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d" },
];

// The General MIDI SoundFonts. musescore-lite is the default setup downloads (the mirror has no file called
// MuseScore_General_Lite.sf3; the id keeps the name the music skill uses). fluidr3 is installed only on request, out of an
// archive. generaluser-gs is never downloaded by setup: it is installed from a file the user gives.
const SOUNDFONT_MIRROR = "https://ftp.osuosl.org/pub/musescore/soundfont/";
export const DEFAULT_SOUNDFONT = "musescore-lite";
export const SOUNDFONTS = {
  "musescore-lite": {
    file: "MuseScore_General.sf3", url: `${SOUNDFONT_MIRROR}MuseScore_General/MuseScore_General.sf3`,
    size: 39900972, sha256: "5b85b6c2c61d10b2b91cddd41efcce7b25cd31c8271d511c73afafbef20b6fa3", licence: "MIT",
  },
  fluidr3: {
    file: "FluidR3_GM2-2.sf2", size: 148345256, sha256: "2ae766ab5c5deb6f7fffacd6316ec9f3699998cce821df3163e7b10a78a64066", licence: "MIT",
    archive: {
      file: "fluid-soundfont.tar.gz", url: `${SOUNDFONT_MIRROR}fluid-soundfont.tar.gz`, size: 130294103,
      sha256: "c815769e44d86f1507b946a6c48c997c7f650699aea1ec4b11ba66e3415c26b9", member: "FluidR3 GM2-2.SF2",
    },
  },
  "generaluser-gs": { file: null, fromFileOnly: true },
};
export const SOUNDFONT_FIX = `run setup --soundfont ${DEFAULT_SOUNDFONT} (it downloads ${SOUNDFONTS[DEFAULT_SOUNDFONT].url}, about 40 MB), or download a General MIDI SoundFont (.sf2 or .sf3) on any machine and run: setup --soundfont <that file>. Without it, a score file cannot be played`;

const say = (text) => console.log(text);
const GB = 1024 ** 3;
const SOUNDFONT_EXTENSIONS = /\.sf[23]$/i;
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

const tarEnv = () => ({ ...process.env, PATH: process.platform === "win32" ? process.env.PATH : "/usr/bin:/bin:/usr/sbin:/sbin" });

async function extractArchive(archive, target, strip) {
  const staging = `${target}.part`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const args = ["-xf", archive, "-C", staging];
  if (strip) args.push(`--strip-components=${strip}`);
  await failIfBad(await run(systemTool("/usr/bin/tar", "tar.exe"), args, { env: tarEnv() }), "Unpacking the archive");
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

const IMPORT_CHECK = "import sys, kokoro_onnx, soundfile, numpy, PIL, imageio_ffmpeg, tinysoundfont; print('%d.%d.%d' % sys.version_info[:3])";

async function pythonVersion(env) {
  if (!fs.existsSync(env.python)) return null;
  const r = await runPython(env, ["-c", IMPORT_CHECK], { timeoutMs: 120000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

const stampFile = (L) => path.join(L.venv, "requirements.lock.sha256");

// The requirements file that uv's --excludes reads: packages that must not be resolved or installed. uv splits the
// value of --excludes at spaces, so uv runs with L.tmp as its working folder and gets the bare file name.
const EXCLUDES_FILE = "excludes.txt";
function writeExcludes(L) {
  fs.mkdirSync(L.tmp, { recursive: true });
  fs.writeFileSync(path.join(L.tmp, EXCLUDES_FILE), `${EXCLUDED_PACKAGES.join("\n")}\n`);
  return EXCLUDES_FILE;
}

async function resolveLock({ L, env }) {
  say("   resolving the Python packages into requirements.lock");
  const input = path.join(L.tmp, "requirements.in");
  fs.mkdirSync(L.tmp, { recursive: true });
  fs.writeFileSync(input, `${PY_REQUIREMENTS.join("\n")}\n`);
  const out = path.join(L.tmp, "requirements.lock.new");
  // uv keeps the versions already recorded in an existing output file, so relocking only adds what is new.
  if (fs.existsSync(LOCK_FILE)) fs.copyFileSync(LOCK_FILE, out);
  const args = ["pip", "compile", input, "--universal", "--python-version", PINS.python, "--generate-hashes", "--no-annotate", "--no-header", "--excludes", writeExcludes(L), "--output-file", out];
  await failIfBad(await run(L.uvBin, args, { env: uvEnv(env, L), cwd: L.tmp }), "Resolving the Python packages");
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
    const install = ["pip", "install", "--python", L.python, "--require-hashes", "--excludes", writeExcludes(L), "-r", LOCK_FILE];
    await failIfBad(await run(L.uvBin, install, { env: ue, cwd: L.tmp, echo: true, timeoutMs: STEP_TIMEOUT_MS }), "Installing the Python packages");
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

// ---------------------------------------------------------------- SoundFonts

// soundfonts/fonts.json: {"default": id, "fonts": {id: {"file", "sha256", "source"}}}. instruments.py reads it too.
export function readFonts(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(layout(home).fontsJson, "utf8"));
    const fonts = raw && typeof raw.fonts === "object" && raw.fonts !== null && !Array.isArray(raw.fonts) ? raw.fonts : {};
    return { default: typeof raw?.default === "string" ? raw.default : null, fonts };
  } catch {
    return { default: null, fonts: {} };
  }
}

// A new record with the font added. The default stays when it names a listed font; the first font becomes the default.
export function addFont(reg, id, entry, { asDefault = false } = {}) {
  const fonts = { ...reg.fonts, [id]: entry };
  const keep = !asDefault && reg.default !== null && Object.hasOwn(reg.fonts, reg.default);
  return { default: keep ? reg.default : id, fonts };
}

export function writeFonts(home, reg) {
  const L = layout(home);
  fs.mkdirSync(L.soundfonts, { recursive: true });
  const part = `${L.fontsJson}.part`;
  fs.writeFileSync(part, `${JSON.stringify({ default: reg.default, fonts: reg.fonts }, null, 2)}\n`);
  fs.renameSync(part, L.fontsJson);
}

export function listedFonts(reg) {
  return Object.keys(reg.fonts).map((id) => (id === reg.default ? `${id} (default)` : id)).join(", ") || "none";
}

// A slug of a file name: lower case letters, digits and hyphens.
export function slugify(fileName) {
  const slug = String(fileName).replace(/\.sf[23]$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "soundfont";
}

// The id of a font file: the known id whose sha256 matches, else generaluser-gs for a GeneralUser file, else a slug of its name.
export function fontIdFor({ sha256, fileName }) {
  const known = Object.entries(SOUNDFONTS).find(([, font]) => font.sha256 && font.sha256 === sha256);
  if (known) return known[0];
  if (/generaluser/i.test(fileName)) return "generaluser-gs";
  const slug = slugify(fileName);
  return SOUNDFONTS[slug] ? `${slug}-file` : slug;     // a different file named like a downloadable font never takes its id
}

// Whether the font `id` listed in fonts.json is usable: its file exists with the right size (known ids) and the sha256
// that fonts.json records (for a known id also the pinned one). Reads the whole file once, never loads it as a SoundFont.
export async function fontState(home, reg, id) {
  const entry = reg.fonts[id];
  if (!entry || typeof entry.file !== "string") return { ok: false, reason: `fonts.json has no file for ${id}` };
  const file = path.join(layout(home).soundfonts, entry.file);
  if (!fs.existsSync(file)) return { ok: false, file, reason: `${entry.file} is missing from ${path.dirname(file)}` };
  const known = SOUNDFONTS[id];
  if (known?.size && fs.statSync(file).size !== known.size) return { ok: false, file, reason: `${entry.file} has the wrong size` };
  const sha256 = await sha256File(file);
  if (sha256 !== entry.sha256 || (known?.sha256 && sha256 !== known.sha256)) {
    return { ok: false, file, sha256, reason: `${entry.file} sha256 differs from fonts.json` };
  }
  return { ok: true, file, sha256 };
}

const isDownloadable = (id) => Object.hasOwn(SOUNDFONTS, id) && !SOUNDFONTS[id].fromFileOnly;

// Downloads a known font into soundfonts/ (the archive for fluidr3: only its one member is unpacked and checked).
async function downloadFont(L, id) {
  const font = SOUNDFONTS[id];
  const dest = path.join(L.soundfonts, font.file);
  fs.mkdirSync(L.soundfonts, { recursive: true });
  if (!font.archive) {
    await download(font.url, dest, { size: font.size, sha256: font.sha256, log: say, onProgress: progressPrinter(font.file) });
    return { file: font.file, sha256: font.sha256, source: font.url };
  }
  const source = font.archive.url;
  if (await modelOk(dest, font)) return { file: font.file, sha256: font.sha256, source };
  const work = path.join(L.tmp, "soundfont");
  try {
    const archive = path.join(work, font.archive.file);
    await download(source, archive, { size: font.archive.size, sha256: font.archive.sha256, log: say, onProgress: progressPrinter(font.archive.file) });
    const staging = path.join(work, "unpacked");
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const args = ["-xf", archive, "-C", staging, font.archive.member];
    await failIfBad(await run(systemTool("/usr/bin/tar", "tar.exe"), args, { env: tarEnv() }), `Unpacking ${font.archive.member}`);
    const member = path.join(staging, font.archive.member);
    if (!(await modelOk(member, font))) throw new Error(`${font.archive.member} from the archive has the wrong size or checksum; run setup --soundfont ${id} again`);
    fs.copyFileSync(member, `${dest}.part`);
    if (process.platform !== "win32") fs.chmodSync(`${dest}.part`, 0o644);
    fs.renameSync(`${dest}.part`, dest);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return { file: font.file, sha256: font.sha256, source };
}

// Asks the venv Python whether tinysoundfont loads the file. Throws the ERROR line of instruments.py when it does not.
async function checkFontFile(env, file) {
  if (!fs.existsSync(env.python)) throw new Error(`the Python environment is missing (${env.python}); run setup first`);
  const r = await runPython(env, [path.join(SCRIPTS_DIR, "instruments.py"), "check", file], { timeoutMs: 120000 });
  if (r.code === 0) return r.stdout.trim().split("\n").pop();
  const text = `${r.stderr}\n${r.stdout}`.trim().split("\n").filter(Boolean);
  const line = (text.reverse().find((l) => l.startsWith("ERROR")) ?? text[0] ?? `instruments.py exited with ${r.code}`).replace(/^ERROR: /, "");
  const repair = /No module named/.test(line) ? ". Run setup (without --soundfont) to repair the Python packages first" : "";
  throw new Error(`${line}${repair}. ${path.basename(file)} was not copied`);
}

// A SoundFont file the user gives: it must load (instruments.py check) and be named .sf2 or .sf3. Nothing is copied here.
async function inspectFontFile(env, source) {
  const file = path.resolve(source);
  const fileName = path.basename(file);
  const found = await checkFontFile(env, file);
  if (!SOUNDFONT_EXTENSIONS.test(fileName)) throw new Error(`${fileName} loads but is not named .sf2 or .sf3; rename it, then run setup --soundfont again`);
  return { file, fileName, found, sha256: await sha256File(file) };
}

// Copies it into soundfonts/ through a .part file, never overwriting a different file of that name.
async function placeFontFile(L, font) {
  const dest = path.join(L.soundfonts, font.fileName);
  fs.mkdirSync(L.soundfonts, { recursive: true });
  if (fs.existsSync(dest)) {
    if ((await sha256File(dest)) !== font.sha256) throw new Error(`${dest} already exists and is a different file; rename your file or remove that one first`);
    return;
  }
  fs.copyFileSync(font.file, `${dest}.part`);
  fs.renameSync(`${dest}.part`, dest);
}

// Installs a SoundFont (a known id, or a .sf2/.sf3 file) and records it in fonts.json. Resolves to {id, entry, reg}.
export async function installSoundfont(home, env, spec, { asDefault = false } = {}) {
  const L = layout(home);
  const before = readFonts(home);
  let id = spec;
  let entry;
  if (isDownloadable(spec)) {
    entry = await downloadFont(L, spec);
  } else if (fs.existsSync(spec) && fs.statSync(spec).isFile()) {
    const font = await inspectFontFile(env, spec);
    id = fontIdFor({ sha256: font.sha256, fileName: font.fileName });
    const listed = before.fonts[id];
    if (listed && listed.sha256 !== font.sha256 && listed.file !== font.fileName) {
      throw new Error(`the id ${id} already names ${listed.file}; ${font.fileName} was not copied. Rename it to give it another id`);
    }
    const sameAsListed = listed && listed.sha256 === font.sha256 && fs.existsSync(path.join(L.soundfonts, listed.file));
    if (!sameAsListed) await placeFontFile(L, font);
    say(`   ${font.fileName} loads (${font.found})`);
    entry = sameAsListed ? listed : { file: font.fileName, sha256: font.sha256, source: font.file };
  } else if (Object.hasOwn(SOUNDFONTS, spec)) {
    throw new Error(`${spec} is not downloaded by setup; give the file: setup --soundfont <the .sf2 or .sf3 file>`);
  } else {
    throw new Error(`"${spec}" is not a SoundFont id (${Object.keys(SOUNDFONTS).join(", ")}) and not a file. Usage: setup --soundfont <id|file>`);
  }
  const reg = addFont(before, id, { file: entry.file, sha256: entry.sha256, source: entry.source }, { asDefault });
  writeFonts(home, reg);
  return { id, entry, reg };
}

// Not fatal: only playing a score needs a font, so a failure prints a WARN and setup goes on.
const stepSoundfont = {
  name: "SoundFont (General MIDI instruments for scores)",
  async done({ L, options }) {
    const reg = readFonts(L.home);
    if (!reg.default || (options.soundfont && !Object.hasOwn(reg.fonts, options.soundfont))) return false;
    return (await fontState(L.home, reg, reg.default)).ok;
  },
  async run({ L, env, options }) {
    const reg = readFonts(L.home);
    const unusable = reg.default !== null && !(await fontState(L.home, reg, reg.default)).ok;
    const spec = options.soundfont ?? (unusable && isDownloadable(reg.default) ? reg.default : DEFAULT_SOUNDFONT);
    try {
      const got = await installSoundfont(L.home, env, spec, { asDefault: !options.soundfont && unusable && spec !== reg.default });
      say(`   ${got.id}: ${got.entry.file} installed (sha256 ${got.entry.sha256.slice(0, 12)})`);
    } catch (error) {
      if (options.soundfont) throw error;
      say(`   WARN the SoundFont is not installed (${error.message}). Fix: ${SOUNDFONT_FIX}. Setup continues.`);
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

// Copies a model file downloaded elsewhere into the cache after checking its size and SHA-256.
export async function installWhisperModel(file, dest) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Whisper model file not found: ${file}`);
  if (fs.statSync(file).size !== WHISPER_MODEL.size || (await sha256File(file)) !== WHISPER_MODEL.sha256) {
    throw new Error(`${file} is not ${WHISPER_MODEL.name} (wrong size or checksum); download ${WHISPER_MODEL.url} again`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  fs.copyFileSync(file, part);
  fs.renameSync(part, dest);
}

// Not fatal: only transcribing speech needs the model, so a failure prints a WARN and setup goes on.
const stepWhisperModel = {
  name: `Whisper model ${WHISPER_MODEL.name} (for transcribing speech)`,
  async done({ L }) {
    return modelOk(L.whisperModel, WHISPER_MODEL);
  },
  async run({ L, options }) {
    try {
      if (options.whisperModel) {
        await installWhisperModel(options.whisperModel, L.whisperModel);
        return;
      }
      await download(WHISPER_MODEL.url, L.whisperModel, {
        size: WHISPER_MODEL.size, sha256: WHISPER_MODEL.sha256, log: say, onProgress: progressPrinter(WHISPER_MODEL.name),
      });
    } catch (error) {
      say(`   WARN the Whisper model is not installed (${error.message}). Fix: ${WHISPER_MODEL_FIX}. Setup continues.`);
    }
  },
};

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

const STEPS = [stepNode, stepUv, stepNpm, stepVenv, stepModels, stepSoundfont, stepBinaries, stepWhisper, stepWhisperModel, stepBrowser, stepEnvJson];

// ---------------------------------------------------------------- command

export function parseArgs(argv) {
  const options = { relock: false, whisperModel: null, soundfont: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--relock") options.relock = true;
    else if (arg === "--whisper-model") {
      options.whisperModel = argv[++i] ?? null;
      if (!options.whisperModel || options.whisperModel.startsWith("--")) throw new Error("--whisper-model needs the model file. Usage: setup [--whisper-model <file>]");
    } else if (arg === "--soundfont") {
      options.soundfont = argv[++i] ?? null;
      if (!options.soundfont || options.soundfont.startsWith("--")) throw new Error("--soundfont needs a SoundFont id or file. Usage: setup [--soundfont <musescore-lite|fluidr3|file.sf2|file.sf3>]");
    } else throw new Error(`setup does not know "${arg}". Usage: setup [--relock] [--whisper-model <file>] [--soundfont <id|file>]`);
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

function isSetUp(home) {
  try { loadEnv(home); return true; } catch { return false; }
}

export async function main(argv) {
  const options = parseArgs(argv);
  const home = toolHome();
  say(`Tool home: ${home}`);
  if ((options.whisperModel || options.soundfont) && isSetUp(home)) {
    if (options.whisperModel) {
      await installWhisperModel(options.whisperModel, layout(home).whisperModel);
      say(`Whisper model installed: ${layout(home).whisperModel}`);
    }
    if (options.soundfont) {
      const got = await installSoundfont(home, loadEnv(home), options.soundfont);
      say(`SoundFont installed: ${got.id} (${path.join(layout(home).soundfonts, got.entry.file)}, sha256 ${got.entry.sha256})`);
      say(`Fonts now listed: ${listedFonts(got.reg)}`);
    }
    return 0;
  }
  checkDisk(home);
  fs.mkdirSync(home, { recursive: true });
  return withHeavyLock(home, "setup", async () => {
    await runSteps(home, options);
    say("Checking the installation (doctor)");
    const doctor = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "doctor.mjs")).href);
    return doctor.runDoctor({ home, full: true });
  }, { log: say });
}

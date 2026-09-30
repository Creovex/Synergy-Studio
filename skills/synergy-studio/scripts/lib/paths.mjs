// Paths for the tool home and the projects home. Node built ins only.
//
// Exports
//   platformName()            "darwin" | "win32" | "linux" (process.platform)
//   machineArch()             "arm64" | "x64": the real machine, even for an emulated Node on Apple Silicon
//   exeName(name)             adds ".exe" on Windows: exeName("uv") -> "uv.exe" or "uv"
//   toolHome(envVars?)        the tool home (SYNERGY_STUDIO_HOME when set and non empty, else the system default)
//   projectsHome(envVars?)    the projects home (SYNERGY_STUDIO_PROJECTS when set, else the system default)
//   layout(home)              every absolute path inside a tool home, as one object (see below)
//   venvPython(home)          the venv's Python executable
//   nearestExisting(p)        the closest existing ancestor of p (used for the free disk check)
//   freeDiskBytes(p)          free bytes on the volume holding p, or null when the platform cannot say
//   realPathOrSelf(p)        realpath of p, or the resolved p when it does not exist
//   isInside(file, dir)       whether file is inside dir once symbolic links are followed
//   MIN_FREE_BYTES            10 GB, the free disk needed before setup
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const MIN_FREE_BYTES = 10 * 1024 ** 3;

export function platformName() {
  return process.platform;
}

export function machineArch() {
  if (process.platform === "darwin" && process.arch === "x64") {
    const r = spawnSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], { encoding: "utf8", shell: false });
    if (r.status === 0 && r.stdout.trim() === "1") return "arm64";
  }
  return process.arch === "arm64" ? "arm64" : "x64";
}

export function exeName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function toolHome(envVars = process.env) {
  const override = nonEmpty(envVars.SYNERGY_STUDIO_HOME);
  if (override) return path.resolve(override);
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "SynergyStudioLite");
  if (process.platform === "win32") {
    const local = nonEmpty(envVars.LOCALAPPDATA) ?? path.join(home, "AppData", "Local");
    return path.join(local, "SynergyStudioLite");
  }
  const data = nonEmpty(envVars.XDG_DATA_HOME) ?? path.join(home, ".local", "share");
  return path.join(data, "synergy-studio-lite");
}

export function projectsHome(envVars = process.env) {
  const override = nonEmpty(envVars.SYNERGY_STUDIO_PROJECTS);
  if (override) return path.resolve(override);
  const folder = process.platform === "darwin" ? "Movies" : "Videos";
  return path.join(os.homedir(), folder, "Synergy Studio");
}

export function venvPython(home) {
  return process.platform === "win32"
    ? path.join(home, "venv", "Scripts", "python.exe")
    : path.join(home, "venv", "bin", "python");
}

// Every absolute path inside a tool home. Keys:
//   home, runtime, nodeDir, nodeBin, npmCli, uvDir, uvBin, nodeProject (the npm project folder),
//   nodeModules, hyperframesMjs, hfHome (the folder HyperFrames sees as its home: its browser, config and
//   model caches live there), venv, python, models, modelFile, voicesFile, bin, ffmpeg, ffprobe,
//   cmake (in the venv), whisperDir, whisperBin (whisper-cli), whisperInfo (build record), envJson, jobs, locks, heavyLock, serverLog, tmp
export function layout(home) {
  const win = process.platform === "win32";
  const nodeDir = path.join(home, "runtime", "node");
  const uvDir = path.join(home, "runtime", "uv");
  const nodeProject = path.join(home, "node");
  const models = path.join(home, "models");
  const bin = path.join(home, "bin");
  return {
    home,
    runtime: path.join(home, "runtime"),
    nodeDir,
    nodeBin: win ? path.join(nodeDir, "node.exe") : path.join(nodeDir, "bin", "node"),
    npmCli: win
      ? path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")
      : path.join(nodeDir, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    uvDir,
    uvBin: path.join(uvDir, exeName("uv")),
    nodeProject,
    nodeModules: path.join(nodeProject, "node_modules"),
    hyperframesMjs: path.join(nodeProject, "node_modules", "hyperframes", "bin", "hyperframes.mjs"),
    hfHome: path.join(nodeProject, "hf-home"),
    venv: path.join(home, "venv"),
    python: venvPython(home),
    models,
    modelFile: path.join(models, "kokoro-v1.0.int8.onnx"),
    voicesFile: path.join(models, "voices-v1.0.bin"),
    bin,
    ffmpeg: path.join(bin, exeName("ffmpeg")),
    ffprobe: path.join(bin, exeName("ffprobe")),
    cmake: win ? path.join(home, "venv", "Scripts", "cmake.exe") : path.join(home, "venv", "bin", "cmake"),
    whisperDir: path.join(home, "runtime", "whisper"),
    whisperBin: path.join(home, "runtime", "whisper", "bin", exeName("whisper-cli")),
    whisperInfo: path.join(home, "runtime", "whisper", "build-info.json"),
    envJson: path.join(home, "env.json"),
    jobs: path.join(home, "jobs"),
    locks: path.join(home, "locks"),
    heavyLock: path.join(home, "locks", "heavy.lock"),
    serverLog: path.join(home, "server.log"),
    tmp: path.join(home, "tmp"),
  };
}

export function realPathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function isInside(file, dir) {
  const rel = path.relative(realPathOrSelf(dir), realPathOrSelf(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function nearestExisting(p) {
  let current = path.resolve(p);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function freeDiskBytes(p) {
  try {
    const s = fs.statfsSync(nearestExisting(p));
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

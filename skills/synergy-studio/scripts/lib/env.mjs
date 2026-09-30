// Reading and writing <home>/env.json, and the environment every child process runs with.
//
// env.json keys (all paths absolute):
//   home, platform, arch, installed_at, projects,
//   node (runtime node binary), npm_cli, uv, python (venv python), node_modules, hyperframes,
//   hf_home (the home folder HyperFrames sees; its browser, config and model caches live in it),
//   bin, ffmpeg, ffprobe, kokoro_model, kokoro_voices,
//   hyperframes_version, browser: { path, version },
//   node_version, uv_version, python_version,
//   whisper: { available: true, path, tag, metal } for whisper.cpp's whisper-cli, or { available: false, reason }
//   when no compiler was found (transcription is then unavailable; callers check this before transcribing),
//   synctest: written by synctest through updateEnv(); it must contain hyperframes_version and browser_version
//   so that doctor can tell when the result is out of date. Setup keeps it when it rewrites env.json.
//
// Exports
//   envFile(home?)                  path of env.json
//   loadEnv(home?)                  parsed env.json; throws "not set up yet: run setup" when missing or unreadable,
//                                   and an error with code FOREIGN_HOME when env.json was written for another
//                                   home (a copied or moved home): its absolute paths cannot be trusted
//   saveEnv(env)                    writes env.json atomically (env.home says where)
//   updateEnv(patch, home?)         loads, merges the patch (shallow), saves, returns the result
//   toolEnv(env, extra?)            process environment for every child: PATH starts with the home bin and the
//                                   runtime node folder, HyperFrames variables, HyperFrames home and browser
//   hyperframesArgs(env, args)      arguments to give the runtime node to run HyperFrames: [hyperframes.mjs, ...args]
import fs from "node:fs";
import path from "node:path";
import { toolHome, realPathOrSelf } from "./paths.mjs";

export function envFile(home = toolHome()) {
  return path.join(home, "env.json");
}

export function loadEnv(home = toolHome()) {
  const file = envFile(home);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error("not set up yet: run setup");
  }
  try {
    const env = JSON.parse(text);
    if (!env || typeof env !== "object" || !env.node) throw new Error("incomplete");
    if (!env.home || realPathOrSelf(env.home) !== realPathOrSelf(home)) {
      const error = new Error(`env.json belongs to another home (${env.home}): run setup`);
      error.code = "FOREIGN_HOME";
      error.otherHome = env.home;
      throw error;
    }
    return env;
  } catch (error) {
    if (error.code === "FOREIGN_HOME") throw error;
    throw new Error("not set up yet: run setup (env.json is unreadable)");
  }
}

export function saveEnv(env) {
  const file = envFile(env.home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.${process.pid}.part`;
  fs.writeFileSync(part, `${JSON.stringify(env, null, 2)}\n`);
  fs.renameSync(part, file);
}

export function updateEnv(patch, home = toolHome()) {
  const merged = { ...loadEnv(home), ...patch };
  saveEnv(merged);
  return merged;
}

function pathKey(vars) {
  return Object.keys(vars).find((k) => k.toLowerCase() === "path") ?? "PATH";
}

export function toolEnv(env, extra = {}) {
  const vars = { ...process.env };
  const key = pathKey(vars);
  const front = [env.bin, path.dirname(env.node)];
  const rest = (vars[key] ?? "").split(path.delimiter).filter(Boolean);
  vars[key] = [...front, ...rest.filter((p) => !front.includes(p))].join(path.delimiter);
  vars.HYPERFRAMES_SKIP_SKILLS = "1";
  vars.HYPERFRAMES_NO_TELEMETRY = "1";
  // The pinned HyperFrames is never upgraded, so it must not check for or install a newer one.
  vars.HYPERFRAMES_NO_UPDATE_CHECK = "1";
  vars.HYPERFRAMES_NO_AUTO_INSTALL = "1";
  vars.HYPERFRAMES_FFMPEG_PATH = env.ffmpeg;
  vars.HYPERFRAMES_FFPROBE_PATH = env.ffprobe;
  // HyperFrames keeps its browser, config and caches under the operating system home folder, and offers no
  // setting for that. Giving every HyperFrames call the same home under the tool home keeps them all there.
  vars.HOME = env.hf_home;
  vars.USERPROFILE = env.hf_home;
  vars.HYPERFRAMES_FONT_CACHE_DIR = path.join(env.hf_home, ".cache", "hyperframes", "fonts");
  // Always set: HyperFrames must never search for whisper-cli or try to install it (it would run brew or git).
  vars.HYPERFRAMES_WHISPER_PATH = env.whisper?.path ?? path.join(env.home ?? env.hf_home, "runtime", "whisper", "bin", "whisper-cli");
  if (env.browser?.path && fs.existsSync(env.browser.path)) vars.HYPERFRAMES_BROWSER_PATH = env.browser.path;
  else delete vars.HYPERFRAMES_BROWSER_PATH;
  delete vars.PRODUCER_HEADLESS_SHELL_PATH;
  delete vars.PYTHONHOME;
  delete vars.PYTHONPATH;
  return { ...vars, ...extra };
}

export function hyperframesArgs(env, args) {
  return [env.hyperframes, ...args];
}

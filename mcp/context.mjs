// Shared facts for the MCP server: where the skill, the tool home and the projects home are, the installed
// environment, the log, and the error type that becomes a plain text tool failure.
// Node built ins only. Everything that needs the tool home reads it through these functions at call time,
// so a server started before setup notices a setup that finishes later.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toolHome, projectsHome, layout } from "../skills/synergy-studio/scripts/lib/paths.mjs";
import { loadEnv, toolEnv } from "../skills/synergy-studio/scripts/lib/env.mjs";

export const SERVER_NAME = "synergy-studio";
export const SERVER_VERSION = "0.4.0";
export const INSTRUCTIONS = [
  "Synergy Studio makes and improves short videos on this computer: narrated explainers and ads, talking head reels with word captions, photo or product ads cut to music, wordless animated stories and films, light 3D.",
  "Call studio_guide first in every conversation and follow it; it lists the references (studio_reference) and the examples (studio_example).",
  "Order of work: studio_doctor (studio_setup_start if it is not set up); plan with the user; studio_project_new, or studio_project_import for an existing video; write project.json and src/index.html with studio_file_write;",
  "sound (studio_voice, studio_audio; for footage studio_cut, studio_transcribe); studio_stills and look at them; studio_render; studio_check; studio_open to give the user the MP4.",
  "Long tools return a job_id: call studio_job_status with wait_sec 25 until it is done.",
].join("\n");
export const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const MCP_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(MCP_DIR, "..", "skills", "synergy-studio");
export const STUDIO_MJS = path.join(SKILL_DIR, "scripts", "studio.mjs");
export const JOB_RUNNER = path.join(MCP_DIR, "jobrunner.mjs");

// A failure the model can act on: the message is returned as plain text with isError set.
export class UserError extends Error {}

export const home = () => toolHome();
export const projectsRoot = () => projectsHome();
export const paths = () => layout(home());

// The installed environment, or null before setup.
export function tryEnv() {
  try {
    return loadEnv(home());
  } catch {
    return null;
  }
}

export const notSetUpText = () =>
  `Synergy Studio is not set up on this computer yet (no env.json in ${home()}). Call studio_setup_start once: it installs ` +
  "the render engine, the voice and ffmpeg (about 1 GB, 5 to 10 minutes), then follow it with studio_job_status until it is done.";

// The environment for a HyperFrames child process (the same one the CLI uses).
export const hyperframesEnv = (env) => toolEnv(env);

// Claude Desktop runs this server inside its own app (an Electron utility process). There process.execPath is the Claude
// app, which cannot run a script (its Node mode is switched off), so a job started with it never runs: every job tool then
// failed after the runner's 15 s start grace. Children therefore always run on a real Node.
export const IN_ELECTRON = Boolean(process.versions.electron);
const NODE_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.join(os.homedir(), ".volta", "bin")];
function systemNode() {
  const name = process.platform === "win32" ? "node.exe" : "node";
  const dirs = [...String(process.env.PATH ?? "").split(path.delimiter).filter(Boolean), ...NODE_DIRS];
  return dirs.map((d) => path.join(d, name)).find((f) => fs.existsSync(f)) ?? null;
}

// The Node that runs studio.mjs and the job runner: the installed runtime when there is one; else the Node running this
// server; inside Claude Desktop before setup, a Node found on this computer. Throws a plain error when there is none.
export function studioNode(env) {
  if (env?.node && fs.existsSync(env.node)) return env.node;
  if (!IN_ELECTRON) return process.execPath;
  const found = systemNode();
  if (found) return found;
  throw new UserError("Synergy Studio needs Node.js once for its first setup, and none was found on this computer. Ask the user to install Node.js from nodejs.org, then call studio_setup_start again.");
}

export function expandHome(p) {
  if (typeof p !== "string") return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

let logDirReady = false;
// every line names the server process and its client, so a Desktop chat, a Cowork task, a headless build and a test
// run that share this log can be told apart
let logClient = "";
export const setLogClient = (name) => { logClient = String(name ?? "").replace(/\s+/g, "-").slice(0, 60); };
export function log(...parts) {
  const line = `${new Date().toISOString()} [${process.pid}${logClient ? ` ${logClient}` : ""}] ${parts.join(" ")}\n`;
  try {
    process.stderr.write(line);
  } catch {
    // stderr can be closed when the client is gone
  }
  try {
    if (!logDirReady) {
      fs.mkdirSync(home(), { recursive: true });
      logDirReady = true;
    }
    fs.appendFileSync(paths().serverLog, line);
  } catch {
    // the log file is a courtesy
  }
}

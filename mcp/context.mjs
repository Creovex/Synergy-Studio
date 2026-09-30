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
export const SERVER_VERSION = "0.1.0";
export const INSTRUCTIONS = "Synergy Studio makes and improves videos. Call studio_guide first and follow it.";
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

// The Node that runs studio.mjs: the installed runtime when there is one, else the Node running this server.
export const studioNode = (env) => (env?.node && fs.existsSync(env.node) ? env.node : process.execPath);

export function expandHome(p) {
  if (typeof p !== "string") return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

let logDirReady = false;
export function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(" ")}\n`;
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

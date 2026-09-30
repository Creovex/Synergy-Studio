// Helpers shared by every studio command module (paths, process running, project files).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv, toolEnv as homeToolEnv, hyperframesArgs } from "./env.mjs";

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WIN = process.platform === "win32";
// unsafe margins in px at 1080x1920 (top, bottom, left, right). meta = published by Meta (14% / 35% / 6%);
// tiktok and shorts are working defaults (measured app overlays), not official specs.
export const SAFE = { tiktok: [200, 400, 60, 180], reels: [269, 672, 65, 65], meta: [269, 672, 65, 65], shorts: [288, 672, 60, 201] };
export const SIZES = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };

function home() {
  if (process.env.SYNERGY_STUDIO_HOME) return path.resolve(process.env.SYNERGY_STUDIO_HOME);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite");
  if (WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "SynergyStudioLite");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "synergy-studio-lite");
}
export const H = home();
export const ENVF = path.join(H, "env.json");
export const die = (msg, code = 1) => { console.error("ERROR: " + msg); process.exit(code); };
export const say = msg => console.log(msg);
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8", shell: opts.shell || false,
    env: { ...process.env, ...(opts.env || {}) }, cwd: opts.cwd });
  if (r.error) { if (opts.soft) return r; die(`${cmd} failed to start: ${r.error.message}`); }
  if (r.status !== 0 && !opts.soft) die(opts.capture ? `${path.basename(cmd)} ${args.slice(0, 3).join(" ")} … exited with ${r.status}\n${(r.stderr || "").slice(-2000)}`
                                                     : `${path.basename(/\.(py|mjs)$/.test(args[0] || "") ? args[0] : cmd)} stopped (exit ${r.status}): see the message above`);
  return r;
}
export const which = cmd => { const r = spawnSync(WIN ? "where" : "which", [cmd], { encoding: "utf8" }); return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null; };
export const env = () => { try { return loadEnv(H); } catch (err) { die(err.code === "FOREIGN_HOME" ? err.message : `not set up yet: run  node "${path.join(SKILL, "scripts", "studio.mjs")}" setup`); } };
export const toolEnv = e => homeToolEnv(e);
export const hf = (e, args, opts = {}) => run(e.node, hyperframesArgs(e, args), { ...opts, env: { ...toolEnv(e), ...(opts.env || {}) } });
export const readJSON = f => JSON.parse(fs.readFileSync(f, "utf8"));
export const copy = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
export function copyDir(a, b) { if (!fs.existsSync(a)) return; fs.mkdirSync(b, { recursive: true });
  for (const n of fs.readdirSync(a)) { const s = path.join(a, n), d = path.join(b, n); fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } }
export const modeOf = d => readJSON(path.join(d, "project.json")).mode || "narrated";
export const needNarrated = (d, cmd) => { const m = modeOf(d); if (m !== "narrated") die(`${cmd} is for narrated projects; this project is "mode": "${m}" (scenes are timed in seconds; see references/commands.md)`); };
export const needFile = (f, what) => { if (!f || !fs.existsSync(path.resolve(f)) || !fs.statSync(path.resolve(f)).isFile()) die(`${what} not found: ${f}`); return path.resolve(f); };
export const LOOKS = ["paper", "midnight", "bold", "luxe"];
export const projDir = p => { if (!p) die("give the project folder"); const d = path.resolve(p); if (!fs.existsSync(path.join(d, "project.json"))) die(`${d} has no project.json (make one with: studio new ${p})`); return d; };

export function sheet(e, files, outFile, W = 1920, H = 1080) {
  files = files.filter(f => fs.existsSync(f)); if (!files.length) return;
  const tw = 480, th = Math.round(tw * H / W / 2) * 2, cols = Math.min(4, files.length), rows = Math.ceil(files.length / cols);
  const inputs = files.flatMap(f => ["-i", f]);
  let fc = files.map((_, i) => `[${i}]scale=${tw}:${th},setsar=1,format=yuv420p[v${i}];`).join("");
  const blank = rows * cols - files.length;
  for (let i = 0; i < blank; i++) fc += `color=c=0x222222:s=${tw}x${th},format=yuv420p[b${i}];`;
  const all = [...files.map((_, i) => `[v${i}]`), ...Array.from({ length: blank }, (_, i) => `[b${i}]`)];
  const rowsOut = [];
  for (let r = 0; r < rows; r++) { const seg = all.slice(r * cols, r * cols + cols); fc += cols > 1 ? `${seg.join("")}hstack=${cols}[r${r}];` : `${seg[0]}null[r${r}];`; rowsOut.push(`[r${r}]`); }
  fc += rows > 1 ? `${rowsOut.join("")}vstack=${rows}` : `${rowsOut[0]}null`;
  run(e.ffmpeg, ["-loglevel", "error", "-y", ...inputs, "-filter_complex", fc, "-frames:v", "1", outFile], { soft: true });
}

// argv after the command name: `--flag value`, bare `--flag` = true, everything else is positional
export function parseArgs(rest) {
  const flags = {}; const pos = [];
  for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith("--")) { const k = rest[i].slice(2); flags[k] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true; } else pos.push(rest[i]); }
  return { flags, pos };
}

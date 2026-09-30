import fs from "node:fs";
import path from "node:path";
import { say, run, env, hf, readJSON, copy, projDir, parseArgs } from "./common.mjs";
import { compose } from "./compose.mjs";

export const USAGE = "render <dir> [--draft]";

// ---------------------------------------------------------------- render
function render(dir, draft) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json"));
  compose(dir);
  const out = path.join(d, "out"); fs.mkdirSync(out, { recursive: true });
  const prev = fs.readdirSync(out).filter(f => f.endsWith(".mp4") || f.startsWith("source-") || f === "check.json");
  if (prev.some(f => f.endsWith(".mp4"))) {                                // keep the previous version with the sources that made it
    const h = path.join(d, "history", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)); fs.mkdirSync(h, { recursive: true });
    for (const f of prev) fs.renameSync(path.join(out, f), path.join(h, f));
    say(`previous version kept in ${path.relative(d, h)}/`);
  }
  const raw = path.join(out, "render-raw.mp4"), fin = path.join(out, `${proj.name}-${(proj.aspect || "16:9").replace(":", "x")}.mp4`);
  const args = ["render", path.join(d, "comp"), "-o", raw, "--player-ready-timeout", "60000"];
  if (draft) args.push("--quality", "draft");
  let r = hf(e, args, { soft: true });
  if (r.status !== 0) { say("render failed once; retrying (the first browser start can time out)"); hf(e, args); }
  // AAC encoding lowers loudness slightly: normalise the final file again, video untouched
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", raw, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", fin]);
  fs.rmSync(raw, { force: true });
  copy(path.join(d, "project.json"), path.join(out, "source-project.json")); copy(path.join(d, "src", "index.html"), path.join(out, "source-index.html"));
  say(`rendered ${fin}`);
  const mb = fs.statSync(fin).size / 1048576;
  if (mb > 25) {                            // chat apps and Claude's file sharing cap uploads (about 25–30 MB)
    const dur = parseFloat(run(e.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", fin], { capture: true }).stdout);
    const kbps = Math.max(150, Math.floor(23 * 8192 / dur - 128 - 30)), share = fin.replace(/\.mp4$/, "-share.mp4");   // 23 MB budget: video + 128k audio + container
    const scale = kbps < 900 ? ["-vf", "scale=-2:720"] : [];                                                               // long videos: 720p keeps it watchable
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", fin, ...scale, "-c:v", "libx264", "-preset", "slow", "-b:v", `${kbps}k`, "-maxrate", `${Math.floor(kbps * 1.2)}k`, "-bufsize", `${kbps * 2}k`,
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", share]);
    say(`${mb.toFixed(0)} MB is too big to send in chat: share copy ${share} (${(fs.statSync(share).size / 1048576).toFixed(0)} MB)`);
  }
  return fin;
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  render(pos[0], !!flags.draft);
  return 0;
}

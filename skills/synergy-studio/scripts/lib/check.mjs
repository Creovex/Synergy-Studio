import fs from "node:fs";
import path from "node:path";
import { SIZES, die, say, run, env, readJSON, projDir, sheet, parseArgs } from "./common.mjs";

export const USAGE = "check <dir>";

// ---------------------------------------------------------------- check
function check(dir) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json")), timing = readJSON(path.join(d, "timing.json"));
  const out = path.join(d, "out"); const mp4 = fs.existsSync(out) && fs.readdirSync(out).filter(f => f.endsWith(".mp4") && !/-share\.mp4$|^render-raw/.test(f)).map(f => path.join(out, f))[0];
  if (!mp4) die("no video yet: run `studio render` first");
  const res = { file: mp4, checks: [] }; const add = (name, ok, info) => res.checks.push({ name, ok, info });
  const pr = JSON.parse(run(e.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration", "-of", "json", mp4], { capture: true }).stdout);
  const v = pr.streams.find(s => s.codec_type === "video"), a = pr.streams.find(s => s.codec_type === "audio"), dur = +pr.format.duration;
  const [W, Hh] = SIZES[proj.aspect || "16:9"];
  add("video stream", !!v && v.codec_name === "h264" && v.width === W && v.height === Hh, v ? `${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate}` : "missing");
  add("audio stream", !!a && a.codec_name === "aac", a ? a.codec_name : "missing (every data-start element needs an id)");
  add("duration", Math.abs(dur - timing.TOTAL) <= 0.15, `${dur.toFixed(2)} s (timeline ${timing.TOTAL} s ± 0.15 s)`);
  if (proj.length) add("target length", dur <= proj.length * 1.05, `${dur.toFixed(1)} s (target ${proj.length} s)` + (dur < proj.length * 0.8 ? ` — note: ${Math.round(100 - 100 * dur / proj.length)}% shorter than the target; fine if on purpose` : ""));
  const lo = run(e.ffmpeg, ["-hide_banner", "-i", mp4, "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const I = +(lo.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)[0], TP = +(lo.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/-?[\d.]+/)[0];
  add("loudness", Math.abs(I + 14) <= 1, `${I} LUFS (target -14 ±1)`); add("true peak", TP <= -1.0, `${TP} dBTP (max -1.0)`);
  const bl = run(e.ffmpeg, ["-hide_banner", "-i", mp4, "-vf", "blackdetect=d=0.5:pic_th=0.98", "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const blacks = (bl.match(/black_start/g) || []).length; add("no black frames", blacks === 0, `${blacks} black stretch(es) ≥ 0.5 s`);
  const fr = run(e.ffmpeg, ["-hide_banner", "-i", mp4, "-vf", "freezedetect=n=0.001:d=4", "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const frozen = [...fr.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)].map(m => `${(+m[1]).toFixed(1)} s for ${(+m[2]).toFixed(1)} s`);
  add("nothing frozen ≥ 4 s", frozen.length === 0, frozen.length ? "still at " + frozen.join(", ") + " (add motion there)" : "ok");
  const sd = path.join(d, "stills"); fs.mkdirSync(sd, { recursive: true });
  const frames = Object.entries(timing.T).map(([s, t]) => { const f = path.join(sd, `final-${s}.jpg`);
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-ss", String(Math.min(t.vo_end, t.end - 0.5)), "-i", mp4, "-frames:v", "1", "-q:v", "3", f], { soft: true }); return f; });
  sheet(e, frames, path.join(sd, "final-sheet.jpg"), W, Hh);
  res.sheet = path.join(sd, "final-sheet.jpg"); res.pass = res.checks.every(c => c.ok);
  fs.writeFileSync(path.join(out, "check.json"), JSON.stringify(res, null, 2));
  for (const c of res.checks) say(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.info}`);
  say(`contact sheet: ${res.sheet}\n${res.pass ? "All automatic checks passed. Now LOOK at the contact sheet and watch the video before delivering." : "Fix the FAIL lines (references/checks-and-fixes.md), then render and check again."}`);
  if (!res.pass) process.exit(2);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  check(pos[0]);
  return 0;
}

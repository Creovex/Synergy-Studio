import fs from "node:fs";
import path from "node:path";
import { SIZES, die, say, run, env, readJSON, projDir, parseArgs } from "./common.mjs";

export const USAGE = "cut <dir>";

// project.json "edit.clips[].crop_x": where the crop to the aspect sits horizontally, 0 (left edge) to 1 (right edge), default 0.5
export function cropXProblem(clips) {
  for (const [i, c] of clips.entries()) {
    if (c.crop_x === undefined) continue;
    if (typeof c.crop_x !== "number" || !Number.isFinite(c.crop_x) || c.crop_x < 0 || c.crop_x > 1)
      return `edit.clips[${i}].crop_x is ${JSON.stringify(c.crop_x)}; use a number from 0 (left edge) to 1 (right edge), 0.5 is the centre`;
  }
  return null;
}

// every clip needs a source and a trim with 0 <= in < out; the message names the clip
export function trimProblem(clips) {
  for (const [i, c] of clips.entries()) {
    const name = `edit.clips[${i}]${c && c.src ? ` (${c.src})` : ""}`;
    if (!c || typeof c.src !== "string" || !c.src) return `${name} has no "src"; give the path of the clip, e.g. "src/footage/c1.mp4"`;
    if (typeof c.in !== "number" || typeof c.out !== "number" || !Number.isFinite(c.in) || !Number.isFinite(c.out) || c.in < 0)
      return `${name} needs "in" and "out" as seconds in the source clip, e.g. "in": 0.4, "out": 8.7`;
    if (c.out <= c.in) return `${name}: "out" (${c.out}) must be later than "in" (${c.in}); "in" and "out" are seconds in the source clip, in before out`;
  }
  return null;
}

// frames a trim occupies at the project frame rate; video and audio are both cut to exactly this many frames
export const clipFrames = (c, fps) => Math.max(1, Math.round((c.out - c.in) * fps));

// audio and video stream start times of a source file, in seconds (null when the stream is missing)
export function streamStarts(e, src) {
  const r = run(e.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,start_time", "-of", "json", src], { capture: true, soft: true });
  let streams = []; try { streams = JSON.parse(r.stdout).streams || []; } catch { /* unreadable: no warning */ }
  const start = type => { const s = streams.find(x => x.codec_type === type); const t = s && Number(s.start_time); return Number.isFinite(t) ? t : null; };
  return { audio: start("audio"), video: start("video") };
}

const shellQuote = f => `'${String(f).replace(/'/g, "'\\''")}'`;

// 7.9 C: a source whose audio and video start apart by more than one frame; the warning and the ffmpeg command that lines them up, or null
export function syncWarning(src, starts, fps, rel = src) {
  if (starts.audio === null || starts.video === null) return null;
  const diff = starts.audio - starts.video;
  if (Math.abs(diff) <= 1 / fps + 1e-6) return null;
  const shift = -diff, fixed = src.replace(/(\.\w+)?$/, "-synced.mp4");
  const cmd = `ffmpeg -i ${shellQuote(src)} -itsoffset ${+shift.toFixed(3)} -i ${shellQuote(src)} -map 0:v -map 1:a -c copy ${shellQuote(fixed)}`;
  return `warning: ${rel}: the audio starts ${Math.abs(diff).toFixed(3)} s ${diff > 0 ? "after" : "before"} the picture (audio ${starts.audio.toFixed(3)} s, video ${starts.video.toFixed(3)} s; more than one frame at ${fps} fps).\n` +
    `  cut takes picture and sound separately, so the voice can end up ${Math.abs(diff).toFixed(3)} s off the lips. If it looks or sounds out of sync, shift the audio to start with the picture and use the new file as the clip:\n  ${cmd}`;
}

// ---------------------------------------------------------------- cut (footage)
// project.json "edit": {"clips": [{"src": "src/footage/c4.mp4", "in": 0.4, "out": 8.7, "crop_x": 0.5}, ...], "grade": "warm|neutral|none", "clean_voice": true}
function cut(dir) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json")), ed = proj.edit;
  if (!ed || !ed.clips || !ed.clips.length) die('add "edit": {"clips": [{"src", "in", "out"}]} to project.json');
  const badTrim = trimProblem(ed.clips); if (badTrim) die(badTrim);
  const badCrop = cropXProblem(ed.clips); if (badCrop) die(badCrop);
  const [W, Hh] = SIZES[proj.aspect || "9:16"], fps = proj.fps || 30;
  const grade = { warm: "colortemperature=temperature=5400,eq=saturation=1.2:contrast=1.05,unsharp=5:5:0.4", neutral: "eq=saturation=1.05:contrast=1.03", none: "null" }[ed.grade || "warm"];
  const clean = ed.clean_voice === false ? "anull" : "highpass=f=80,afftdn=nf=-25,equalizer=f=3000:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80";
  const work = path.join(d, "work"); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const list = [], auds = [], checked = new Set();
  ed.clips.forEach((c, i) => {
    const src = path.resolve(d, c.src), frames = clipFrames(c, fps), len = frames / fps; if (!fs.existsSync(src)) die(`clip not found: ${src}`);
    if (!checked.has(src)) { checked.add(src); const w = syncWarning(src, streamStarts(e, src), fps, c.src); if (w) say(w); }
    const v = path.join(work, `v${i}.mp4`), a = path.join(work, `a${i}.wav`);
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-ss", String(c.in), "-i", src, "-an",
      "-vf", `scale=${W}:${Hh}:force_original_aspect_ratio=increase,crop=${W}:${Hh}:(in_w-out_w)*${c.crop_x ?? 0.5}:(in_h-out_h)/2,fps=${fps},tpad=stop_mode=clone:stop=${frames},${grade},format=yuv420p`, "-frames:v", String(frames), "-c:v", "libx264", "-crf", "16", "-preset", "fast", v]);
    const hasAudio = run(e.ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", src], { capture: true }).stdout.trim();
    if (hasAudio) run(e.ffmpeg, ["-loglevel", "error", "-y", "-ss", String(c.in), "-t", String(len), "-i", src, "-vn", "-ac", "1", "-ar", "24000",
      "-af", `${clean},apad=whole_dur=${len},afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, len - 0.012)}:d=0.012`, "-t", String(len), a]);
    else run(e.ffmpeg, ["-loglevel", "error", "-y", "-f", "lavfi", "-t", String(len), "-i", "anullsrc=r=24000:cl=mono", a]);
    list.push(`file '${v.replace(/'/g, "'\\''")}'`); auds.push(a);
  });
  fs.writeFileSync(path.join(work, "list.txt"), list.join("\n"));
  fs.mkdirSync(path.join(d, "src", "assets"), { recursive: true }); fs.mkdirSync(path.join(d, "audio"), { recursive: true });
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(work, "list.txt"), "-c", "copy", path.join(d, "src", "assets", "base.mp4")]);
  run(e.ffmpeg, ["-loglevel", "error", "-y", ...auds.flatMap(a => ["-i", a]), "-filter_complex", `${auds.map((_, i) => `[${i}]`).join("")}concat=n=${auds.length}:v=0:a=1`, path.join(d, "audio", "voice.wav")]);
  const total = +run(e.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(d, "src", "assets", "base.mp4")], { capture: true }).stdout.trim();
  let t = 0; const cuts = ed.clips.map(c => { const s = t; t += clipFrames(c, fps) / fps; return +s.toFixed(3); });
  fs.writeFileSync(path.join(d, "cuts.json"), JSON.stringify({ total, cuts }, null, 1));
  fs.rmSync(work, { recursive: true, force: true });
  say(`cut: src/assets/base.mp4 (${W}x${Hh}, ${total.toFixed(2)} s, cuts at ${cuts.join(", ")} s) and audio/voice.wav\nnext: studio transcribe ${dir}  (word timings for captions and overlays)`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  cut(pos[0]);
  return 0;
}

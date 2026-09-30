import fs from "node:fs";
import path from "node:path";
import { SIZES, die, say, run, env, readJSON, projDir, parseArgs } from "./common.mjs";

export const USAGE = "cut <dir>";

// ---------------------------------------------------------------- cut (footage)
// project.json "edit": {"clips": [{"src": "src/footage/c4.mp4", "in": 0.4, "out": 8.7}, ...], "grade": "warm|neutral|none", "clean_voice": true}
function cut(dir) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json")), ed = proj.edit;
  if (!ed || !ed.clips || !ed.clips.length) die('add "edit": {"clips": [{"src", "in", "out"}]} to project.json');
  const [W, Hh] = SIZES[proj.aspect || "9:16"], fps = proj.fps || 30;
  const grade = { warm: "colortemperature=temperature=5400,eq=saturation=1.2:contrast=1.05,unsharp=5:5:0.4", neutral: "eq=saturation=1.05:contrast=1.03", none: "null" }[ed.grade || "warm"];
  const clean = ed.clean_voice === false ? "anull" : "highpass=f=80,afftdn=nf=-25,equalizer=f=3000:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80";
  const work = path.join(d, "work"); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const list = [], auds = [];
  ed.clips.forEach((c, i) => {
    const src = path.resolve(d, c.src), len = c.out - c.in; if (!fs.existsSync(src)) die(`clip not found: ${src}`);
    const v = path.join(work, `v${i}.mp4`), a = path.join(work, `a${i}.wav`);
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-ss", String(c.in), "-t", String(len), "-i", src, "-an",
      "-vf", `scale=${W}:${Hh}:force_original_aspect_ratio=increase,crop=${W}:${Hh},fps=${fps},${grade},format=yuv420p`, "-c:v", "libx264", "-crf", "16", "-preset", "fast", v]);
    const hasAudio = run(e.ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", src], { capture: true }).stdout.trim();
    if (hasAudio) run(e.ffmpeg, ["-loglevel", "error", "-y", "-ss", String(c.in), "-t", String(len), "-i", src, "-vn", "-ac", "1", "-ar", "24000",
      "-af", `${clean},afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, len - 0.012)}:d=0.012`, a]);
    else run(e.ffmpeg, ["-loglevel", "error", "-y", "-f", "lavfi", "-t", String(len), "-i", "anullsrc=r=24000:cl=mono", a]);
    list.push(`file '${v.replace(/'/g, "'\\''")}'`); auds.push(a);
  });
  fs.writeFileSync(path.join(work, "list.txt"), list.join("\n"));
  fs.mkdirSync(path.join(d, "src", "assets"), { recursive: true }); fs.mkdirSync(path.join(d, "audio"), { recursive: true });
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(work, "list.txt"), "-c", "copy", path.join(d, "src", "assets", "base.mp4")]);
  run(e.ffmpeg, ["-loglevel", "error", "-y", ...auds.flatMap(a => ["-i", a]), "-filter_complex", `${auds.map((_, i) => `[${i}]`).join("")}concat=n=${auds.length}:v=0:a=1`, path.join(d, "audio", "voice.wav")]);
  const total = +run(e.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(d, "src", "assets", "base.mp4")], { capture: true }).stdout.trim();
  let t = 0; const cuts = ed.clips.map(c => { const s = t; t += c.out - c.in; return +s.toFixed(3); });
  fs.writeFileSync(path.join(d, "cuts.json"), JSON.stringify({ total, cuts }, null, 1));
  fs.rmSync(work, { recursive: true, force: true });
  say(`cut: src/assets/base.mp4 (${W}x${Hh}, ${total.toFixed(2)} s, cuts at ${cuts.join(", ")} s) and audio/voice.wav\nnext: studio transcribe ${dir}  (word timings for captions and overlays)`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  cut(pos[0]);
  return 0;
}

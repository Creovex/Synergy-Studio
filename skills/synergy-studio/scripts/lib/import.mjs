import fs from "node:fs";
import path from "node:path";
import { SIZES, die, say, run, env, readJSON, needFile, parseArgs } from "./common.mjs";
import { main as newMain } from "./new.mjs";
import { videoSheet } from "./frames.mjs";

export const USAGE = "import <dir> <video> [--aspect 9:16|16:9|1:1|4:5]";

const DEFAULT_ASPECT = "9:16", SHEET_TILES = 12;

// the first video stream and the first audio stream of a file, from ffprobe
function probe(e, file) {
  const r = run(e.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration", "-of", "json", file], { capture: true, soft: true });
  let j; try { j = JSON.parse(r.stdout); } catch { j = null; }
  const v = j?.streams?.find(s => s.codec_type === "video"), a = j?.streams?.find(s => s.codec_type === "audio"), dur = Number(j?.format?.duration);
  if (!v || !Number.isFinite(dur) || dur <= 0) die(`${file} is not a video file ffmpeg can read (no picture found). Give a finished .mp4 or .mov.`);
  const [n, dd] = String(v.r_frame_rate).split("/").map(Number);
  return { width: v.width, height: v.height, fps: dd ? n / dd : n, duration: dur, audio: a ? a.codec_name : null };
}

// A footage project from a finished video: the same project `new --mode footage` makes, the file copied to src/footage/, one clip covering all of it.
async function importVideo(dir, video, aspect) {
  if (!dir || !video) die(`usage: studio ${USAGE}`);
  if (!SIZES[aspect]) die("--aspect must be one of " + Object.keys(SIZES).join(", "));
  const e = env(), src = needFile(video, "video"), info = probe(e, src);
  const d = path.resolve(dir);
  if (fs.existsSync(path.join(d, "project.json"))) die(`${d} already has a project; give a new folder`);
  const log = console.log; console.log = () => {};                       // new prints its own next steps, which do not apply here
  try { await newMain([dir, "--mode", "footage", "--aspect", aspect]); } finally { console.log = log; }
  const name = path.basename(src), rel = `src/footage/${name}`, seconds = +info.duration.toFixed(2);
  fs.copyFileSync(src, path.join(d, rel));
  const pj = path.join(d, "project.json"), proj = readJSON(pj), third = +(seconds / 3).toFixed(2);
  proj.length = Math.ceil(seconds);
  proj.edit = { ...proj.edit, clips: [{ src: rel, in: 0, out: seconds }] };
  proj.scenes = [{ id: "s1", start: 0, end: third }, { id: "s2", start: third, end: +(2 * third).toFixed(2) }, { id: "s3", start: +(2 * third).toFixed(2), end: seconds }];
  fs.writeFileSync(pj, JSON.stringify(proj, null, 2));
  const sheet = path.join(d, "stills", "source-sheet.jpg");
  videoSheet(e, path.join(d, rel), sheet, { n: SHEET_TILES });
  say(`import: ${d}\n  ${name}: ${info.duration.toFixed(2)} s, ${info.fps.toFixed(2).replace(/\.?0+$/, "")} fps, ${info.width}x${info.height}, ${info.audio ? `with audio (${info.audio})` : "no audio"}\n` +
      `  one clip covers the whole file (edit.clips in project.json); ${aspect} project, target length ${proj.length} s, three placeholder scenes to replace\n` +
      `  LOOK at ${path.relative(process.cwd(), sheet)}: ${SHEET_TILES} tiles in time order\n` +
      `next: trim or split the clip in edit.clips (crop_x sets the reframing, 0 left to 1 right), then studio cut ${dir} and studio transcribe ${dir}`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  if (flags.aspect === true) die("--aspect needs a value, e.g. --aspect 9:16");
  await importVideo(pos[0], pos[1], flags.aspect || DEFAULT_ASPECT);
  return 0;
}

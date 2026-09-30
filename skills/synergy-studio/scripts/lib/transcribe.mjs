import fs from "node:fs";
import path from "node:path";
import { die, say, env, hf, projDir, readJSON, parseArgs } from "./common.mjs";

export const USAGE = "transcribe <dir> [file]";

// ---------------------------------------------------------------- transcribe / words
function transcribe(dir, media) {
  const e = env(), d = projDir(dir);
  const src = path.resolve(media || path.join(d, "audio", "voice.wav"));
  const r = hf(e, ["transcribe", src, "-d", d, "--json", "-m", "small.en"], { capture: true, soft: true });
  const out = (r.stdout || "").trim().split("\n").pop();
  if (r.status !== 0 || !fs.existsSync(path.join(d, "transcript.json"))) die(`transcribe failed: ${out || r.stderr}\n(The first run downloads the Whisper model from huggingface.co; it needs internet. Or import captions: studio transcribe ${dir} my.srt)`);
  say(`transcript.json written (${readJSON(path.join(d, "transcript.json")).length} words). Fix misheard brand words with "caption_fixes" in project.json.`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  transcribe(pos[0], pos[1]);
  return 0;
}

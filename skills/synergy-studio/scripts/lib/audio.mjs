import path from "node:path";
import { SKILL, say, run, env, projDir, parseArgs } from "./common.mjs";

export const USAGE = "audio <dir>";

function audio(dir) {
  const e = env(), d = projDir(dir);
  run(e.python, [path.join(SKILL, "scripts", "audio.py"), d, e.ffmpeg]);
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", path.join(d, "audio", "mix_raw.wav"), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", path.join(d, "audio", "mix.wav")]);
  say("wrote timing.js and audio/mix.wav (-14 LUFS)");
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  audio(pos[0]);
  return 0;
}

import path from "node:path";
import { SKILL, ENVF, die, run, env, readJSON, needNarrated, projDir, parseArgs } from "./common.mjs";

export const USAGE = "voice <dir> [--only s2,s4]";

// ---------------------------------------------------------------- voice / audio
function voice(dir, only) {
  const e = env(), d = projDir(dir); needNarrated(d, "voice");
  if (only) { const ids = readJSON(path.join(d, "project.json")).scenes.map(s => s.id), bad = String(only).split(",").filter(x => !ids.includes(x));
    if (bad.length) die(`--only: no scene ${bad.join(", ")} (scenes: ${ids.join(", ")})`); }
  run(e.python, [path.join(SKILL, "scripts", "voice.py"), ENVF, d, only || ""]);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  voice(pos[0], flags.only);
  return 0;
}

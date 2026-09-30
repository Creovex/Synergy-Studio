import fs from "node:fs";
import path from "node:path";
import { VOICES, projectVoiceProblem, voiceProblem, readProject, speedProblem } from "./voice.mjs";
import { SKILL, ENVF, die, say, run, env, copy, projDir, parseArgs } from "./common.mjs";

export const USAGE = "say <dir> \"text\" [--voice v]";

function sayLine(dir, text, v) {
  const e = env(), d = projDir(dir); if (!text) die('usage: studio say <dir> "HAURA Scent" [--voice af_heart]');
  const p = readProject(d);
  if (v === true) die(`--voice needs a voice id. Use one of: ${VOICES.join(", ")}`);
  const bad = (v !== undefined ? voiceProblem(v, "--voice") : projectVoiceProblem({ voice: p.voice })) || speedProblem({ speed: p.speed }); if (bad) die(bad);
  const tmpP = path.join(d, "audio", "say-project");
  fs.mkdirSync(tmpP, { recursive: true });
  fs.writeFileSync(path.join(tmpP, "project.json"), JSON.stringify({ voice: v || p.voice || "af_heart", speed: p.speed || 0.95, lexicon: p.lexicon || {}, scenes: [{ id: "s1", say: text }] }));
  const r = run(e.python, [path.join(SKILL, "scripts", "voice.py"), ENVF, tmpP, ""], { capture: true, soft: true });
  if (r.status !== 0) { fs.rmSync(tmpP, { recursive: true, force: true }); die(`say failed (unknown voice?): ${(r.stderr || "").trim().split("\n").pop()}`); }
  copy(path.join(tmpP, "audio", "vo", "s1.wav"), path.join(d, "audio", "say.wav")); fs.rmSync(tmpP, { recursive: true, force: true });
  say(`wrote ${path.join(d, "audio", "say.wav")}: send it to the user to confirm the pronunciation (fix spelling in "lexicon")`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  sayLine(pos[0], pos[1], flags.voice);
  return 0;
}

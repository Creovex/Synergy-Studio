#!/usr/bin/env node
// T8 falsifier: the same project with crop_x: 0 on every clip, cut and shown, so a judge can compare it with the real cut.
// Usage: node test/harness/crop-x-zero.mjs <project-dir> [--out <new-project-dir>] [--render]
// Makes a copy, sets crop_x to 0 on every clip in edit.clips, runs `cut` and then `stills` (or `render` and `check` with --render),
// and prints the path of the contact sheet. The copy is kept (its path is printed); delete it when the judge is done.
// Nothing is asserted about the picture: whether the crop cuts text off is the judge's finding. Exit 2 only when a command fails.
import fs from "node:fs";
import path from "node:path";
import { line, exitFor, usage, requireProject, readJSON, copyProject, tempDir, studioLogged, isMain } from "./lib.mjs";

export function main(argv) {
  const render = argv.includes("--render"), oi = argv.indexOf("--out");
  const src = requireProject(argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out"));
  const project = readJSON(path.join(src, "project.json"));
  if (!project.edit?.clips?.length) usage("the project has no edit.clips");
  const dest = oi >= 0 ? path.resolve(argv[oi + 1] || usage("--out needs a folder")) : path.join(tempDir("cropx0"), path.basename(src));
  if (oi >= 0 && fs.existsSync(dest)) usage(`${dest} already exists`);
  copyProject(src, dest);
  const copy = readJSON(path.join(dest, "project.json"));
  copy.edit.clips = copy.edit.clips.map((c) => ({ ...c, crop_x: 0 }));
  fs.writeFileSync(path.join(dest, "project.json"), JSON.stringify(copy, null, 2));
  line("INFO", "crop_x", `0 on all ${copy.edit.clips.length} clip(s) (was ${project.edit.clips.map((c) => c.crop_x ?? "default").join(", ")}) in ${dest}`);
  const results = [];
  const steps = [["cut", [dest]], ...(render ? [["render", [dest]], ["check", [dest]]] : [["stills", [dest]]])];
  for (const [cmd, args] of steps) {
    const r = studioLogged([cmd, ...args]);
    results.push(line(r.status === 0 ? "PASS" : "FAIL", cmd, `exit ${r.status}`));
    if (r.status !== 0 && cmd !== "check") break;
  }
  const sheet = path.join(dest, "stills", render ? "final-sheet.jpg" : "sheet.jpg");
  if (fs.existsSync(sheet)) line("INFO", "contact sheet", sheet);
  line("INFO", "project copy", dest);
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));

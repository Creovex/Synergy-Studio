#!/usr/bin/env node
// T7 falsifier (a): a copy of a project whose page has the captions(...) call removed. Render it and run captions-coverage.mjs
// on the copy: it must FAIL (no out/captions.json is written for a page that does not call captions()).
// Usage: node test/harness/strip-captions.mjs <project-dir> <new-project-dir>
import fs from "node:fs";
import path from "node:path";
import { EXIT, line, usage, requireProject, copyProject, isMain } from "./lib.mjs";
import { stripCaptionsCalls } from "./captions-lib.mjs";

export function main(argv) {
  const dir = requireProject(argv[0]);
  if (!argv[1]) usage("give the folder for the copy", "Usage: node test/harness/strip-captions.mjs <project-dir> <new-project-dir>");
  const dest = path.resolve(argv[1]);
  if (fs.existsSync(dest)) usage(`${dest} already exists`);
  copyProject(dir, dest);
  const page = path.join(dest, "src", "index.html");
  const { html, removed } = stripCaptionsCalls(fs.readFileSync(page, "utf8"));
  if (!removed) { fs.rmSync(dest, { recursive: true, force: true }); usage("the page has no captions(...) call to remove"); }
  fs.writeFileSync(page, html);
  line("PASS", "captions removed", `${removed} call(s) removed from ${page}`);
  console.log(`next: node skills/synergy-studio/scripts/studio.mjs render ${dest}; node test/harness/captions-coverage.mjs ${dest}  (must FAIL)`);
  return EXIT.PASS;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));

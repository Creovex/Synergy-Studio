#!/usr/bin/env node
// T5 examples: the owner's three examples render and pass `check`; a copy of hydration-tips with one data-start id removed fails compose.
// Usage: node test/harness/t5-examples.mjs [--keep]      (--keep leaves the temporary project folders; the log folder is always kept)
// LITE.md section 11 (T5): "all three render and pass `check`"; falsifier: "a copy of hydration-tips with one `data-start` id removed fails compose".
// hydration-tips and three-product: voice, audio, render, check. footage-captions: reference/videos/onescan.mp4 is copied to
// src/footage/clip.mp4 (in the temporary copy only, never in the repo), then cut, transcribe (no file: the narration of the cut's
// audio/voice.wav), audio, render, check. Its captions line must PASS.
// Exit codes: 0 all PASS, 1 usage or setup error, 2 a FAIL.
import fs from "node:fs";
import path from "node:path";
import { line, exitFor, studio, tempDir, rmDir, copyProject, parseCheck, findMp4, usage, isMain, REPO, SKILL } from "./lib.mjs";

const EXAMPLES = path.join(SKILL, "examples");
const CLIP_SOURCE = path.join(REPO, "reference", "videos", "onescan.mp4");
const STEPS = { "hydration-tips": ["voice", "audio", "render", "check"], "three-product": ["voice", "audio", "render", "check"], "footage-captions": ["cut", "transcribe", "audio", "render", "check"] };

const write = (file, text) => fs.writeFileSync(file, text);

// runs one studio command in a project, keeps its whole output in the log folder; returns {ok, out}
function step(logDir, name, cmd, dir) {
  const r = studio([cmd, dir]);
  write(path.join(logDir, `${name}-${cmd}.log`), `$ studio ${cmd} ${dir}\nexit ${r.status}\n\n${r.out}`);
  return { ok: r.status === 0, status: r.status, out: r.out };
}

function runExample(name, work, logDir) {
  const dir = path.join(work, name);
  copyProject(path.join(EXAMPLES, name), dir);
  if (name === "footage-captions") {
    if (!fs.existsSync(CLIP_SOURCE)) return { dir, results: [line("FAIL", name, `${CLIP_SOURCE} is missing`)] };
    fs.mkdirSync(path.join(dir, "src", "footage"), { recursive: true });
    fs.copyFileSync(CLIP_SOURCE, path.join(dir, "src", "footage", "clip.mp4"));
  }
  const results = [];
  for (const cmd of STEPS[name]) {
    const r = step(logDir, name, cmd, dir);
    if (cmd === "check") {
      const checks = parseCheck(r.out);
      checks.forEach((c) => console.log(`    ${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.info}`));
      const bad = checks.filter((c) => !c.ok);
      const captionsOk = name !== "footage-captions" || checks.some((c) => /caption/i.test(c.name) && c.ok);
      const good = r.ok && checks.length > 0 && !bad.length && captionsOk;
      results.push(line(good ? "PASS" : "FAIL", `${name} check`, `${checks.length} lines, ${bad.length} failing${captionsOk ? "" : ", no captions line PASS"}, exit ${r.status}`));
    } else if (!r.ok) {
      results.push(line("FAIL", `${name} ${cmd}`, `exit ${r.status}: ${r.out.trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`));
      return { dir, results };
    }
  }
  const sheet = path.join(dir, "stills", "final-sheet.jpg");
  if (fs.existsSync(sheet)) fs.copyFileSync(sheet, path.join(logDir, `${name}-final-sheet.jpg`));
  results.push(line(findMp4(dir) ? "PASS" : "FAIL", `${name} render`, findMp4(dir) ? path.basename(findMp4(dir)) : "no MP4 in out/"));
  return { dir, results };
}

// the copy of hydration-tips with the id removed from the first element that has both an id and data-start
function makeFalsifier(fromDir, work) {
  const dir = copyProject(fromDir, path.join(work, "hydration-no-id"));
  const page = path.join(dir, "src", "index.html"), html = fs.readFileSync(page, "utf8");
  const tag = [...html.matchAll(/<[a-z][^>]*\sdata-start=[^>]*>/gi)].map((m) => m[0]).find((t) => /\sid="[^"]+"/.test(t));
  if (!tag) return null;
  const removed = /\sid="([^"]+)"/.exec(tag)[1];
  write(page, html.replace(tag, tag.replace(/\sid="[^"]+"/, "")));
  return { dir, removed };
}

export function main(argv) {
  if (!fs.existsSync(path.join(SKILL, "scripts", "studio.mjs"))) usage("skills/synergy-studio/scripts/studio.mjs not found");
  const work = tempDir("t5"), logDir = tempDir("t5-logs"), results = [];
  console.log(`logs: ${logDir}`);
  try {
    const dirs = {};
    for (const name of Object.keys(STEPS)) {
      console.log(`\n${name}`);
      const r = runExample(name, work, logDir);
      dirs[name] = r.dir; results.push(...r.results);
    }
    console.log("\nfalsifier: hydration-tips with one data-start id removed");
    const f = makeFalsifier(dirs["hydration-tips"], work);
    if (!f) results.push(line("FAIL", "falsifier", "no element with both id and data-start in hydration-tips"));
    else {
      const r = step(logDir, "falsifier", "compose", f.dir);
      const message = r.out.split("\n").find((l) => /data-start/i.test(l));
      console.log(`  removed id "${f.removed}"; compose exit ${r.status}${message ? `; ${message.trim().slice(0, 240)}` : ""}`);
      results.push(line(!r.ok && message ? "PASS" : "FAIL", "falsifier compose fails", `exit ${r.status}, ${message ? "data-start message present" : "no data-start message"}`));
    }
  } finally {
    if (argv.includes("--keep")) console.log(`kept: ${work}`); else rmDir(work);
  }
  console.log("\nsummary");
  const groups = Object.keys(STEPS).map((n) => [n, results.filter((r) => r.name.startsWith(n))]);
  groups.forEach(([n, rs]) => console.log(`${rs.length && rs.every((r) => r.status === "PASS") ? "PASS" : "FAIL"}  ${n}`));
  const fal = results.find((r) => r.name.startsWith("falsifier"));
  console.log(`${fal?.status === "PASS" ? "PASS" : "FAIL"}  falsifier`);
  console.log(`logs: ${logDir}`);
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));

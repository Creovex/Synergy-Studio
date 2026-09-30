#!/usr/bin/env node
// T7s falsifier: a synctest page with its beeps placed 3 frames late must fail (7.9 B, exit 2).
// Usage: node test/harness/late-beep-synctest.mjs
// Constant, from LITE.md section 11 (T7s): the beeps are 3 frames late, i.e. `synctest --beep-offset 3` (one frame is the pass limit).
// PASS here means the falsifier behaved: synctest exited 2 and printed a FAIL line.
import { line, exitFor, studioLogged, isMain } from "./lib.mjs";

export const BEEP_OFFSET_FRAMES = 3;

export function main() {
  const r = studioLogged(["synctest", "--beep-offset", BEEP_OFFSET_FRAMES]);
  const failLine = r.out.split("\n").find((l) => /^FAIL\b/.test(l.trim()));
  const results = [line(r.status === 2 && failLine ? "PASS" : "FAIL", "synctest with beeps 3 frames late",
    r.status === 2 ? `exited 2 as required${failLine ? `: ${failLine.trim().slice(0, 140)}` : " but printed no FAIL line"}` : `exited ${r.status}, expected 2 (a beep 3 frames late must not pass)`)];
  return exitFor(results);
}

if (isMain(import.meta.url)) process.exitCode = main();

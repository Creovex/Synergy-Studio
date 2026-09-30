# Gate harness

Scripts that run the lite gate tests (LITE.md section 11) whose assertions no `check` line covers. Each prints PASS, FAIL,
WARN, INFO or PENDING lines. Exit codes: 0 all PASS, 1 usage or setup error, 2 a FAIL, 3 PENDING. Thresholds are constants at
the top of each script, fixed before the first run, with the LITE.md sentence they come from. They go through the CLI
(`node skills/synergy-studio/scripts/studio.mjs <command>`) and never read its internals. Temporary files go to the OS temp
directory (set `HARNESS_TMP` to change it) and are deleted, except with `--keep`.

| Script | Test | Usage | Threshold |
|---|---|---|---|
| `captions-coverage.mjs` | T7, T8 | `<project>` | at least 90% of transcript words inside the video's range are in `out/captions.json` (matched by normalised text in order, after `caption_fixes`) |
| `caption-band.mjs` | T7 | `<project> [--t s] [--keep]` | mean absolute RGB difference above 10 (0 to 255) over the band from `top` to `top + 2.5 x size`, full width, between a still at a spoken word and the same still with `captions()` removed; `top` (px or %) and `size` (default 72) are read from the page's call |
| `strip-captions.mjs` | T7 falsifier a | `<project> <new-dir>` | copy without `captions()`; render it, then `captions-coverage.mjs` must FAIL |
| `late-audio-clip.mjs` | T7s | `[--keep]` or `--make <dir>` | `cut` warns for a clip whose audio starts 0.2 s after its video and not for a clean clip (a line with warn or "!", "audio" and "start" or "offset") |
| `late-beep-synctest.mjs` | T7s falsifier | none | `synctest --beep-offset 3` exits 2 with a FAIL line |
| `delayed-mp4.mjs` | T7 falsifier b | `<project> [--adelay]` | audio delayed 3 frames (`-itsoffset`; the delay is measured by the harness, tolerance 20 ms); control copy PASS and delayed copy FAIL on `audio against mix`, `check` exit 2 |
| `crop-x-zero.mjs` | T8 falsifier | `<project> [--out dir] [--render]` | none: copy with `crop_x: 0` on every clip, `cut`, `stills` (or `render`, `check`); prints the sheet path for the judge |
| `fps30-conversion.mjs` | T10 falsifier | `<60 fps project>` | 30 fps copy makes `check` exit 2 on `frame rate`; control PASS |
| `t4-word-timing.mjs` | T4 | `[--keep]` | 20 fixed words, 19 fixed gaps (`t4-scorer.mjs`), Kokoro af_heart speed 1.0; median onset error at most 80 ms, 95th percentile (nearest rank) at most 200 ms, a missing word is infinite error. Falsifier: evenly spaced timings must fail. PENDING (exit 3) if transcription is unavailable |
| `t6-determinism.mjs` | T6 | `[--sketch] [--hydration] [--keep]` | decoded frames at 1 s, the middle and TOTAL minus 1 s identical for two renders of the sketch page (`fixtures/sketch-page.html`, rng 1) and of hydration-tips; falsifier: rng 2 differs at one frame or more |
| `t0-contract.mjs` | T0 | `[skill-folder] [--repo dir] [--run] [--tools file] [--falsifier]` | every command, flag, written file, `SS.start()` helper and sketch kit name in the text exists in the code; `--tools` checks `studio_*` names against a tools/list JSON; `--falsifier` adds "run `studio fly <dir>`" and requires the failure |

Support files: `lib.mjs`, `captions-lib.mjs`, `audio-lib.mjs`, `t0-parse.mjs` (extraction rules), `t4_synth.py`.
`test/harness.test.mjs` checks the scorers and parsers on synthetic data (`node --test test/harness.test.mjs`).

Known limits: flags are tied to a command only inside the same code span, fenced line or Command table row; written files are
found from a Command table Writes column, a verb or arrow in the same sentence, or a bracketed bare name; without `--run`
a file is proven by the command's code naming it, not by producing it.

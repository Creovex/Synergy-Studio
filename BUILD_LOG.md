# Build log

The public record of the lite build: for every task, the worker and its model, the commands rerun by the
orchestrator, their literal output, and PASS, BLOCKED or PENDING.

## Writing rules

1. No version labels in prose ("v1", "v2", "phase 2" and similar). Pinned versions in code, lockfiles and install logic stay exactly as pinned; `BUILD_LOG.md`, `NOTICE.md` and `research/` may quote them as identifiers.
2. Never use a dash as punctuation between words or clauses; use a comma, colon, semicolon or full stop. Hyphens inside compound names and file names are fine.
3. These rules are copied into `README.md`, `AGENTS.md` and `BUILD_LOG.md`.
4. Name every gap. Nothing unproven is called done: it is PENDING or BLOCKED with the reason.

## L0: machine and workspace

Worker: orchestrator (Opus 5.5). Date: 2026-09-30.

`ls ~/Documents ~/Downloads` raised no privacy prompt. Repo folder: the only match is
`/Users/blaze/Documents/Claude Code/Synergy-Studio`; it was empty; `git init` run.

Machine, literal output:
```
$ uname -m
arm64
$ sysctl -n machdep.cpu.brand_string
Apple M4 Pro
$ sw_vers
ProductName:		macOS
ProductVersion:		27.0
BuildVersion:		26A5421a
$ git --version
git version 2.50.1 (Apple Git-155)
$ df -h ~
Filesystem      Size    Used   Avail Capacity iused ifree %iused  Mounted on
/dev/disk3s5   460Gi   385Gi    15Gi    97%    3.2M  159M    2%   /System/Volumes/Data
```
15 GiB free, above the 10 GB floor.

Reference code: `https://github.com/Creovex/random-research`, branch `claude/clever-lamport-n7of0u`, cloned to
`reference/lite-branch/`. Four commits follow `7bc67f3` (`35a02a2`, `646cb60`, `3b0881b`, `6035de2`); James chose
the newest skill files, so the contract commit is `6035de2`, rechecked for newer commits at L10.
`media/haura-intro-reel/` of branch `claude/brave-sagan-ne9yqw` taken by a shallow sparse checkout into
`reference/haura-original/` (508K). Branch files read for L0: none beyond the commit list and file list.

L0: PASS.

## L1: research and rubrics

Workers (Agent tool, model sonnet, one per file, web only): `research/mcp-protocol.md`, `research/claude-code-plugins.md`,
`research/claude-desktop-bundles.md`, `research/runtime-pins.md`. Each has sources and the read date 2026-09-30.
Orchestrator rerun of the pins that go into code (`ledger` evidence L1-pins), literal output:
```
$ curl -s https://nodejs.org/dist/index.json | first v22
v22.23.3 2026-09-23 Jod
$ curl -s https://nodejs.org/dist/v22.23.3/SHASUMS256.txt | grep darwin-arm64.tar.gz
23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53  node-v22.23.3-darwin-arm64.tar.gz
$ curl -sL .../uv/releases/download/0.12.21/uv-aarch64-apple-darwin.tar.gz.sha256
b88bda573e566ef9bced66b155fe0408626fbbc053aee1c30ba686f0728c9447  uv-aarch64-apple-darwin.tar.gz
$ pillow latest
12.3.0
```
Findings that change the build:
- The newest MCP revision (`2026-07-28`) drops `initialize`; Claude Code sent `initialize` on this Mac today, so the
  server supports `2025-11-25` and older (LITE.md "Changes made during the build").
- Plugin MCP tools are named `mcp__plugin_synergy-studio_synergy-studio__<tool>` (from documentation; confirmed at L8).
- Bundle tool: `@anthropic-ai/mcpb` 2.1.2, manifest version `0.3`. MCP TypeScript SDK 1.31.0 for tests.
Rubrics `test/rubrics/T10.md` to `T13.md` written by the orchestrator before any video exists; frozen after L3.

L1: PASS.

## Restart from the owner's code (updated prompt from James, 2026-09-30)

James's updated prompt: start from his lite code, not from scratch. The base is commit `30127c8` of
`Creovex/random-research`, branch `claude/clever-lamport-n7of0u`, still the newest commit there on 2026-09-30.
`skills/synergy-studio/` was copied whole and committed untouched (`lite L0: starting code from 30127c8`); the
updated LITE.md was committed next, keeping the "Changes made during the build" rows. Modules written earlier
from scratch are kept only on a local branch as reference and are not part of the build; their T1 evidence no
longer counts. The orchestrator read every file of the starting code and the owner's `code/synergy-studio/LITE.md`,
`README.md` and `state.md`, and mapped each LITE.md requirement to exists, change or new (kept in the ledger).
Branch files read: all of `skills/synergy-studio/` and those three documents.

## L2: setup, doctor and the baseline (on the starting code)

Worker: implementer A (sonnet) brought the tested `lib/setup.mjs`, `doctor.mjs`, `env.mjs`, `run.mjs`, `lock.mjs`,
`paths.mjs`, `doctor-fixtures/` and `requirements.lock` into the owner's code. `studio.mjs` changed only in the
setup and doctor dispatch, `env()` (through `loadEnv`, so a copied home is detected) and `hf()` (HyperFrames now runs
on the tool home's Node with `HOME=<home>/node/hf-home`, the browser, whisper, ffmpeg and ffprobe paths). The owner's
env.json key names are kept; new keys are added. A stale synctest result left by earlier code was removed from env.json.

### T1: PASS (orchestrator rerun, evidence T1-2026-09-30-4)
```
ℹ tests 27
ℹ pass 27
ℹ fail 0
tmp home "tmp/home test": 1/9 to 9/9 done, compiled in 19 s, real 76.94
doctor --full: exit=0, 13 lines PASS (runtime node v22.23.3, uv 0.12.21, python and kokoro, model hashes, ffmpeg 7.1,
ffprobe n4.4.1, arm64, hyperframes 0.8.92, Chrome for Testing 152.0.7977.30, whisper.cpp v1.9.4 with Metal,
free disk 16.8 GB, 60 fps render 1 s at 60/1 fps in 2.5 s, three.js render 1 s at 30/1 fps in 2.3 s)
1.6G	~/Documents/Claude Code/Synergy-Studio/tmp/home test
second setup: 1/9 to 9/9 "already done", real 5.56
falsifier (bin/ffprobe renamed): exit=2
FAIL ffprobe: missing at .../tmp/home test/bin/ffprobe. Fix: run setup again
default home: doctor --full exit=0, the same 13 lines PASS; 1.6G; second setup all "already done", real 5.66
```

### Baseline: the owner's three examples with the code as copied (evidence baseline/before, baseline/before2)
Script `ledger/evidence/baseline/run.sh`: copies each example to tmp, runs voice (or cut and a caption import for
footage-captions, with `reference/videos/onescan.mp4` as its clip), audio, render and check, then decodes frames at
1 s, the middle and the last second. All three pass `check` on this Mac:
```
hydration-tips:   h264 1080x1920 30/1, aac, 28.30 s (timeline 28.227), -14.3 LUFS, -1.5 dBTP, no black, nothing frozen; render real 12.22
three-product:    h264 1920x1080 30/1, aac, 7.50 s (timeline 7.432), -15 LUFS, -1.4 dBTP, no black, nothing frozen; render real 6.79
footage-captions: h264 1080x1920 30/1, aac, 13.10 s (timeline 13), -14.1 LUFS, -1.5 dBTP, no black, nothing frozen; render real 14.60
```
A second identical run gives byte identical frames and mix.wav for hydration-tips and three-product. footage-captions
frames differ slightly run to run (mean absolute difference 0.26 and 0.20 of 255 at 6.55 s and 12.1 s, 0 at 1 s), which
is the browser decoding the base video. Comparison rule for later changes, fixed before use: identical check lines and
mix.wav hashes; identical frames for the narrated and three.js examples; mean frame difference at most 1.0 for footage.
Noted: three-product measures -15 LUFS, at the edge of the ±1 band.

### Split of studio.mjs (implementer A, sonnet)
Every command moved into its own module under `scripts/lib/` (`new`, `budget`, `say`, `voice`, `audio`, `words`,
`compose`, `stills`, `render`, `check`, `cut`, `transcribe`, `beats`, `silences`, `scenes`, `reference`, with shared
helpers in `lib/common.mjs`); `studio.mjs` is a 42 line dispatcher. Help and every no argument message are byte
identical. Orchestrator rerun of the three examples against the baseline (evidence L2-split-compare), literal:
```
hydration-tips: check lines same; mix.wav same   (3 frames: mean abs diff 0.000)
three-product: check lines same; mix.wav same    (3 frames: mean abs diff 0.000)
footage-captions: check lines same; mix.wav same (frames 0.000, 0.204, 0.262; limit 1.0)
RESULT: PASS
```
Smoke test of the commands the examples do not run (evidence L2-split-smoke): `beats` 120.0 BPM on a generated
120 BPM click track (first downbeat 0.491 s: the click at 0 s is missed, the owner's known open item), `silences`
on c1 (speech pieces listed), `scenes` on cosmos.mp4 (11 shot changes), `reference` on motion-reel.mp4 (5 cuts,
average shot 2.5 s); all exit 0.
Research after T1: `research/whisper-model.md` (HyperFrames 0.8.92 runs whisper.cpp's `whisper-cli`; the model
`ggml-small.en.bin` is cached under `<home>/node/hf-home/.cache/hyperframes/whisper/models/`; manual fallback steps) and
`research/hyperframes-fps.md` (24, 25, 30 and 60 fps render exactly: 72, 75, 90 and 180 frames for 3 s).
L2: PASS.

## L3: reference material

Reference videos found in `~/Downloads` and confirmed by duration with the tool home's ffprobe: onescan 69.013 s
1280x720, haura 49.633 s 720x1280, motion-reel 15.061 s 1920x1080 60 fps, doodle-timeline 59.051 s 1080x1920,
cosmos 31.979 s 1280x720 24 fps; copied (not moved) to `reference/videos/`. Raw footage c1 to c4 copied as James mapped
them (c4 is his finished reel with captions burned in; he chose it knowingly). Four product photos copied to
`reference/assets/haura/`. Contact sheets (12 frames each) at `reference/breakdowns/sheets/`.
Breakdowns: five sonnet workers, one per video, `reference/breakdowns/<name>.md` (not committed). Measured loudness:
onescan −14.5 LUFS, haura −14.2, motion-reel −13.0, doodle-timeline −14.4, cosmos −13.9. The cosmos breakdown
names the character only as "a simple character" (checked by grep). Rubrics `test/rubrics/T10.md` to `T13.md` are frozen from here.
Disk: James approved deleting the stopped full build's tool home (5.6 GB); 19 GiB free after.
L3: PASS.

## L4: page, compose and sound (changes to the owner's modules)

Workers: implementer B (sonnet): `budget`, `compose`, `render`, `reference`, new `frames` and `synctest`, `template/lib.js`,
`test/lib-page.test.mjs`. Implementer C (sonnet): `voice`, `say`, `audio`, `words`, `beats` modules, `voice.py`, `audio.py`,
`tests/*.py`, `test/lib-sound.test.mjs`. Branch files read as ideas only: the local first pass branch. Orchestrator glue:
`frames` and `synctest` in the dispatcher and help; compose copies and links `src/look.css` when it exists; doctor fails a
stored synctest result that did not pass.
Changes: compose gives every lint rule its own message and refuses unknown project.json fields; an unparsable HyperFrames
lint output is reported; compose writes the bundled `@font-face` rules into the page, because HyperFrames 0.8.92 only reads
rules in the page itself and otherwise fetched Manrope from Google Fonts (seen in the baseline logs: "Fetched 7 font
face(s) for Manrope from Google Fonts"); render passes `--fps`, takes the heavy lock, normalises loudness in two linear
passes and saves `out/captions.json` read from the page with the tool home's browser; `captions({style})` gives `color`,
`pop` and `box` and records every group in `window.__SS.captions`; `frames` shares its sheet code with `reference`;
`synctest` (7.9 B) runs through compose and render; voices outside the ten of 7.4 are refused; pause defaults by aspect;
ducking under a user song about 8 dB; plain errors for bad project.json, unknown music, speed out of range, a missing
voice.wav, bad or repeated scene ids.
Independent verifier of the sound part (sonnet, behaviour only): all 12 behaviour items PASS; its findings on raw stack
traces were fixed by C.

Orchestrator reruns (evidence T2-2026-09-30-1, L4-suites, L4-compare, L4-setup-synctest), literal excerpts:
```
node --test test/lib-page.test.mjs: 19 lint fixtures each "compose refuses <rule> with its own message", "compose refuses
an unknown project.json field", "a clean page composes (falsifier for the lint rules)" ... ℹ tests 29 ℹ pass 29 ℹ fail 0
node --test test/lib-sound.test.mjs test/lib-setup.test.mjs: ℹ tests 44 ℹ pass 44 ℹ fail 0
pytest tests: 56 passed in 5.44s
synctest:  pair 1: flash 2.000 s, beep 2.000 s, offset 0 ms (pairs 2 and 3 the same)
PASS  synctest: every flash and beep within one frame (33.3 ms), mean offset 0 ms   exit=0
synctest --beep-offset 3 (falsifier): offsets +100 ms; FAIL ... exit=2
setup (stored synctest removed first) ends with: PASS synctest: picture and sound line up   exit=0
```
Baseline comparison after L4: frames identical (footage within its run to run noise, 0.207 and 0.260); only loudness and
true peak lines changed, all toward the target: hydration-tips -14.3 to -14 LUFS, three-product -15 to -14.1 LUFS,
footage-captions -14.1 to -14 LUFS. No render log names fonts.googleapis.com or fonts.gstatic.com (grep count 0 each).
The L4 renders are the new baseline (`baseline/after-L4`).
T2: PASS. L4: PASS.

## L5: footage, look, checks and the test harness

Workers (all sonnet): implementer D (`import` new; `cut` with `crop_x`, the 7.9 C warning and frame exact clips; `transcribe`
with the heavy lock, the whisper check, plain errors and onset snapping in `lib/wordsnap.mjs`; `check` with frame rate,
audio against mix and captions lines and `kind: hyperframes`; `scripts/syncaudio.py`), implementer E (`look` new, `look.py`,
`template/look-card.html`), implementer I (`test/harness/`: captions coverage, caption band difference, late audio clip,
late beep synctest, 3 frame delayed MP4, crop_x 0 variant, 30 fps conversion, T4 fixture and scorer, T6 determinism,
T0 contract script). Independent verifiers for B's, D's and E's parts (sonnet, behaviour only; their scripts are kept in the
ledger). Defects they found and that were fixed: `cut` dropped one frame per clip (picture drifted up to 3 frames ahead of
the sound); `check` passed an MP4 whose audio stopped 2 s early; muted MP4 lines printed NaN; clip paths resolved against
the current folder; `caption_fixes` keys with spaces did nothing (the owner's footage example uses one); `pop` captions lost
their spacing; `/* */` comments were linted; `look` read grain on hard colour edges and let card contrast fall under 4.5.
Orchestrator glue: `import` and `look` in the dispatcher; `stills` keeps look cards and the source sheet across the
HyperFrames snapshot, which empties its output folder.
First transcription on this Mac: HyperFrames downloaded `ggml-small.en.bin` (487,614,201 bytes) from huggingface.co in
about 51 s; the manual fallback was not needed.

Orchestrator reruns (evidence T0, T3, T4, T6, T7s, L5-suites, L5-compare), literal excerpts:
```
T0  t0-contract.mjs reference/lite-branch/skills/synergy-studio --run: 109 items: 109 PASS, 0 FAIL  exit=0
    falsifier: PASS falsifier: text with an added line "run `studio fly <dir>`" fails on `studio fly`
T3  cut: src/assets/base.mp4 (1080x1920, 15.17 s ...); transcribe: transcript.json written (31 words)
    So,@0.22 if@0.44 you@0.71 love@0.97 smelling@1.43 good,@2.32 follow@3.17 Hara@3.82 Sense@4.31 and@5.04 ...
    falsifier: ERROR: empty.wav has no sound in it (it is empty, 0 seconds long), so there is nothing to transcribe. exit=1
T4  attempt 1: PASS median onset error: 31 ms; FAIL 95th percentile onset error: 345 ms (need at most 200 ms)
    attempt 2: PASS median onset error: 4 ms (need at most 80 ms)
               PASS 95th percentile onset error: 6 ms (need at most 200 ms); 0 word(s) missing
    falsifier: evenly spaced timings: median error 257 ms, 95th percentile 517 ms: the scorer rejects them
T6  PASS sketch page rendered twice (rng 1): identical x3; PASS falsifier: rng 2: 3 of 3 frames differ;
    PASS hydration-tips rendered twice: frames at 1, 14.114, 27.227 s: identical x3
T7s PASS synctest ... mean offset 0 ms; falsifier --beep-offset 3: exit=2
    cut on a clip whose audio starts 0.176 s late (0.2 s asked; AAC padding): "warning: ... the audio starts 0.176 s
    after the picture ..." with an -itsoffset fix; cut on the clean clip: no warning
suites: node --test test/*.test.mjs: ℹ tests 136 ℹ pass 136 ℹ fail 0; pytest tests: 111 passed in 10.20s
```
Examples against the L4 baseline: all check lines PASS, including the new frame rate, audio against mix (lag 0 ms,
correlation 0.997 to 0.999) and captions (35 of 35 words) lines; frames identical for hydration-tips and three-product;
footage-captions at 12.1 s differs by 1.97 (limit 1.0): the same picture shifted by the frame exact cut fix (inspected
side by side), accepted as the corrected result. `baseline/after-L5` is the new baseline.
Gap named: T4's onset snapping was developed with the T4 fixture in view; real speech has no ground truth here.
T0, T3, T4, T6, T7s: PASS. L5: PASS.

## Merge of the owner's commit 3543ba7 (base 30127c8)

The owner's branch moved during L5 to `3543ba7` ("close open items: captions setup + doctor, beat at 0 s"). Three way
merge with `30127c8` as the ancestor: `beats.py` taken whole (a beat right at 0 s is kept; our copy was unchanged);
his captions setup merged into our split modules by implementer A (setup step 8 fetches `ggml-small.en.bin`, pinned by
size 487614201 and SHA-256 `c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d`, non fatal on failure;
`setup --whisper-model <file>` installs a model downloaded elsewhere; doctor shows `whisper model` as PASS or WARN) and
his transcribe hints by implementer D (the failure names the missing program or model). Kept ours where both changed:
whisper-cli is built from source inside the tool home, and nothing ever runs or suggests brew. His SKILL.md and
references changes are taken in at L7. His LITE.md change records closed items only.
Retests (evidence L5-merge-beats, T1-2026-09-30-5):
```
pytest tests/test_beats.py: 6 passed; beats on a 120 BPM click track with a click at 0 s: first beats [0.0, 0.491, 0.991, 1.491]
T1: ℹ tests 29 ℹ pass 29; tmp home "tmp/home test": 1/10 to 10/10 done, real 126.72 (includes the Whisper model download
and the synctest at the end); doctor --full exit=0, every line PASS incl. "PASS whisper model: ..." and "PASS synctest:
last result: mean offset 0 ms"; 2.1G; second setup all 10 "already done", real 6.56; ffprobe falsifier exit=2;
default home: doctor --full exit=0 all PASS; second setup all "already done"
```
The base is now `3543ba7`.

## L6: MCP server, examples and packaging

Workers (sonnet): implementer F (`mcp/*.mjs` zero dependency server with 35 tools, jobs in the tool home, resources and
prompts; `.claude-plugin/plugin.json` and `marketplace.json`, `.mcp.json`, `bundle/manifest.json`, `scripts/pack-bundle.mjs`,
root `package.json` with dev dependencies `@anthropic-ai/mcpb` 2.1.2 and `@modelcontextprotocol/sdk` 1.31.0,
`test/mcp.test.mjs`, `test/harness/t15-mcp-end-to-end.mjs`), implementer G (`examples/footage-captions` adapted to a
narrated 16:9 clip: clip ranges, `caption_fixes` {"one scan": "OneScan"}, tags that fit the narration; examples README;
`test/harness/t5-examples.mjs`), implementer D (defects found by G: Whisper small.en degenerated on a joined cut of two
clips, "media." for 13 s, with or without `clean_voice`; `transcribe` now sends each clip of the cut separately and a word
never starts before its clip; "Every" moved from 6.78 s to 7.9 s, after the cut at 7.8 s). Tools added beyond the 8.2
table: `studio_reference_study` (the CLI `reference` command), and inputs `card`, `out`, `whisper_model`, `beep_offset`.
Hyphenated CLI flags become snake case inputs. The reference clone now sits at the base `3543ba7` for T0.

Orchestrator reruns (evidence T14, T15, T17, T5, T0-2, T3-2, T4-3), literal excerpts:
```
T14 initialize round trip incl. process start: 74 ms; 15 tests: empty tool home (8), falsifier "a server with one tool
    removed: the tool list assertion fails", installed home (6 incl. "import, refusals, lint, render job and check",
    "studio_export copies only the five allowed items"); ℹ tests 15 ℹ pass 15 ℹ fail 0
T15 20 MCP calls in the default homes; check lines all PASS (h264 1080x1920 30/1, 30 fps, aac, 28.30 s, -14 LUFS,
    -1.7 dBTP, no black, nothing frozen, audio against mix lag 0 ms correlation 0.999); T15 PASS  exit=0
T17 mcpb validate manifest.json: Manifest schema validation passes!; bundle 232424 bytes, 84 files; unpacked server
    answered initialize and lists 35 tools; paths with node_modules, tmp, reference, ledger or test: 0
T5  hydration-tips 9 lines PASS, three-product 9 lines PASS, footage-captions 10 lines PASS (captions: 31 transcript
    words all in out/captions.json), falsifier: removed id "s1"; compose exit 1; data-start message present; exit=0
T0  against the owner's text at 3543ba7: 110 items: 110 PASS, 0 FAIL; falsifier fails on studio fly
T3  rerun: 31 words for c1 (So,@0.275 if@0.44 you@0.71 ...); empty WAV: plain error, exit=1
T4  rerun: median onset error 4 ms, 95th percentile 6 ms; exit=0
```
Not proven here: the bundle opened in Claude Desktop (T18, James) and the plugin inside Claude Code (L8).
T5, T14, T15, T17: PASS. L6: PASS.

## L7: the skill text

The owner's SKILL.md and references were taken in unchanged at `3543ba7` first (commit "the owner's skill text taken in").
Writer H (sonnet) then applied LITE.md section 9: his four wording corrections (compatibility, step 0, where projects live,
older projects), the sweep of every `studio <command>` to its tool, `references/commands.md` as the tool reference, new
`references/mcp.md` (tools, jobs, images, path rules, Claude Desktop limits) and `references/styles.md` (built in looks, a
look from words and from a reference, the sketch kit with hard cuts, drawing on twos at 24 fps, particles, 60 fps, caption
styles; every snippet rendered once with stills, render and check before it was written in), the non interactive rule,
and the writing rules. Instructions no tool can carry out were rewritten or removed: ffmpeg frame grabs (now `studio_frames`),
numpy score scripts (now the user's track or a generated bed), a Playwright troubleshooting row, links to other repositories.
Fresh reader check (LITE 9 item 8), two rounds with new sonnet workers that never saw the build:
round 1: UNMAPPED INSTRUCTIONS: 2 (examples only reachable as MCP resources; generator tools of another server named as if
ours). Fixed: new tool `studio_example` (implementer F; files under examples/ and template/), text fixes by H; `studio_say`
returns an absolute path, `studio_open` also the share copy. Round 2: "UNMAPPED INSTRUCTIONS: 0", "none".
Orchestrator glue: the film starter's music is the generated "warm" bed (it pointed at a missing score.wav).
NOTICE.md written by a sonnet worker from the installed licence files and official pages. James decided on the licences:
"Proceed as is (Recommended)" (GPL eSpeak NG and phonemizer in the voice process, GPL ffmpeg as a separate program, GSAP's
no charge licence; the repo and the bundle redistribute none of them).

Orchestrator reruns (evidence L7-checks-2026-09-30-1 and -2), literal:
```
dash grep count 0; version grep count 0
grep "studio [a-z]": references/mcp.md:6 (the one sentence that explains the old naming)
T0 --tools on the adopted text: 81 items: 81 PASS, 0 FAIL; falsifier fails on studio fly
T14: ✔ studio_guide equals SKILL.md with the skill folder resolved; ℹ tests 16 ℹ pass 16 ℹ fail 0
T17: Manifest schema validation passes!; smoke test: the unpacked server answered initialize and lists 36 tools;
     size: 251886 bytes, 86 files
```
T0, T14, T17: PASS. L7: PASS.

## L8: Claude Code live

Install (commands from `research/claude-code-plugins.md`), literal:
```
$ claude plugin marketplace add "<repo>" --scope user
Adding marketplace…✔ Successfully added marketplace: synergy-local (declared in user settings)
$ claude plugin install synergy-studio@synergy-local --scope user
Installing plugin "synergy-studio@synergy-local"...✔ Successfully installed plugin: synergy-studio@synergy-local (scope: user)
```
The installed plugin's tools are named `mcp__plugin_synergy-studio_synergy-studio__<tool>` (recorded from the session init:
36 tools, server `plugin:synergy-studio:synergy-studio` connected). Claude Code copies a folder marketplace into its plugin
cache, so a code change needs a reinstall.
Runs: `claude -p "<prompt>" --model sonnet --allowedTools "mcp__plugin_synergy-studio_synergy-studio__*" --disallowedTools
"Bash,Edit,Write" --permission-mode dontAsk --output-format stream-json --verbose --max-turns 120`; the orchestrator then ran
`check` on each project itself (evidence T16, T16b):
```
T16  "Use Synergy Studio to make a 15 second 9:16 video about drinking water before coffee"
     first studio calls: studio_guide, studio_doctor, studio_project_new ...; calls to Bash, Edit or Write: 0; 38 turns
     check: 10 lines PASS (h264 1080x1920 30/1, 30 fps, aac, 14.20 s, target 15 s, -14 LUFS, -1.5 dBTP, no black,
     nothing frozen, audio against mix lag 0 ms correlation 0.999) exit=0
     falsifier, plugin disabled: init synergy tools 0; "I haven't made the video yet"; MP4 files before=2 after=2
T16b "Use Synergy Studio to improve this video: add word captions and an end card" (raw clip c1)
     studio_guide first; studio_project_import, studio_transcribe, studio_cut, studio_audio, studio_stills, studio_render,
     studio_check, studio_open; calls to Bash, Edit or Write: 0; 36 turns
     check: 11 lines PASS incl. "captions: 31 transcript words all in out/captions.json" exit=0; the final sheet shows
     word captions and an end card
```
T16, T16b: PASS. L8: PASS.

## L9: the video tests (T7 to T13)

Builds ran headless in Claude Code with only the plugin's tools, from a folder outside the repo:
`claude -p "<prompt>" --model sonnet|opus --allowedTools "mcp__plugin_synergy-studio_synergy-studio__*" --disallowedTools
"Bash,Edit,Write" --permission-mode dontAsk --output-format stream-json --verbose --max-turns 150`. Every build logged 0
calls to Bash, Edit or Write. After each build the orchestrator ran `check` and the harness itself; a fresh sonnet
worker then judged the stills against `references/review.md` or the frozen rubric, never the builder. A test got at most
three judged rounds; the third round of T7 and T8 was built with the orchestrator's model (opus), as the prompt allows.

T7, HAURA reel from the raw clips c1 to c4 and the four product photos (round 3, opus; evidence T7-2026-09-30-3):
```
PASS  duration: 41.60 s (timeline 41.5 s ± 0.15 s)
PASS  audio against mix: lag 0 ms (0 frames), correlation 0.999; last 2 s match; no silent stretch where the mix has sound
PASS  captions: 87 transcript words all in out/captions.json; earliest highlight 0 ms before its word (max 150)
exit=0      (11 lines PASS)   captions coverage 93.0%; caption band difference 19.33
falsifiers: captions removed -> coverage FAIL; audio delayed 3 frames -> check exit 2
judge round 3: VERDICT: PASS (rounds 1 and 2 FAIL: small text, name tag, chips not shown)
```
T8, OneScan 16:9 explainer cut down to 9:16 (round 3, opus; evidence T8-2026-09-30-3):
```
PASS  captions: 68 transcript words all in out/captions.json; earliest highlight 0 ms before its word (max 150)
exit=0      (11 lines PASS)   captions coverage 98.6%
judge round 3: VERDICT: PASS; Task 2 (no on screen text or key object cut off) TRUE; craft item 16 FALSE with its reason
falsifier crop_x 0 on every clip, stills at the build's own 22 times: VERDICT: TEXT CUT OFF (COUNTERFEIT, MANUFACTURER,
the scan phone, the chips); with only the 6 default times it saw nothing cut off, so that run is not counted
```
T9 explainer (3-2-1 backup rule, 53.4 s): check 10 lines PASS, exit=0; judge PASS (every guard rail TRUE or N/A with a reason).
T10 motion reel from `motion-reel.mp4` at 60 fps (round 2): check PASS; `converted copy: check exit 2; frame rate: FAIL 30 fps
(project fps 60)`; judge: palette 5, type 4, generative 5, overlay 5, pace 5, overall 5, no copied text TRUE (round 1 FAIL:
copied words).
T11 doodle stills from `doodle-timeline.mp4` (round 2): line 4, paper 5, palette 5, lettering 5, devices 5, draw on 5, overall 5,
original TRUE. The handwritten font (Caveat, OFL) was given as a user file, because the bundled fonts have no handwritten face.
T12 style from the cosmos breakdown text only: check 10 lines PASS; ink 5, paper 5, boil 4, walk 4, zoom 5, cosmic 5, overall
4; not a known character TRUE.
T13 `look --from` on each of the five references: every look composes; palette and texture scores per round (onescan,
haura, motion, doodle, cosmos): round 1 5/4, 5/4, 5/4, 5/4, 5/3; round 2 5/2, 5/4, 4/2, 5/4, 4/3; round 3 5/5, 5/4, 5/4,
5/3, 5/4. Every reference reached 4 or more on both items in some round, never all five in one round: BLOCKED after three
rounds. The orchestrator changed `look` between rounds (texture read over time, glow negatives, a card with two panes for a
reference with a light and a dark world, paper and grain overlays drawn from the look's own markup); `node --test` and pytest
cover the changes.

Named gaps from L9: the T13 falsifier judge was not blind (the frozen rubric states the expected score); the T8 round 3
judge cited five frames without opening them; the judged videos were rendered before the L10 render change.
L9: T7, T8, T9, T10, T11, T12 PASS; T13 BLOCKED.

## L10: the owner's newest code, retests and the final report

Branch check at L10: `claude/clever-lamport-n7of0u` moved from 3543ba7 to 7ba5f25 (three media commits). Skill changes
in them: `studio render` takes the final audio from the lossless mix with a limiter at 4x oversampling, and a
troubleshooting row. Both adopted: `lib/render.mjs` keeps our measured two pass loudnorm and adds the mix and the limiter.
First attempt FAIL (evidence L10-render-2026-09-30-1): `audio against mix: ... the sound in the video ends 0.07 s before the
picture does`, because loudnorm shifts timestamps and the trim came after it; the trim now comes first in the chain.

T6 then failed on the committed render as well as the new one (`hydration-tips rendered twice: frames at 1, 14.114,
27.227 s: DIFFERENT, DIFFERENT, identical`). Cause: HyperFrames keeps a hidden per install breaker
(`deParallelRouterTrialFired` in its config) that switches parallel drawElement capture off for good after one render falls
back; its screenshot capture then differs between renders (mean 0.05 of 255 on moving edges). `hf()` now keeps
`HF_DE_PARALLEL_ROUTER=true` unless the user set it; a page that cannot be routed still falls back for that render only.
Final code, literal (evidence L10-render-2026-09-30-3, L10-final-2026-09-30-1):
```
PASS  sketch page rendered twice (rng 1): frames at 1, 1.5, 2 s: identical, identical, identical
PASS  falsifier: the sketch page with rng 2: 3 of 3 frames differ from the rng 1 render (at least 1 required)
PASS  hydration-tips rendered twice: frames at 1, 14.114, 27.227 s: identical, identical, identical
ℹ tests 160   ℹ pass 160   ℹ fail 0                       (node --test test/*.test.mjs)
125 passed in 32.90s                                         (pytest tests)
PASS  hydration-tips / three-product / footage-captions check: 0 failing, exit 0; PASS falsifier   (T5)
T15 PASS: 20 MCP calls; check: true peak -3 dBTP, audio against mix lag 0 ms, correlation 0.987
81 items: 81 PASS, 0 FAIL                                    (T0 with the tools list)
Manifest schema validation passes!  smoke test: the unpacked server answered initialize and lists 36 tools
size: 258148 bytes, 86 files                                 (T17)
```

## Final report

Workers and models: orchestrator Opus 5.5 (plan, ledger, every test run and all evidence, the T13 look changes, the L10
render port); research workers, breakdown workers, implementers A to G, writer H, the NOTICE writer, the fresh readers and
the behaviour verifiers were sonnet; every judge was a fresh sonnet worker; the headless builds of T7 to T12, T16 and T16b
used sonnet, and the third rounds of T7 and T8 used opus.

| Test | Result | Literal proof (evidence in the ledger) |
|---|---|---|
| T0 | PASS | `110 items: 110 PASS, 0 FAIL` (owner's text at 3543ba7); `81 items: 81 PASS, 0 FAIL` (adopted text with the tools list); falsifier `fails on studio fly` |
| T1 | PASS | `PASS runtime node: v22.23.3`, `PASS uv: 0.12.21`, `PASS python and kokoro: Python 3.11.16 kokoro-onnx 0.6.1`, `PASS model hashes: kokoro-v1.0.int8.onnx 6e742170d309`; ffprobe falsifier exit 2 |
| T2 | PASS | `ℹ tests 29 ℹ pass 29 ℹ fail 0` (one fixture per page rule, each refused with its own message) |
| T3 | PASS | `transcript.json written (31 words)`; empty WAV exit 1 with a plain message |
| T4 | PASS | `PASS  median onset error: 4 ms (need at most 80 ms)`, `PASS  95th percentile onset error: 6 ms (need at most 200 ms); 0 word(s) missing` (attempt 1 FAIL at 345 ms) |
| T5 | PASS | `PASS  hydration-tips check: 9 lines, 0 failing, exit 0` and the same for three-product and footage-captions; `PASS  falsifier compose fails` |
| T6 | PASS | `PASS  hydration-tips rendered twice: frames at 1, 14.114, 27.227 s: identical, identical, identical`; rng 2 falsifier differs 3 of 3 |
| T7 | PASS | 11 check lines PASS, `captions: 87 transcript words all in out/captions.json`, coverage 93.0%, band 19.33; judge round 3 `VERDICT: PASS` |
| T7s | PASS | `PASS  synctest: every flash and beep within one frame (33.3 ms), mean offset 0 ms`; falsifier exit 2; `warning: ... the audio starts 0.176 s after the picture` |
| T8 | PASS | 11 check lines PASS, coverage 98.6%; judge round 3 `VERDICT: PASS`; crop_x 0 falsifier `VERDICT: TEXT CUT OFF` |
| T9 | PASS | 10 check lines PASS, exit=0; judge PASS |
| T10 | PASS | check PASS at 60 fps; `converted copy: check exit 2; frame rate: FAIL 30 fps (project fps 60)`; rubric overall 5, no copied text TRUE |
| T11 | PASS | rubric line 4, paper 5, palette 5, lettering 5, devices 5, draw on 5, overall 5; original TRUE |
| T12 | PASS | 10 check lines PASS; rubric overall 4; not a known character TRUE |
| T13 | BLOCKED | round 3 palette/texture 5/5, 5/4, 5/4, 5/3, 5/4: doodle-timeline texture 3 |
| T14 | PASS | `✔ studio_guide equals SKILL.md with the skill folder resolved`, `ℹ tests 16 ℹ pass 16 ℹ fail 0` |
| T15 | PASS | `T15 PASS: 20 MCP calls`, every check line PASS |
| T16 | PASS | calls to Bash, Edit or Write: `0`; check 10 lines PASS; falsifier with the plugin disabled: `synergy tools 0`, no MP4 |
| T16b | PASS | calls to Bash, Edit or Write: `0`; `PASS  captions: 31 transcript words all in out/captions.json`, exit=0 |
| T17 | PASS | `Manifest schema validation passes!`, `lists 36 tools`, `size: 258148 bytes, 86 files` |
| T18 | PENDING | James's test in Claude Desktop |

The lite gate is met except T13 and T18, which await James's written acceptance:
- T13, BLOCKED after three judged rounds. What would close it: one round in which all five look cards score 4 or more
  on palette and texture (the last round failed only on doodle-timeline texture 3). Who: James may accept it as is or allow
  a fourth round.
- T18, PENDING. What would close it: James installs `dist/synergy-studio.mcpb` in Claude Desktop, follows README "Owner's
  test in Claude Desktop" and reports that both MP4s play. Who: James.

Not checked: Windows and Linux; rendering with the network off; voices other than the ten listed; videos longer than 90 s;
the README's GitHub install line before the push (it is run after the push and reported in the last message); the judged
videos of T7 to T12, T16 and T16b were rendered before the L10 render change and not rendered again (T5, T6 and T15 prove
the new render); determinism of a page HyperFrames cannot route to parallel capture (screenshot capture differed between
renders of hydration-tips); captions on continuous speech have no ground truth (T4 uses isolated words, and its snapping
was developed with that fixture in view); the T13 falsifier judge was not blind; the T8 round 3 judge cited five frames
without opening them; c4 has captions burned in; after L10 the audio runs about 0.07 s past the picture (inside the 0.15 s
tolerance).

**Largest gap:** the judged tests rest on stills read by a model, not on a person watching the videos: T7 to T13 passed or
failed on a sonnet judge's reading of contact sheets, and T18, the only test where James watches the result in Claude
Desktop, has not run.

Sizes: tool home 2.0 GB (`du -sh`); tracked files 2016 KB; `.git` 2.6 MB before the final commit.

## L11: Claude Desktop in use, voice and sound checks, studio_inspect, and the owner's 4c18ddf

After the push, James ran the bundle in Claude Desktop and Cowork. What that showed, and what was done (evidence in the
ledger; every item measured before and after, then attacked by an independent verifier):

- **Prompts refused in Desktop.** Its log: `Extension Synergy Studio attempted undeclared prompt: new-video`. The bundle's
  manifest now declares both prompts from the same text the server uses; Desktop then logged `content matches declared template`.
- **Every job tool failed in Desktop and Cowork.** Desktop runs the server inside its own app, where the program running
  it is the Claude app, which cannot run a script; each job's runner never started and the call failed after the 15 s
  start grace (three calls of 15.08 s in Desktop's log). Jobs now always run on the tool home's own Node. After the fix,
  James's AllSpace video went through voice, audio, stills, render and check in Desktop with no error.
- **Logs.** `server.log` now has one line per call (tool, ms, ok or ERROR and the first line of the error), names the
  program that runs each job, logs a runner that fails to start, keeps failed job records, and tags every line with the
  process and the client (`[7140 claude-code]`, `[6589 t14]`), so a Desktop chat, a build and a test run are told apart.
- **Delivery.** `studio_open` can play the MP4 (`show: "player"`), show it in Finder or copy it to a folder (`save_to`,
  never over a file), and returns the final sheet; the chat cannot play a video.
- **Voice and sound checks** (ARCHITECTURE.md had them; LITE.md had dropped them without naming the gap). `speech.py`
  gives abbreviations their spoken form (`2 a.m.` was heard back as `2A, M.`; now `2 AM`), warns about text the voice
  misreads and finds pauses over 0.75 s inside a line; `lib/listen.mjs` has Whisper hear every line back and compares
  it word by word; `studio_audio` measures music against the voice and every effect against the voice (the default pop
  sat 4.8 dB over the voice and was lowered); `studio_check` shows `voice heard back` and `sound balance` as PASS or WARN.
- **studio_inspect.** One picture of a stretch of the video: frames, scenes, the voice level with the words heard, music,
  effects, cues and the finished level on one time axis, warnings in red, and the same timeline as text.
- **Voice crash at exit.** Seen once in about 58 runs (`recursive_mutex lock failed` after every file was written);
  not reproduced on demand (0 of 54). `voice.py` now writes a marker with the run's id as its last act and the step
  accepts a crash only after it; proven with forced crashes before and after the marker.
- **The owner's 7ba5f25..4c18ddf**, ported by three workers with one owner per file (plan in the ledger):
  self-correcting loudness (own peaky score, crest 20.5 dB: before -15.8 LUFS, after -14.0; narrated and songs equal),
  the cue sheet (`CUE` in the page, `studio_cues`, cue stills at -4, 0 and +6 frames, `sync <cue>` lines in check with
  a falsifier that fails a hit moved 3 frames), the bundled starter score (`studio_score`, deterministic, sets the
  music), the text (pitch cheap, block before drawing, KEEP/CUT/WHY, director rules) and brand colour roles with a
  measured check (`studio_brand_check`: all blue 97% FLOODED, a blue mascot on cream 1% ACCENT). The tools never run
  code a model wrote, so in Claude Desktop a real score is the user's track (named gap).
- **Independent verifier** (behaviour only, its own script): round 1 72 PASS, 9 FAIL with defects D1 to D10; all fixed
  by their owners; round 2 77 PASS, 5 FAIL, where the 5 are two named gaps, music at -73 dBFS now kept silent by
  design (documented) and a probe that misread a correct refusal. A fresh reader answered all ten questions from the
  text; six contradictions it found were fixed, the older ones are listed for James.

Full pass on the final code (ledger/evidence/L12-full-2026-09-30-1.txt), literal:
```
ℹ tests 242  ℹ pass 242  ℹ fail 0          199 passed (pytest)          86 items: 86 PASS, 0 FAIL (T0, 40 tools)
PASS  median onset error: 4 ms              PASS  synctest: every flash and beep within one frame, mean offset 1 ms
PASS  hydration-tips / three-product / footage-captions, PASS falsifier (T5)
PASS  hydration-tips rendered twice: frames at 1, 14.066, 27.133 s: identical, identical, identical (T6)
T15 PASS: 20 MCP calls                      smoke test: the unpacked server answered initialize and lists 40 tools (T17)
```
Two headless Sonnet builds with only the plugin's tools and the old installed plugin disabled: a wordless film (door
slam at 6 s, bell at 10 s) and a narrated ad (Dr. Lee, Main St., 8 a.m. to 6 p.m., 30% off, a brand colour). 0 tool
errors; the orchestrator's own check: film `sync slam: 6.00 s: audio +0.005 s`, `sync bell: 10.00 s: audio +0.000 s`;
ad `voice heard back: 3 of 3 line(s) heard back as written`, `sound balance: music 6.7 dB under the voice`, brand
4 of 4 ACCENT. Server log for the two builds: 56 calls, 56 ok, 0 errors; every job on the tool home's Node.

Named gaps from this round: thresholds (0.75 s, 6 dB, 3 dB) rest on few projects; Whisper can mishear a name (WARN, not
FAIL); tone and emotion are not judged; a cue typed as a whole number in the page is not caught; on the starter score a
cue 0.2 s from its hit can still pass sync; the starter's hits are placeholders (a soft bump, not a slam); no per
effect gain; Claude Desktop itself was used by James, not by the builder (T18 stays PENDING until he reports).

## Final report (updated after L11)

The per test proof table of the first final report above still stands, with these updates from L11: T0 86 items all
PASS with the 40 tool list; T5, T6, T15 and T17 rerun on the final code and PASS; node 242 and pytest 199 tests pass.
Every test from T0 to T17 with T7s and T16b is PASS, except:
- T13, BLOCKED after three rounds: awaiting James's written acceptance, or his permission for a fourth round.
- T18, PENDING: James installs `dist/synergy-studio.mcpb` in Claude Desktop and reports. His first uses found the
  prompt and job failures fixed in L11; the rebuilt bundle has not yet been through his test.
Largest gap: the videos are judged by measurements and by a model reading stills, not by a person watching and
listening; T18 is where James does that, and it has not finished.

## L12 plan: precise music with real instruments (written before the build)

**Found first.** The cue sheet (`cues`, `CUE` in the page), cue stills, per cue sync lines in `check`, the self correcting
loudness loop and the typed cue warning already exist (L11). `studio score` runs only the bundled numpy starter
(`template/score.py`): a pad and a placeholder hit per cue. The mix is built mono at 24 kHz, which loses everything above
12 kHz. Setup installs Python packages from a hashed lock (`--require-hashes`); tinysoundfont declares `pyaudio`, which
must stay out of it.

**Files.**
- `scripts/score_file.py` (new): validates `src/score.json`, solves the tempo from anchors (refused beyond `max_stretch`,
  naming the tempo that would be needed), compiles grids, notes, chords, bends and hits to note events. No audio.
- `scripts/instruments.py` (new): finds the SoundFont, checks every preset with `sfpreset_name`, renders the events with
  tinysoundfont in chunks between event times (note offs before note ons), 2 s tail, synth gain -8 dB, per channel
  `pitchbend_range`, a seeded noise convolution reverb (kick and bass dry), the report, and the preset listing.
- `scripts/audio.py`: when `src/score.json` exists it renders the score with the timing it has just computed and mixes it
  as a stem at 48 kHz stereo (ducked under the voice like the bed). A score replaces a generated bed (`warm`, `calm`,
  `upbeat`); it layers on a song file (`music: {file}`), with a warning when it also has pitched tracks. Projects without
  a score keep their exact bytes. `--timing-only` writes timing and stops (for `studio score`).
- `scripts/lib/score.mjs`: with `src/score.json`, validates and renders it and prints the report; without it, the starter
  as today. New `scripts/lib/sounds.mjs`: `studio sounds [--font f]` lists the installed font's presets and kits.
- `scripts/lib/setup.mjs`, `paths.mjs`, `doctor.mjs`, `requirements.lock`: tinysoundfont 0.3.7 resolved with uv with
  `pyaudio` excluded; MuseScore General Lite downloaded into `<home>/soundfonts/` with its SHA-256 pinned after the first
  download; `setup --soundfont <file>`; one doctor line `instruments` (PASS or FAIL).
- MCP: `studio_score` (new description, same input), `studio_sounds {font?}`; the music skill reachable through
  `studio_reference` and resources. `skills/music-for-picture/` installed from the owner's repository, tool names adapted.
- Text: `voice-and-audio.md` (engine choice and the score file), `commands.md`, `SKILL.md` build step, `mcp.md`, `NOTICE.md`,
  `LITE.md` changes table.

**project.json:** no change; the score is a file under `src/`, which Claude Desktop may write.

**Anchor and hit names:** seconds, `cue:<name>`, `<scene>.<event>`, `<scene>.start`, `<scene>.end`; anything else is an
error that lists the names that exist.

**Tests (thresholds fixed here, before the first run).**
1. Timing: a note at 2.000 s, first sample above -60 dBFS never before 2.000 s and within 5 ms for percussive presets;
   16 kicks in a bar, offsets equal within 0.1 ms. Falsifier: a renderer stepping in fixed 512 sample blocks fails.
2. Anchors: bar 1 at 0.5 s and bar 9 at 19.0 s at 104 BPM solve to 103.78 BPM (±0.01), bar 9 at 19.000 s ±1 sample.
   Falsifier: anchors needing a 50% stretch are refused.
3. Determinism: two renders byte identical. Falsifier: another seed differs.
4. Validation: unknown drum, grid not 16 steps, unknown chord, unknown anchor name, missing preset, no SoundFont: each
   refused with a message that names the fix.
5. Integration through MCP calls: a 15 to 20 s film with an Afrobeats score, bar 5 anchored to a scene event, an
   `impact` on another event; new, score, audio, stills, render, check; every check line PASS; the impact's onset in the
   MP4 within 1 frame of its event (measured).
6. Regression: the three examples and a film with the starter score give the same `timing.json`, `mix_raw.wav` and
   `mix.wav` bytes as the code at 8b279e1, and still render and pass `check`.
7. Loudness: a score of heavy hits renders at -14 ±1 LUFS with true peak <= -1 dBTP. If the limiter takes more than
   6 dB, a master bus for scores is built and the test repeated.
8. Claude with the plugin only: "a 20 s warm product video with Afrobeats music" should produce `src/score.json`;
   "a 10 s calm background clip" may use the bed. Recorded as observed.

## L12: precise music with real instruments

Claude writes the music as data in `src/score.json` (the music-for-picture skill's score format); `studio_score` checks
it, solves the tempo from its anchors and plays it on a General MIDI SoundFont with tinysoundfont 0.3.7 (MIT); `audio`
mixes it at 48 kHz stereo through a gentle bus compressor, ducked under the voice, in place of a generated bed. The
plan above was written before the build. Workers: A (Sonnet) setup, doctor and `studio sounds`; V (Sonnet, fresh,
behaviour only) the verifier; a reviewer (Opus, read only). Everything else and every recheck: the orchestrator.

**Changed files.** New: `skills/synergy-studio/scripts/score_file.py`, `scripts/instruments.py`, `scripts/lib/sounds.mjs`,
`skills/music-for-picture/` (the owner's skill; six lines changed to name `studio_score`, `studio_sounds` and `studio_check`),
`tests/test_score_file.py`, `tests/test_instruments.py`, `test/lib-soundfont.test.mjs`, `test/harness/l12-music-mcp.mjs`,
`l12-loud-hits.mjs`, `l12-regression.sh`, `l12-fullpass.sh`, `tools-list.mjs`. Changed: `scripts/audio.py`, `lib/audio.mjs`,
`lib/score.mjs`, `lib/master.mjs` (warning text), `lib/setup.mjs`, `lib/paths.mjs`, `lib/doctor.mjs`, `scripts/studio.mjs`,
`requirements.lock`, `mcp/tools.mjs`, `mcp/content.mjs`, `SKILL.md`, `references/voice-and-audio.md`, `commands.md`, `mcp.md`,
`README.md`, `NOTICE.md`, `LITE.md` (changes table), `test/mcp.test.mjs`, `test/lib-setup.test.mjs`, `test/lib-master.test.mjs`
(the limiter warning now names `gain_db` in `src/score.json` instead of a script the tools cannot run), `test/harness/README.md`,
and the version 0.3.0 in the four places.

**Measured before building** (ledger/PLAN-music-L12.md): tinysoundfont installs from a wheel with `pyaudio` excluded; the
mirror has `MuseScore_General.sf3` (39,900,972 bytes, MIT) and no file named `MuseScore_General_Lite.sf3` (the id
`musescore-lite` is kept); both fonts hold all 128 programs and the 8 kits; `sfpreset_name` returns None for a missing
preset; tinysoundfont's channel volume is cubic (CC7 64 gave -18.06 dB).

**Results** (full pass ledger/evidence/L12-music-full-2026-09-30-2.txt, literal):
```
$ node --test test/*.test.mjs          ℹ tests 264  ℹ pass 264  ℹ fail 0
$ pytest tests                         258 passed in 48.91s
$ T0 (41 tools)                        87 items: 87 PASS, 0 FAIL      (falsifier `studio fly` fails, as required)
fluidr3 kick: first sample above -60 dBFS +2.29 ms after 2.000 s
musescore-lite piano: first sample above -60 dBFS +3.69 ms after 2.000 s
fluidr3 orchestra hit: first sample above -60 dBFS +0.12 ms after 2.000 s
fluidr3 timpani: first sample above -60 dBFS +4.00 ms after 2.000 s
musescore-lite tr808 kick: first sample above -60 dBFS +1.58 ms after 2.000 s
musescore-lite kick offsets in samples: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
512 block kick offsets in samples: [380, 113, 358, 91, 335, 68, 313, 46, 291, 536, 269, 514, 247, 492, 225, 470]
512 block piano: +6.71 ms
flute before 440.9 Hz, after the bend 220.5 Hz
```
| # | Test | Result | Literal evidence |
|---|---|---|---|
| 1 | Timing | PASS | every percussive preset on both fonts +0.12 to +4.00 ms, none early; 16 kicks offset 0 samples each (both fonts). Falsifier, a 512 sample block renderer: kicks spread 46 to 536 samples, piano +6.71 ms: fails both rules |
| 2 | Anchors | PASS | `tempo 104 BPM asked, 103.7838 BPM solved`; bar 9 at 19.000000 s (+0.00 samples); a kick on bar 9 starts on that sample plus its 2.29 ms attack. Falsifier: 50% stretch refused, "need 156.00 BPM, +50.0% from bpm 104 (max_stretch allows 6%)" |
| 3 | Determinism | PASS | two `audio` runs 4 s apart: `a20636d1dc549186 score-inst.wav, 487da56451ce1a58 mix_raw.wav, cd7f1a63d78d84f1 mix.wav` both times; seed 8: `2abeb5e4a20f23ae` (evidence/l12/bytes-identical.txt). The first build failed this twice in about 40 runs: libsndfile writes the clock time into a float WAV's PEAK chunk, so files written a second apart differed (found by verifier V); the WAVs are now written without it, with a test whose falsifier is libsndfile's own writer |
| 4 | Validation | PASS | unknown drum (lists the 28), 15 step grid ("has 15 steps"), unknown chord (lists the qualities), unknown anchor name (lists every name), program 0 bank 5 ("is not in ... nothing is substituted"), a key outside an instrument's samples, no SoundFont ("run studio setup ... or studio setup --soundfont <that file>"), a score with no notes ("a silent score is never played"); every problem listed at once |
| 5 | Film through MCP | PASS | 13 MCP calls; `bar 5 at 9.000000 s (+0.00 samples)` on `s2.drop`; every check line PASS (loudness -14.2, true peak -2.5, `sync logo: 16.50 s: audio +0.003 s`, audio against mix lag 0 ms); `impact: event s3.slam 14.400 s; in the MP4 the impact sits 1.98 ms from its scheduled place (match 0.917); ... first audible sample at 14.4022 s, 2.2 ms after the event`. Falsifier (impact written 3 frames late): `102.2 ms after the event`, FAIL |
| 6 | No regressions | PASS | `29 SAME` (timing, mixes, reports, starter score.wav of the three examples and a starter score film, 8b279e1 against now); falsifier `FALSIFIER-OK hydration-tips with a score file: mix_raw.wav differs`. T5 all three examples render and pass check; T6 identical frames; T2, T4, T7s, T15, T17 PASS |
| 7 | Loudness, heavy hits | PASS | 12 hits: `final loudness -14.1 LUFS, true peak -3 dBTP`, check loudness and true peak PASS |
| 8 | Claude, plugin only | PASS, with my reply named | Sonnet, only this server's tools. "a 10 s calm background clip": `"music": "calm"`, no score, check all PASS. "a 20 s warm product video with Afrobeats music": it asked four intake questions (the skill's intake), proposing "a live-instrument Afrobeats score"; I answered "You choose: use your defaults." in the same session; it read music-for-picture and its score format and genres, wrote `src/score.json` (bar 9 anchored to `cue:logo`, stings on cues), called `studio_score`; `audio` replaced the bed; check all PASS with `sync drop +0.002`, `sync hero +0.003`, `sync logo +0.003 s` (evidence/l12/test8-claude.txt) |

Render time for 30 s of music (639 notes, font load included, 3 runs): MuseScore General 1.32, 1.23, 1.22 s; FluidR3 0.25,
0.24, 0.28 s. A 600 s score with 42,784 notes ran as a job and finished in 28 s (verifier V).

**Setup** (worker A, rechecked): `requirements.lock` gains `tinysoundfont==0.3.7` with hashes and holds no pyaudio; setup
step 6/11 downloads MuseScore General (sha256 5b85b6c2c61d…); a second setup says every step "already done"; doctor
`PASS instruments: tinysoundfont 0.3.7, default font musescore-lite (MuseScore_General.sf3, sha256 matches); also installed:
fluidr3`; falsifier: the font file renamed makes the line FAIL with the fix; `setup --soundfont /etc/hosts` is refused
and copies nothing.

**Master bus.** Built after measuring, compressor only. On the Afrobeats film the limiter took 6.9 dB; lowering the hits
3, 6 or 9 dB left it at 6.1, 6.0 and 6.4 dB (the dry groove itself is peaky, crest 17.6 dB). With a 3:1 bus compressor
(at most 6 dB) on the score: crest 15.2 dB, limiter 2.8 dB, loudness -14.1 LUFS (before -14.0). The leveler was skipped:
loudness already reaches -14 without it, and it would lift a quiet intro the composer wrote on purpose.

**Review and verifier.** The reviewer found 2 high, 5 medium and 9 low defects; all fixed with tests (the two high ones
proven on the old code: notes past the end leaked into the next pass, first 10 ms peak 0.15617 against 0.02860; a key
doubled at one instant stuck, 0.036099 against 0). Verifier V (117 tool calls, behaviour only) passed precision, anchor
names, validation, mixing rules, no score projects, fonts, MCP, loudness and sync, odd meters, swing, gain and reverb,
and found eight defects, all fixed with tests: `"length"` was unbounded (600 s on a 40 s video wrote 231 MB; now cut to
the video); a bend never reset (now it holds until the next note: 524.0 Hz after a -12 bend on C5); keys outside an
instrument's samples rendered silence (now refused by name); MuseScore's piano peaks about 38 dB under its bass and
`gain_db` could not raise it (now -40 to +24 dB, exact, and the report lists each track's peak and flags a track over
30 dB under the loudest); the PEAK chunk above; a traceback for a narrated project before `voice` (now "Run studio voice
first"); unclear messages (bad grid character, bad bank, two anchors on one bar, a hit before 0 s, a hidden kit error,
repeated lines).

**Section 5 suggestions.**
**The owner's section 5 suggestions, checked against this copy:**
| Suggestion | Status | Reason and evidence |
|---|---|---|
| A cue sheet | Already present (L11) | `cues` in absolute seconds, `CUE.name` in the page, `studio_cues`. The score now names times as `cue:<name>`, `<scene>.<event>`, `<scene>.start` and `<scene>.end`, so a hit inside a scene uses either form. Test 5 anchored bar 5 to `s2.drop` and placed a sting on `cue:logo`. |
| Stills at cues | Already present (L11) | `stills --cues` (4 frames before, on, 6 after, with a legend) and `--range a:b --every s`. Test 5 ran `studio_stills` with `cues: true`. |
| A per cue sync check | Already present (L11) | `check` prints `sync <cue>` from the sharp onset nearest the cue, within ±1.5 frames. Test 5: `sync logo: 16.50 s: audio +0.008 s`. The music test also measures its impact with a matched filter, because a "strongest rise" rule read the groove's rim 54 ms early. |
| Loudness with peaky scores | Already present (L11) | Gain search through the 4x limiter, measured until within 0.3 LU, with a warning above 6 dB. Test 7, 12 heavy hits: render -14.1 LUFS, -3.0 dBTP. |
| A master bus for scores | Built, compressor only | Measured on the Afrobeats film: the limiter took 6.9 dB, and lowering the hits by 3, 6 or 9 dB left it at 6.1, 6.0 and 6.4 dB, because the dry groove itself is peaky (crest 17.6 dB). A 3:1 bus compressor (at most 6 dB) on the score stem gives crest 15.2 dB and limiter 2.8 dB at the same loudness (-14.0 against -14.1 LUFS). The leveler was skipped: loudness already reaches -14 without it, and it would lift a quiet intro the composer wrote on purpose. |
| A lint warning for typed cue times | Already present (L11) | compose warns about a number in the page equal to a cue time (named gap kept: whole numbers). |
| Creative rules from a director review | Already present (L11) | want and villain (SKILL.md, storytelling.md), comedy timing and the rule of three (character.md), energy plan (cinema.md, shots.md), staging (cinema.md §7), pitch cheap with beat sheets and rough stills (SKILL.md), KEEP, CUT and WHY (feedback.md), the gag check at setup, action and reaction (review.md). |
| brand-colour-roles | Already present (L11) | references/brand-colours.md and `studio_brand_check` (all blue 97% FLOODED, blue mascot on cream 1% ACCENT). |

**Named gaps.** Nobody has listened to a score: timing, levels and spectra are measured, musical quality is not (James's
ears, T18). MuseScore General's piano is quiet and not monotonic in velocity (vel 30 -43.8, 60 -38.4, 90 -52.7, 127 -29.0
dBFS, verifier V): the report flags it, the font is not changed. The limiter can still take over 6 dB on a sparse score
with one big hit (V measured 7.9 dB; the warning names `gain_db`). Pan is not hard on stereo samples. GeneralUser GS is
untested. A fresh home whose SoundFont download fails (the WARN path) was not run. `studio_setup_start` with an unknown
font id says the file does not exist instead of listing the ids. In test 8 the Afrobeats run needed one reply from me
after its intake questions. Claude Desktop with the new bundle is James's test (T18).

**Awkward in the code, and what I would change.**
- `audio.py` is one long top level script: timing cannot be computed without running it (`--score-only` was added). I
  would move timing into a function that both `audio` and `score` call.
- The mix is built mono at 24 kHz; projects with a score now upsample it to 48 kHz stereo, projects without keep the old
  path for identical bytes. I would build everything at 48 kHz stereo in one release and accept new bytes once.
- LITE.md does not record the L11 additions (cues, inspect, brand, open); its changes table now records L12.
- `test/lib-setup.test.mjs` "doctor exits 2 when a check fails" can run a real synctest that rewrites the real env.json
  (worker A); it should give its fake env a stored synctest.
- uv splits the `--excludes` path at spaces, so setup passes a bare file name from the home's tmp folder.

## Final report (updated after L12)

The per test table of the first final report stands with the L11 updates. L12 adds music with real instruments: tests 1
to 8 of the L12 plan PASS with the evidence above (test 8 with my one reply after the intake questions, named). The
full pass on the final code: node 264 of 264, pytest 258, T0 87 of 87 with 41 tools, T2, T4, T5, T6, T7s, T15 and T17
PASS. Still open: T13, BLOCKED after three rounds (awaiting James's written acceptance or a fourth round); T18, PENDING
(James installs `dist/synergy-studio.mcpb`, now with the music tools, in Claude Desktop and reports). Largest gap:
nobody has listened to the music; it is measured for timing, level and balance, not judged by ear.

## L13: toy sounds in the score file, and which engine Claude uses when

James asked that the earlier cartoon instruments stay, sit beside the real instruments, and that Claude know which to
use when. The bundled starter score (`template/score.py`) and the generated beds are unchanged: L12 test 6 still gives
`29 SAME` against 8b279e1.

**Built.** `scripts/toys.py` (new) re-expresses the starter score's voices for the score file, made from oscillators and
noise with no SoundFont: toy instruments as tracks (`"synth": "pizz"`, `bell`, `musicbox`, `whistle`, `pad`, `bass`, `stab`,
`square`), a toy kit (`"kit": "toy"`, 17 drum names) and 17 cartoon hits (`boing`, `bonk`, `slide_down` and more; a whoosh
and a shimmer are centred on their time, a riser ends on it). One score may mix toy and real instruments; a toy only
score needs no font. Noise comes from fixed PCG64 bit streams keyed by the seed and the event. The toy kit sits 8 dB
lower than the starter's drums (measured 0 dBFS against -10 to -14 for the other tracks). `studio sounds` lists the toy
names. Changed: `score_file.py`, `instruments.py`, `voice-and-audio.md` (a four way engine table and the toy names),
`SKILL.md` (the build step names the engines), `commands.md`, `mcp.md`, the `studio_score` description, `LITE.md`.
Tests: `tests/test_toys.py` (25).

**Which engine when** (the rule in SKILL.md and voice-and-audio.md): a generated bed for background (calm, ambient,
looping, utility clips; no score); toy sounds for cartoon, kids and chiptune; real instruments for a genre, warm, premium,
documentary and cinematic work; both for comedy; the user's track whenever there is one.

**Measured.**
```
boing +0.10 ms, bonk +0.02, pop +0.02, squeak +0.08, splat +0.02, puff +2.00, slide_up +0.50, tink +0.02, thunder +0.00 (never early, within 5 ms)
whoosh: heard from 1.700 to 2.300 s (moment at 2.000)   shimmer: 1.316 to 2.684 s   riser: 0.533 to 2.000 s
toy kick offsets: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] samples (0.02 ms spread; the plan's limit 0.1 ms)
mixed with a real tuba: drums -8.0, hits -1.5, tiptoe -13.3, tune -10.6, tuba -14.3 dBFS
```
Falsifier for the moment rule: a whoosh, shimmer or riser placed like a transient misses its moment by more than 0.25 s.
The first `shimmer` class (a transient) measured +39.96 ms and was wrong: it is a swell and is now centred.

**Claude with only the plugin's tools** (Sonnet, the installed plugin disabled; evidence/l12/engine-choice.txt):
- "a 15 s cartoon video of a cat chasing a ball of yarn, with silly sound effects": toy kit, `musicbox` and `pizz` synth
  tracks, real tuba, xylophone and trombone, ten toy hits on cues; its first score was refused (three anchors) and it fixed
  it from the message; check all PASS with `sync drop +0.001`, `sync bonk +0.003`, `sync boop +0.001 s`.
- "a 20 s warm product video with Afrobeats music" (twice, my "You choose" reply after the intake questions): real
  instruments by the genre recipe (standard kit, bass 33, keys 4, guitar 27, kalimba 108; once with a toy riser and
  shimmer); the bed replaced; check all PASS, `sound balance: music 13 dB under the voice`.
- "a 10 s calm background clip": the first run after the toy text wrote a real instrument score (pad, strings, piano),
  where the run of 2026-09-30 chose the bed. The rule was made explicit (background music is the bed; a score only when the
  music carries meaning); two reruns both chose `"music": "calm"`, no score, check all PASS.

**Found on the way: check results hidden from Claude.** Claude Code gives the model a tool's `structuredContent` instead
of its text, and finished job results carried only `{job_id, state, exit_code}`, so the model saw "done" and a contact
sheet but never the check lines (earlier builds worked around it with `studio_job_log`). Every structured result now also
carries the whole text as `message`. Proof: a headless run asked to quote the PASS lines of a finished check answered
`NO PASS LINES` before the fix and quoted all ten after; `test/mcp.test.mjs` asserts it (fails on the old server, 17 of
18). After the fix both calm reruns read their check lines without `studio_job_log`.

**Full pass** (evidence/L12-toys-full-2026-10-01.txt): node 264 of 264, pytest 283, T0 87 of 87 (41 tools), T2, T4, T5, T6,
T7s, T15, T17, L12 tests 5, 6 and 7 with their falsifiers as required. Version 0.4.0.

**Named gaps.** Nobody has listened to the toy or real scores. The toy voices are re-expressed from `template/score.py`
rather than shared with it (the starter is copied into projects as a standalone script and must keep its bytes), so a
change to one is not made in the other. In one run of three the model chose instruments for a calm clip before the rule
was made explicit; two runs after it are not proof that it never will.

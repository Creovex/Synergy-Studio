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

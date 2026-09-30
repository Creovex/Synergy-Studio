# Synergy Studio lite: architecture and build specification

Owner: James. Build machine: his MacBook. This file is the specification the build agent works from.
The full product design lives in `ARCHITECTURE.md` and is **not** part of this build.

## Writing rules (apply to every file, comment, commit message and message you write)
1. No version labels in prose: never write "v1", "v2", "phase 2" or similar in documents, commits or
   interface text. Pinned dependency versions in code, lockfiles and install logic are identifiers the
   build needs and stay exactly as pinned. `BUILD_LOG.md`, `NOTICE.md` and `research/` may quote
   dependency and protocol versions as identifiers; `README.md` and the skill files do not.
2. Never use a dash as punctuation between words or clauses. Use a comma, a colon, a semicolon or a
   full stop. Hyphens inside compound names and file names are fine.
3. Copy these rules into `README.md`, `AGENTS.md` and `BUILD_LOG.md` so anyone working from them follows them.
4. A gap is named, never papered over. Anything not proven is written as PENDING or BLOCKED with the reason.

---

## 1. What lite is
A Claude plugin that lets Claude make and improve short videos in any visual style on the owner's Mac.
Claude writes each video as code: one HTML page animated with GSAP and rendered by HyperFrames, with a
local AI voice (Kokoro), generated music and ffmpeg. Scripts do the fixed, fiddly work; Claude does the
creative work. An MCP server carries the skill and exposes the scripts as tools, so Claude Code and Claude
Desktop both see the instructions and can run the pipeline without a separate skill install.

### 1.1 Division of work
| Scripts own (fixed, tested, never improvised) | Claude owns (creative, different every video) |
|---|---|
| install, doctor, voice synthesis, scene timing, music, ducking, sound effects, loudness, placeholder filling, lint, stills, rendering, footage cutting and grading, transcription, beat grids, look measurement, automatic checks, jobs | the plan and script, scene design, layout, animation code, overlays, the look, reviewing stills and fixing |

### 1.2 Kinds of video
| The user has or wants | Kind | Mode |
|---|---|---|
| an idea or script, no footage | narrated motion graphics (explainer, ad, tips, list) | `narrated` |
| music and pictures, no voice | wordless story, short film, drawn animation, kinetic motion piece | `film` (scenes in seconds, music sets the feel) |
| their own clips (talking head, selfie) | footage edit: cut, grade, word captions, overlays | `footage` with `edit.clips` |
| an existing finished MP4 made anywhere | improve: reframe, recut, captions, overlays, audio polish; or remake as a new project | `footage` via `import` |
| photos and a song | photo ad cut to the beat | `footage` without `edit`, `voice_track: false` |
| a product or object in 3D | three.js scene inside any kind | any |

### 1.3 Out of scope for lite (stays in ARCHITECTURE.md)
Interview engine, plan validator and meaning gate, the component library, Blender, the full QC suite,
signed review records, Windows and Linux proof, a hosted service, Nigerian English voice (Kokoro has none;
use on screen text or the user's own recorded voice).

**Known limit (not planned):** there is no automatic image judge. Brand correctness (logo, mascot, product,
characters) comes from using the user's own files and from Claude checking the stills against `brief.md`.
Recognising frames is Claude's responsibility in the skill's review (`references/review.md`); an image
recognition check for specific mascots or logos would need a vision model and reference images per brand.

### 1.3a Starting point
The build starts from the owner's lite code: `skills/synergy-studio/` at commit `30127c8` is copied into the repo
at L0 and changed. This file describes the result, not a rewrite. `ledger/CODEMAP.md` maps each requirement here
to **exists**, **change** or **new** in that code.

### 1.4 The skill is the contract
The owner's finished skill at commit `30127c8` of branch `claude/clever-lamport-n7of0u`
(`skills/synergy-studio/`: SKILL.md, `references/`, `template/`, `examples/`) is the contract for the scripts.
Every command, flag, output file, template file, helper, look, font and platform name it mentions must exist
in the built code and behave as it describes. Where this file lists fewer, the skill wins; where this file adds
something (the MCP server, `import`, `frames`, `look`, `synctest`, caption styles), both
apply. Test T0 checks the contract mechanically.
**Where the skill and this build disagree, the build's real tools are the truth.** SKILL.md and
`references/*.md` are corrected to match (section 9); no contradiction may remain in the shipped text.

---

## 2. Platform
- **Proven this round:** macOS on Apple Silicon (the owner's MacBook). Record `uname -m`,
  `sysctl -n machdep.cpu.brand_string`, `sw_vers`, `git --version` and free disk in `BUILD_LOG.md` first.
- **macOS permissions:** the first access to `~/Documents` and `~/Downloads` can raise a privacy prompt that
  stalls an unattended run. Touch both at the very start (`ls`), and if access is refused, stop and ask James.
- **Written for all three systems:** code uses `path.join`, spawns with argument arrays (`shell: false`),
  never hard codes `/`, `bin/python` or `.exe`. Windows and Linux runs are PENDING, not claimed.
- **No reliance on the user's PATH.** Claude Desktop starts servers without the shell's PATH, so setup
  installs its own Node, uv and Python into the tool home (5.2) and every later spawn uses those.
- **Spaces in paths:** both default homes contain spaces. Every path goes to child processes as a separate
  argument; ffmpeg filtergraphs that embed a path escape it. Tests run under the default homes at least once (T1, T15).
- Free disk needed: 10 GB before setup (about 1 GB of tools plus renders). Stop with a plain message below that.

---

## 3. Repository layout
```
<repo>/
  README.md  LITE.md  AGENTS.md  BUILD_LOG.md  NOTICE.md  .gitignore
  .claude-plugin/plugin.json        Claude Code plugin manifest (name synergy-studio)
  .claude-plugin/marketplace.json   local marketplace entry so the plugin installs from this folder
  .mcp.json                         starts mcp/server.mjs with ${CLAUDE_PLUGIN_ROOT}
  skills/synergy-studio/
    SKILL.md                        the workflow (section 9)
    references/                     every file the owner's base commit has (including commands.md, his single
                                    command reference, and cinema, illustration, character, tone) plus two added
                                    by this build: styles.md mcp.md
    template/                       index.html  lib.js  sketch.js  looks.css  brief.md  shots.md  feedback.md
    examples/                       hydration-tips/  footage-captions/  three-product/  (section 10)
    scripts/
      studio.mjs                    dispatcher only: parses arguments, calls lib/<command>.mjs
      lib/                          one module per command (setup, doctor, new, budget, say, import, voice, audio,
                                    words, transcribe, cut, beats, silences, scenes, look, compose, stills, render,
                                    check, frames, synctest),
                                    plus env.mjs, run.mjs, lock.mjs, paths.mjs shared helpers
      voice.py  audio.py  beats.py  look.py  syncaudio.py  requirements.lock
  mcp/
    server.mjs  jobs.mjs  files.mjs  images.mjs    zero dependency MCP server (section 8)
  bundle/manifest.json              Claude Desktop bundle manifest
  scripts/pack-bundle.mjs           builds dist/synergy-studio.mcpb
  test/                             node:test suites and test/rubrics/*.md (frozen judge rubrics)
  tests/                            pytest suites for the Python scripts
  research/                         one file per question, with sources and dates (committed)
  reference/                        GITIGNORED: lite-branch/ haura-original/ videos/ footage/ assets/ breakdowns/
```
`.gitignore` also covers `node_modules/`, `dist/`, `tmp/`, `**/comp/`, `**/out/`, `**/stills/`, `**/audio/`,
`__pycache__/`, `.venv/`. `tmp/` is scratch and is emptied at the end of every task.
`NOTICE.md` is a table: component, licence, how it is used, source URL. It covers HyperFrames, GSAP, three.js,
the Kokoro model files and kokoro-onnx, the eSpeak NG phonemizer that kokoro-onnx runs, Whisper, soundfile,
imageio-ffmpeg and the ffmpeg build it ships (run as a separate program), the ffprobe binary, uv, Node,
Pillow, numpy, and the Manrope, Inter, Cormorant Garamond and Jost fonts. The licence of each is read from its source at build time.

---

## 4. Tool home and projects home
### 4.1 Tool home (one per computer)
`SYNERGY_STUDIO_HOME` if set and non empty, otherwise:
macOS `~/Library/Application Support/SynergyStudioLite`, Windows `%LOCALAPPDATA%\SynergyStudioLite`,
Linux `${XDG_DATA_HOME:-~/.local/share}/synergy-studio-lite`.
```
<home>/
  runtime/node/    pinned Node LTS (5.2)          runtime/uv/   pinned uv binary
  node/            npm packages (5.1) and HyperFrames' render browser
  venv/            Python 3.11 made by uv
  models/          Kokoro model files
  bin/             ffmpeg  ffprobe
  env.json         every absolute path above, platform, installed_at
  jobs/            <job_id>.json  <job_id>.log
  locks/           heavy.lock (one setup, render or transcription at a time, shared by CLI and MCP; holds the
                   owner's pid and start time; a lock whose pid is no longer running is taken over and logged)
  server.log
```
### 4.2 Projects home
`SYNERGY_STUDIO_PROJECTS` if set, otherwise macOS `~/Movies/Synergy Studio`, Windows and Linux
`~/Videos/Synergy Studio`. One folder per video: `<projects>/<name>/`. Names are lower case letters,
digits and hyphens, at most 40 characters; the MCP server rejects anything else. The CLI accepts any folder.

### 4.3 Project folder
```
project.json  brief.md  shots.md  feedback.md  src/index.html  src/look.css (optional)  src/assets/  src/assets/fonts/  src/footage/
audio/vo/<scene>.wav  audio/voice.wav  audio/mix_raw.wav  audio/mix.wav
durations.json  timing.json  timing.js  transcript.json  cuts.json  beats.json  look-reference.json
comp/  stills/  history/<timestamp>/ (previous renders)  out/<name>-<WxH ratio, e.g. 9x16>.mp4  out/check.json  out/captions.json
```

---

## 5. Dependencies (exact pins; the build agent verifies each on the Mac and records the check)
### 5.1 npm packages in `<home>/node`
`hyperframes 0.8.92`, `gsap 3.14.2`, `three 0.186.1`, `@ffprobe-installer/ffprobe 2.1.2`,
`@fontsource/inter 5.3.0`, `@fontsource/manrope 5.3.0`, `@fontsource/cormorant-garamond 5.3.0`, `@fontsource/jost 5.3.0`. Written into `<home>/node/package.json` and
installed with the home's own npm. Never run HyperFrames through `npx`; always
`<runtime node> <home>/node/node_modules/hyperframes/bin/hyperframes.mjs`.
Environment for every HyperFrames call: `HYPERFRAMES_SKIP_SKILLS=1`, `HYPERFRAMES_NO_TELEMETRY=1`, and
`hyperframes telemetry disable` once at setup.
### 5.2 Runtimes
- **Node:** the current Node 22 LTS release at build time, from nodejs.org as the platform archive, checked
  against that release's `SHASUMS256.txt`, extracted to `<home>/runtime/node`. Pin the exact release in
  `lib/setup.mjs` and record it in `BUILD_LOG.md`.
- **uv:** the current release at build time from GitHub releases, checked against its `.sha256`, to
  `<home>/runtime/uv`. Pinned the same way. A uv already on PATH is not used.
- **Python:** `uv venv --python 3.11 <home>/venv` (uv downloads its managed Python).
### 5.3 Python packages in `<home>/venv`
`kokoro-onnx==0.6.1`, `soundfile==0.14.0`, `imageio-ffmpeg==0.6.0`, `numpy` as resolved by those, and
`pillow` pinned to its current release. Resolve together with uv; record the lock in `scripts/requirements.lock`.
### 5.4 Models
Kokoro from GitHub releases:
`https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx` and
`https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin`.
Download to `<file>.part`, then rename. Record the SHA-256 of both in `lib/setup.mjs` after the first
download; verify on every later setup and in `doctor`.
Whisper `small.en` is downloaded by `hyperframes transcribe` on first use from huggingface.co. This has
never been run anywhere. Research where HyperFrames caches the model and whether a model file can be
placed there by hand; write it in `research/whisper-model.md`, since that is the fallback if the network blocks the download.
### 5.5 ffmpeg and ffprobe
ffmpeg copied from `imageio_ffmpeg.get_ffmpeg_exe()`; ffprobe from `@ffprobe-installer/ffprobe`. Both go
to `<home>/bin`, get `chmod 755`, and on macOS an ad hoc signature (`codesign --force --sign -`) when
`codesign --verify` fails. Check each binary's architecture with `file` and fail if it is not the machine's.
### 5.6 MCP server
No runtime dependencies. Tests may use the official MCP TypeScript SDK client as a dev dependency in
`test/`, pinned to its current release.

---

## 6. `project.json`
| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | folder name | output file name stem |
| `kind` | `studio` \| `hyperframes` | `studio` | `hyperframes` marks a plain HyperFrames folder brought in by `studio_import_hyperframes` (8.6); compose is skipped for it |
| `mode` | `narrated` \| `footage` \| `film` | `narrated` | 1.2; `film` scenes are `{id, start, end}` in seconds with no voice |
| `aspect` | `16:9` \| `9:16` \| `1:1` \| `4:5` | `16:9` | 1920x1080, 1080x1920, 1080x1080, 1080x1350 |
| `platform` | `tiktok` \| `reels` \| `shorts` \| `meta` \| `youtube` \| `linkedin` \| `x` \| `website` (the list the owner's `new` accepts) | from `new` | drives the safe area guide (9.2) and the word budget |
| `length` | seconds | 30 for 9:16, 60 otherwise | target length; `budget` and `audio` use it |
| `fps` | 24 \| 25 \| 30 \| 60 | 30 | render frame rate; `check` asserts the file's rate equals it |
| `voice` | Kokoro voice id | `af_heart` | 7.4 list |
| `speed` | number 0.9 to 1.1 | 0.95 | speech speed |
| `music` | `warm` \| `calm` \| `upbeat` \| `none` \| `{file, start, gain_db}` | `warm` | generated bed or the user's song section |
| `lead` `pre` `post` `tail` | seconds | 9:16: 0.4, 0.3, 0.7, 2.0; otherwise 0.9, 0.6, 1.2, 2.5 | narrated timing (7.5) |
| `lexicon` | `{word: spoken spelling}` | `{}` | pronunciation fixes |
| `scenes` | narrated: `[{id, say, voice?, speed?, pre?, post?, hold?}]`; footage: `[{id, start, end}]` | | one per idea; ids match `^s\d+$`; footage times are seconds on the **edited** timeline made by `cut` (the order of `edit.clips`), not source file times |
| `events` | `{scene: {name: seconds or {t, sfx}}}` | `{}` | offsets from the scene's narration start; `sfx` `pop` \| `click` \| `whoosh` |
| `edit` | `{clips: [{src, in, out, crop_x?}], grade, clean_voice}` | | footage cut list in story order; `in` and `out` are source seconds; reframing is a crop at horizontal position `crop_x` from 0 (left) to 1 (right), default 0.5; `grade` `warm` \| `neutral` \| `none` |
| `caption_fixes` | `{misheard: correct}` | `{}` | applied to transcript words at compose |
| `voice_track` | boolean | true | false for music only footage projects |
| `transition_whoosh` | boolean | true | soft whoosh at each scene change |
The look is not a project field: it is `data-look` on `#root` in the page, as in the owner's examples; a custom
look is `src/look.css`, loaded after `looks.css` whenever it exists. Unknown fields are an error in `compose`. A silent narrated scene has `say: ""` and a `hold` in seconds.

---

## 7. CLI: `node skills/synergy-studio/scripts/studio.mjs <command>`
Node built ins only. Every command prints plain language, exits 0 on success, 1 on a usage or setup error,
2 on a failed check. Errors say what to do next. `setup`, `render` and `transcribe` take `locks/heavy.lock`
and wait for it (printing that they are waiting), whether started from the CLI or by the MCP server.

| Command | Does | Writes |
|---|---|---|
| `setup` | runtimes, npm packages, venv, models, ffmpeg, render browser; skips steps already done; ends with `doctor`, then `synctest` when compose and render exist and `env.json` holds no synctest result for the current HyperFrames and browser versions | tool home, `env.json` |
| `doctor` | one PASS or FAIL line each: runtime node, uv, Python and Kokoro import, model hashes, ffmpeg, ffprobe, binary architecture, HyperFrames present, render browser, with `--full`: a 1 s 60 fps test render and a 1 s three.js test render of fixed pages in `scripts/lib/doctor-fixtures/`, rendered straight with HyperFrames (no compose); free disk ≥ 10 GB. A 60 fps render that comes out at another rate prints `WARN 60 fps unsupported` instead of failing. Doctor compares the installed HyperFrames and browser versions with those stored with the last synctest result and, when they differ, prints `WARN synctest out of date` and runs `synctest` | nothing outside `tmp` |
| `new <dir> [--aspect] [--platform] [--length] [--look] [--mode]` | starter project, page and the brief, shot list and feedback templates | `project.json`, `src/index.html`, `brief.md`, `shots.md`, `feedback.md` |
| `budget <dir>` | words that fit per scene for the target length | printed |
| `say <dir> "text" [--voice]` | one line of speech to check a pronunciation | `audio/say.wav` |
| `import <dir> <video> [--aspect]` | footage project from an existing file: copies it to `src/footage/`, one clip covering the whole file, prints duration, fps, size, whether it has audio, and makes `stills/source-sheet.jpg` | project, sheet |
| `reference <dir> <video> [--every 2]` | the owner's reference study: contact sheet and cut rhythm | `reference/sheet.jpg`, `reference/cuts.json` |
| `frames <video> [--n 12] [--out file]` | contact sheet of any video without a project; shares its code with `reference` | one JPEG |
| `voice <dir> [--only s2,s4]` | Kokoro per scene, silence trimmed, prints words per second | `audio/vo/*.wav`, `durations.json` |
| `audio <dir>` | timing (7.5), music, ducking, effects, mix, loudness to −14 LUFS and −1.5 dBTP | `timing.json`, `timing.js`, `audio/mix.wav` |
| `words <dir>` | estimated word times for narrated captions (character proportional, ±0.25 s) | `transcript.json` |
| `transcribe <dir> [file]` | Whisper `small.en` word times of `audio/voice.wav` or the file; `.srt`, `.vtt`, `.json` are imported instead | `transcript.json` |
| `cut <dir>` | trims, orders, crops to the aspect at `crop_x`, grades, cleans the voice; warns per clip when audio and video streams start more than 1 frame apart (7.9 C) | `src/assets/base.mp4`, `audio/voice.wav`, `cuts.json` |
| `beats <dir> <song> [--start s]` | beat grid 70 to 180 BPM with octave check | `beats.json` |
| `silences <dir> <clip> [--db -32 --min 0.4]` | pauses and speech pieces, to cut dead air | printed and JSON |
| `scenes <dir> <clip> [--threshold 0.3]` | shot changes in a clip | printed and JSON |
| `synctest` | picture against sound for the whole pipeline (7.9) | result in `env.json` |
| `look <dir> --from <files…>` | measures a reference (7.7) and drafts a custom look | `look-reference.json`, `src/look.css`, `stills/look-card.jpg` |
| `compose <dir>` | lint (7.6), fill placeholders, copy files (7.6.1), run `hyperframes lint` | `comp/` |
| `stills <dir> [t…] [--platform]` | compose, report page errors and low contrast text (`hyperframes validate`), then frames at 0.3 s, the middle and the end of every scene and the last second (or the given times), a sheet in time order and a safe area guide | `stills/*.jpg`, `stills/sheet.jpg` (the one name since the owner's cold audit), `stills/safe-<platform>.jpg` |
| `render <dir> [--draft]` | compose, move the previous render to `history/`, render at the project fps, retry once, re-normalise loudness after AAC, write `-share.mp4` (under 25 MB) when the file is larger, save the page's caption record | `out/<name>-9x16.mp4` (the aspect with `x`, never a colon), `out/captions.json` |
| `check <dir>` | 7.8 checks and a final contact sheet | `out/check.json`, `stills/final-sheet.jpg` |
| `help` | lists commands | |

### 7.4 Voices
`af_heart` (default), `af_bella`, `af_nova`, `af_sky`, `am_michael`, `am_adam` (US); `bf_emma`,
`bf_isabella`, `bm_george`, `bm_lewis` (UK; language `en-gb` when the id starts with `b`).

### 7.5 Timing
Narrated: scene start → `pre` (`lead` for the first scene) → narration → `post` (+`hold`, +`tail` on the last
scene) → scene end. Footage: scenes are given ranges on the edited timeline; narration start equals scene
start. All page times come from `timing.js` (`window.TIMING = {T, EV, TOTAL, fps}`); nothing is typed by hand.
Music: generated beds use a seeded generator, so the same project gives the same mix; the music ducks
about 8 dB under the voice. The user's song plays from `start` with `gain_db`.

### 7.6 Compose lint (refuses to compose and lists every hit)
`Math.random`; clock time (`Date.now`, `new Date(`, `performance.now`); timers (`setTimeout`, `setInterval`,
`requestAnimationFrame`); CSS `@keyframes`, `animation:`, `transition:`; GSAP `.from(` and `.fromTo(`; any
`http:` or `https:` URL in `src`, `href`, `url(` or `import`; a scene id in `project.json` with no element of
that id; an element with `data-start` and no `id`; leftover `{{…}}`; unknown `project.json` fields. Then `hyperframes lint --json`: errors stop the compose, warnings print.
#### 7.6.1 What compose copies into `comp/`
The filled `index.html`; `lib.js`, `looks.css` and `src/look.css` if present; `timing.js`; `words.js`
(`window.WORDS` from `transcript.json` after `caption_fixes`); `audio/mix.wav` to `comp/audio/`;
`gsap.min.js` from `<home>/node/node_modules/gsap/dist/`; the bundled fonts (`inter-latin-{400,500,600,700}-normal.woff2`,
`manrope-latin-{700,800}-normal.woff2`, `cormorant-garamond-latin-{400,500,600,700}-normal.woff2`,
`jost-latin-{300,400,500}-normal.woff2`) to `comp/fonts/`; everything under `src/assets/` to `comp/assets/`.
When the page mentions three.js: `three.module.js` and `three.core.js` from `three/build/` to `comp/three/`,
and the add-ons `loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js`,
`environments/RoomEnvironment.js`, `geometries/TextGeometry.js`, `loaders/FontLoader.js`,
`geometries/RoundedBoxGeometry.js` from `three/examples/jsm/` to `comp/three/addons/`. The page's import map is
`{"imports":{"three":"./three/three.module.js","three/addons/":"./three/addons/"}}`; compose warns when a
three.js page lacks it.

### 7.7 `look --from`
Input: images, or videos (sampled at 1 frame per second, at most 60 frames). Measures, with numpy and Pillow:
six palette colours by seeded k-means in Lab, the background colour and whether the look is light or dark,
text to background contrast of the top pair, grain (high frequency energy in flat regions), edge density,
and for video also fps, cuts per minute (ffmpeg `select='gt(scene,0.3)'`) and motion energy (mean frame
difference). Writes `look-reference.json` with every number, then `src/look.css` mapping the palette onto the
look variables (9.2), with comments suggesting fonts and motion that Claude edits. Renders
`stills/look-card.jpg`: a title, body text, a card, a chip and an accent shape in that look. The same card is
rendered for any look, so looks can be compared.

### 7.8 Checks (`check`; every line PASS or the command exits 2)
| Check | Applies to | Pass |
|---|---|---|
| video stream | all | h264 at the project size |
| frame rate | all | the file's frame rate equals `fps` |
| audio stream | all | AAC present |
| duration | all | timeline ± 0.15 s (encoder padding makes files slightly longer) |
| target length | projects with `length` | duration ≤ `length` × 1.05 |
| loudness | all | −14 ± 1 LUFS |
| true peak | all | ≤ −1.0 dBTP |
| no black frames | all | none ≥ 0.5 s |
| nothing frozen | all | no still stretch ≥ 4 s (a `hold` scene or an end card needs some motion; the default tail is 2.5 s) |
| audio against mix | all but `kind: hyperframes` without a mix file | 7.9 A: lag ≤ 1 frame, correlation ≥ 0.9, the last 2 s match, no silent stretch of 0.5 s or more in the MP4 where the mix has sound |
| captions | pages that call `captions()` | `out/captions.json` exists; every transcript word inside the video's range is in it; no word is highlighted more than 150 ms before its start |

### 7.9 Sync verification (the owner's design: his LITE.md section 5 at commit `30127c8`)
**A. Every video: audio in the MP4 against its source mix** (a `check` line). Decode the MP4's audio and
`audio/mix.wav` to mono 8 kHz (`ffmpeg -ac 1 -ar 8000 -f f32le -`), take RMS envelopes in 10 ms windows and
cross correlate over ±0.5 s in `scripts/syncaudio.py` (venv Python). Report lag and correlation. Pass: |lag| ≤ 1
frame at the project fps and correlation ≥ 0.9; compare the last 2 s separately (a cut off ending); flag any
stretch of 0.5 s or more that is silent in the MP4 but not in the mix. It catches a renderer shifting or
trimming audio, a missing `id` on `<audio>`, and damage from the final loudness pass.
**B. Once per computer: picture against sound** (`synctest`). A black 10 s composition with a one frame full
frame white flash at 2.0, 4.5 and 7.0 s and a 50 ms 1 kHz beep at the same times, built with a small
`project.json` and page in `tmp` and taken through the normal `compose` and `render` path. Flash times from
`ffmpeg -vf "signalstats,metadata=print:key=lavfi.signalstats.YAVG"` (frames with YAVG above 200); beep onsets
from `silencedetect` (the ends of the silences). Pass: every flash and beep pair within 1 frame; report the mean
offset in ms. Runs at the end of `setup` and again whenever HyperFrames or its browser changes version; the
result and those versions are stored in `env.json`, and `doctor` shows the last result. If it fails, look at
HyperFrames' audio muxing, the `--player-ready-timeout`, and the final `loudnorm` re-encode (compare the raw
render with the normalised file).
**C. Footage warning** (in `cut`): for each source clip compare the audio and video stream start times
(`ffprobe -show_entries stream=codec_type,start_time`); warn when they differ by more than 1 frame, and offer to
shift the audio with `-itsoffset`.

---

## 8. MCP server (`mcp/server.mjs`)
### 8.1 Transport and protocol
stdio, newline delimited JSON-RPC, Node built ins only. Implements `initialize` (answers within 1 s and never
installs anything before answering), `notifications/initialized`, `ping`, `tools/list`, `tools/call`,
`resources/list`, `resources/read`, `prompts/list`, `prompts/get`. Protocol version: echo the client's
requested version when it is supported; the supported list comes from the current MCP specification at build
time, recorded in `research/mcp-protocol.md`. Logs go to stderr and `<home>/server.log`, never stdout.
`instructions` on initialize: "Synergy Studio makes and improves videos. Call studio_guide first and follow it."

### 8.2 Tools
Every call returns within 30 s. Anything longer starts a job and returns `{job_id}`. Descriptions are at
least 80 characters and say when to use the tool.
| Tool | Inputs | Result |
|---|---|---|
| `studio_guide` | none | SKILL.md exactly as in the skill folder, with `<skill>` paths resolved, plus the list of references |
| `studio_reference` | `name` | one references file |
| `studio_doctor` | none | doctor lines (the quick ones; the test renders run as a job with `full: true`) |
| `studio_setup_start` | none | job (poll with `studio_job_status`) |
| `studio_project_new` | `name`, `aspect?`, `platform?`, `length?`, `look?` (sets `data-look` in the starter page, not a project field), `mode?` | project path; writes the brief, shot list and feedback templates |
| `studio_project_import` | `name`, `video_path`, `aspect?` | project path, source facts, source sheet as an image |
| `studio_project_list` | none | projects with last change and whether an MP4 exists |
| `studio_frames` | `video_path`, `n?` | contact sheet of any video as an image, without a project |
| `studio_file_list` | `name` | files under the project, with sizes |
| `studio_file_read` | `name`, `path` | text up to 200 KB, or image content for jpg and png |
| `studio_file_write` | `name`, `path`, `content` | bytes written, and the first and last line read back from disk |
| `studio_file_add` | `name`, `from_path`, `to?` | copies a user file (logo, photo, clip, song, font) into `src/assets/`, `src/assets/fonts/` or `src/footage/` |
| `studio_compose` | `name` | lint result: every error and warning, or "composed" |
| `studio_budget` `studio_audio` `studio_words` `studio_cut` | `name` | output text (a job when over 30 s) |
| `studio_voice` | `name`, `only?` (array of scene ids) | job |
| `studio_beats` | `name`, `song` (a path inside the project), `start?` | output text |
| `studio_silences` | `name`, `clip`, `db?` (default −32), `min?` (default 0.4) | output text and JSON |
| `studio_scenes` | `name`, `clip`, `threshold?` (default 0.3) | output text and JSON |
| `studio_say` | `name`, `text`, `voice?` | path of `audio/say.wav`, which the user plays to check a pronunciation |
| `studio_transcribe` | `name`, `file?` (a clip or a `.srt`/`.vtt`/`.json` to import) | job |
| `studio_look_from` | `name`, `files` (array of image or video paths) | job; the look card as an image |
| `studio_stills` | `name`, `times?` (array of seconds), `platform?` | job; the sheet and safe area guide as images |
| `studio_render` | `name`, `draft?` | job |
| `studio_check` | `name` | job; the check lines and the final sheet as an image |
A failed compose inside `stills` or `render` returns the lint errors as the job result. `studio_doctor` takes
`full?`. Every CLI flag has exactly one tool input with the same name; T0 checks this.
| `studio_job_status` | `job_id`, `wait_sec?` (≤ 25) | state and progress text; when done, the result with contact sheets as image content |
| `studio_job_log` | `job_id`, `lines?` | last lines of the job log |
| `studio_open` | `name` | absolute MP4 path and a `file://` link |
| `studio_export` | `name`, `dest`, `overwrite?` | refuses a `dest` that exists and is not empty unless `overwrite` is true; never follows symbolic links; copies only `project.json`, `src/`, `brief.md`, `shots.md` and `feedback.md` to `dest` (for filing sources in a repo under `media/<slug>/`); never `comp/`, `stills/`, `audio/`, `out/`, `history/` or footage |
| `studio_synctest` | none | job; the 7.9 B result |
| `studio_import_hyperframes` | `folder`, `name` | 8.6 |
| `studio_hyperframes` | `name`, `command`, `args` | 8.6 |
Path rules for every file tool: the path is resolved inside the project folder and refused if `path.relative`
leaves it; writes are allowed only to `project.json`, `brief.md`, `shots.md`, `feedback.md`, `src/**` and `*.srt`/`*.vtt`; reads anywhere in the
project. `from_path` and `video_path` may be anywhere the user names.
Images returned are JPEG, at most 1600 px wide and 1 MB, as MCP image content.
**Named limits for Claude Desktop** (written in SKILL.md and `references/mcp.md`): there is no web access, so
fonts beyond the bundled Manrope, Inter, Cormorant Garamond and Jost come only from files the user gives (`studio_file_add`); a video attached in the
chat has no file path, so the user types the path of a file on the Mac.

### 8.3 Jobs
A job spawns `studio.mjs` with the runtime Node, detached, writing `<home>/jobs/<id>.log` and `<id>.json`
(`state` queued, running, done, failed; `started`, `ended`, `exit_code`, `result`). Heavy jobs wait on
`locks/heavy.lock`. Status survives a server restart.

### 8.4 Resources and prompts
Resources: `synergy://skill` (SKILL.md), `synergy://references/<name>`, `synergy://examples/<name>/project.json`
and `synergy://examples/<name>/index.html`. Prompts: `new-video` (`idea`), `improve-video` (`video_path`, `goal`).

### 8.5 Packaging
- **Claude Code:** the repo is the plugin root. `plugin.json` names the plugin `synergy-studio`; `.mcp.json`
  names the server `synergy-studio` and runs `node ${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs`; the skill is in
  `skills/`. Install locally through the repo's `marketplace.json`. The exact commands come from the current
  Claude Code documentation, recorded in `research/claude-code-plugins.md` and written into `README.md`.
- **Claude Desktop:** `scripts/pack-bundle.mjs` builds `dist/synergy-studio.mcpb` from `bundle/manifest.json`,
  `mcp/` and `skills/`, with the current official bundle tool (commands from the current documentation, in
  `research/claude-desktop-bundles.md`), and validates it with that tool. Installing and using it is the owner's test.

### 8.6 Plain HyperFrames projects (the owner's design: his LITE.md section 6 at commit `30127c8`)
- `studio_import_hyperframes({folder, name})` copies an existing HyperFrames folder (its own `index.html`,
  assets and mixed audio) into the projects folder as `<name>` with `kind: "hyperframes"`; compose
  (placeholders, timing) is skipped for it. The LSPedia OneScan ad is not a HyperFrames project (its own
  Playwright renderer and `scripts/build.sh`); the tool refuses a folder without a HyperFrames `index.html`
  and says so.
- `studio_hyperframes({name, command, args})` runs the server's own HyperFrames on that project.
  Allowed commands: `render lint check validate snapshot inspect info timeline compositions transcribe tts beats
  normalize-audio remove-background`. Refused: `publish cloud lambda cloudrun auth upgrade feedback add catalog
  preview` and anything not on the allowed list. The server passes the project folder itself as the command's
  folder argument; `args` holds only flags and their values. Every argument that is not a flag, and the value of
  every output or input path flag (`-o`, `--output`, `-d`, `--dir` and any flag whose value contains a path
  separator), is resolved against the project folder and refused if it leaves it. `tts`, `transcribe` and
  `remove-background` may download models on first use; `mcp.md` says so.
  `spawn(node, [hyperframes.mjs, command, ...args], {shell: false})`, with the tool home's `bin/` first on PATH,
  `HYPERFRAMES_SKIP_SKILLS=1`, `HYPERFRAMES_NO_TELEMETRY=1`. `render` and `transcribe` run as jobs. The result is
  the `--json` output where the command supports it, otherwise the last 4 KB of text.
- `studio_check` works on a `kind: hyperframes` project: duration against the page's `data-duration`, and the
  audio against mix line only when the project names its mixed audio file.

---

## 9. The skill
**The owner's skill is finished** (commit `30127c8`). It arrives with the starting code at L0 (1.3a); its text is
corrected at L7, after everything else works.

**Rule:** where SKILL.md and the MCP build disagree, the build's real tools are the truth. SKILL.md and
`references/*.md` are fixed to match, and no contradiction is left. The owner's specific corrections:
1. Front matter `compatibility:` becomes "Needs the Synergy Studio MCP server (tools named studio_*)."
2. Step 0 becomes: "Setup: call studio_doctor. If it reports 'not set up', tell the user it downloads about 1 GB
   once (5 to 10 min) and call studio_setup_start, polling studio_job_status. Never ask the user to install Node
   or Python."
3. "Where projects live" becomes: "Projects live in the server's projects folder. Create, list and open them only
   through the server's tools, never by file path. To keep a finished video's sources in a git repo, export them
   with studio_export and file them under media/<slug>/: only project.json, src/, brief.md, shots.md, feedback.md
   (never comp/, stills/, audio/, out/, history/). Give the MP4 to the user directly."
4. The older projects line becomes: "Older HyperFrames projects: import them with studio_import_hyperframes, then
   render and check them with studio_hyperframes (or studio_check). The LSPedia ad is not HyperFrames (its own
   Playwright renderer and scripts/build.sh), so it does not import."
5. Sweep: every `studio <command>` in SKILL.md and `references/*.md` becomes the matching tool name (8.2). Every
   command has a tool, so no mention is removed for lack of one; any instruction that still cannot be carried out
   with a tool is rewritten or removed, and listed in `BUILD_LOG.md`.
6. The build also adds: `references/mcp.md` (tools, jobs and waiting, images returned, the Claude Desktop limits
   in 8.2); `references/styles.md` (below) with one line in SKILL.md step 3 pointing to it; mentions of the added
   tools (`studio_project_import`, `studio_frames`, `studio_look_from`, `studio_synctest`) and caption styles where
   they belong; `references/commands.md` becomes the tool reference (each command's tool, inputs and outputs); and, if his text lacks it, the non interactive rule (when
   nobody can answer, take the stated defaults, mark PROPOSED items, and say so).
7. The writing rules at the top of this file apply to the shipped text: dashes used as punctuation and version
   labels are rewritten, and a grep over SKILL.md and references for both comes back empty.
8. Last, a fresh Sonnet worker that has not seen the build reads SKILL.md top to bottom as a new agent would, with
   the tool list from `tools/list`, and reports every instruction that maps to no existing tool; the list must
   be empty.

`references/styles.md`: how to reach any style. Built in looks; a custom look from words (variables, two font
families at most, open licence fonts in `src/assets/fonts/`); a look from a reference; deterministic techniques
for textured and hand drawn styles, using the owner's sketch kit (`template/sketch.js`: hatching, line boil, ink
outlines, paper and scratch textures, glow, camera, seeded `rng` and `hash`) and `SS.start({cuts: "hard"})` for
match cuts; drawing on twos inside a 24 fps render; particles and generative shapes on a canvas whose `draw()` depends only
on tween state; 60 fps motion pieces. Every technique has a snippet that the build has rendered.

### 9.1 `lib.js` helpers
`SS.start()` returns every helper the skill names (at commit `30127c8`: `tl, T, EV, TOTAL, V, S, at, rise, fadeIn,
fadeOut, pop, press, pick, count, drawIn, stagger, kenburns, punch, captions, finish`, and any others its examples
use). Scenes fade in at start and out at end automatically, unless `SS.start({cuts: "hard"})`. Textures, line boil
and seeded randomness come from the owner's sketch kit (`template/sketch.js`, compose copies it); this build adds
no second copy of them.
- `captions({top, size, font, color, highlight, box, boxColor, maxWords, maxChars, from, to, style})`: word by
  word captions from `window.WORDS`; `style` is `color` (active word recoloured), `pop` (active word scaled 1.15
  and recoloured) or `box` (active word gets a box); it records every group with its words and times in
  `window.__SS.captions`, which `render` saves as `out/captions.json`. `finish()` already sets
  `window.__SS = {seek, duration}` for the renderer; `captions()` adds to that object and never replaces it.
The page keeps the literal line `window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;`.

### 9.2 Looks (`looks.css`)
Variables: `--bg --bg2 --ink --muted --line --card --accent --accent2 --accent3 --accent4 --soft --soft2 --soft3
--ok --bad`. Classes: `.h1 .card .chip .lbl .step .bubble.user .bubble.bot .win .muted .accent .abs .scene`.
Looks: `paper` (warm cream, ink, coral, blue, teal), `midnight` (navy, cyan, blue), `bold` (yellow, black, hot pink),
`luxe` (near black, warm ivory, gold; Jost and Cormorant Garamond), with the exact values from the owner's
`looks.css`. Bundled fonts: Manrope 700 and 800, Inter 400 to 700, Cormorant Garamond 400 to 700, Jost 300 to 500. Text sizes at 1080 px short side: headlines 64 px or more,
body 28 to 44 px, labels 22 px or more, captions 64 to 80 px. Safe areas at 1080x1920 (top, bottom, left, right, in px): tiktok 200, 400, 60, 180; reels 269, 672, 65, 65;
shorts 288, 672, 60, 201 (reels from Meta's published figures; tiktok and shorts are working defaults, not official).
`stills` draws them in red on `safe-<platform>.jpg`; key text stays out, captions may sit inside the lower band.

---

## 10. Examples (the owner's, in the starting code; each must pass `check` with the changed scripts)
| Folder | Kind | Must show |
|---|---|---|
| `hydration-tips/` | narrated, 9:16, `midnight`, about 28 s | scenes from `project.json`, events with sound, a counter |
| `footage-captions/` | footage, 9:16, `bold`, about 13 s | `edit` clips, word captions, overlays, a punch on the cut, `caption_fixes` |
| `three-product/` | three.js product shot, 16:9, `paper`, about 7 s | import map, `draw()` from tween state, soft shadow, camera orbit, HTML label |
Examples ship without renders. `footage-captions` needs a 16:9 clip of at least 25 s at `src/footage/clip.mp4`: the T5
harness copies `reference/videos/onescan.mp4` there (never committed) and makes its captions with `transcribe` from
that clip's narration instead of the shipped `captions.srt`, which was timed to a different clip. If T3 is PENDING,
this example is PENDING with it.

---

## 11. Tests and the lite gate
Every test writes its literal output to `BUILD_LOG.md`. Thresholds and fixtures are fixed **before** a test
first runs and are never changed to make it pass; a miss is BLOCKED with the measured values.
**Judged tests:** content tests (T7, T8, T9) are judged with the skill's own review list (`references/review.md`), given
`brief.md`, `stills/sheet.jpg`, `stills/final-sheet.jpg` and `stills/safe-<platform>.jpg`:
every ⛔ guard rail TRUE, every ◇ craft check TRUE or FALSE with a one line reason. Style tests (T10 to T13) use
a style match rubric the orchestrator writes into `test/rubrics/<test>.md` before any video is built (scores 1 to
5, what a 1, 3 and 5 look like, the evidence to cite). One fresh Sonnet subagent receives only the
evidence named and the rubric and returns JSON `{item, result, evidence, frame_refs}` per item (`result` is TRUE, FALSE or N/A for review items, 1 to 5 for style items). A score is final
for that version of the work; to raise it, change the work and judge again with a new subagent. Judged tests
get three rounds; after the third failing round the test is BLOCKED with the score files.
**Other tests** get two honest attempts before BLOCKED.

| # | Test | Pass | Falsifier run alongside (must fail) |
|---|---|---|---|
| T0 | skill contract (run against `reference/lite-branch` at the end of L5 and L6, and against the adopted text at L7) | a script lists every `studio <command>`, every `--flag`, every file name and every helper named in SKILL.md, `references/` and the examples at commit `30127c8`, and proves each exists: after L7 each named tool is in `tools/list`; the command's usage text shows the flag, the file is produced by the command the skill says, the helper is returned by `SS.start()`; the list and results go in `BUILD_LOG.md` | the same script run against a copy of SKILL.md with a made up command `studio fly` fails |
| T1 | setup into a temporary home with a space in its path (`tmp/home test/`), then `doctor --full`; then setup into the default home and `doctor --full` again | every line PASS both times (`synctest` is not part of T1; it needs render, built at L4), including the three.js test render (the 60 fps line may be WARN, which makes T10 BLOCKED with that reason); setup time and `du -sh` of each home folder recorded; a second `setup` skips every step | rename `bin/ffprobe`: doctor shows FAIL with the fix |
| T2 | compose lint | each rule in 7.6 has a fixture page refused with that rule's message | a clean page composes |
| T3 | first transcription on the Mac | Whisper downloads and `transcript.json` holds words for raw clip `c1` | an empty WAV gives a plain error, not a crash |
| T4 | word timing accuracy of `transcribe` | fixture: 20 different words synthesised one at a time with Kokoro, joined with gaps of 0.30 to 0.70 s (fixed list); the true onset of each word is the first sample of its clip whose absolute value exceeds 0.01; median absolute onset error ≤ 80 ms, 95th percentile ≤ 200 ms | the same scorer on evenly spaced fake timings fails |
| T5 | examples | all three render and pass `check` | a copy of hydration-tips with one `data-start` id removed fails compose |
| T6 | determinism | hydration-tips plus a sketch kit page (hatching, line boil, paper grain, drawn with `rng(1)`), each rendered twice: decoded frames at 1 s, the middle and the last second are identical | the same sketch kit page with `rng(2)` differs |
| T7 | Haura improve | the four raw clips become a 9:16 reel with trims, warm grade, word captions (`style: "pop"`), a name tag, topic chips, product photos appearing within 0.4 s of the words that name them, a follow card and an end card. `check` all PASS. `out/captions.json` holds at least 90% of the transcript's words. The mean absolute pixel difference in the caption band (full width, from the captions `top` to `top` plus 2.5 times the caption `size`), between a still at a spoken word and the same still with `captions()` removed, is above 10 on a 0 to 255 scale. A judge confirms each element is visible, citing frames | (a) the same page with `captions()` removed fails the captions assertions; (b) the MP4 with its audio delayed 3 frames (ffmpeg `-itsoffset`) fails the audio against mix check |
| T7s | `synctest` and the footage warning | `synctest` passes (7.9 B) and reports its mean offset; `cut` on a generated clip whose audio stream starts 0.2 s after its video prints the warning (7.9 C), and on a clean clip does not | a synctest page with its beeps placed 3 frames late fails |
| T8 | improve a finished MP4 | `import` of `onescan.mp4` becomes a 9:16 cut down of about 30 s with `crop_x` chosen per clip, word captions from its narration and an end card; `check` all PASS; captions assertions as T7; a judge confirms no on screen text is cut off by the crop, citing frames | the same project with `crop_x: 0` on every clip is judged as cutting text off |
| T9 | OneScan family | an original narrated 16:9 explainer of 45 to 60 s in `midnight` on a topic the agent picks (not OneScan); `check` PASS; a judge runs the review list of `references/review.md` on its stills with `reference/breakdowns/onescan.md` as the quality reference: every ⛔ TRUE, every ◇ TRUE or explained | |
| T10 | motion reel | an original 15 to 20 s piece in `mode: film` with `fps: 60`, English on screen text, generated music, no voice, kinetic type, particles or generative shapes, a frame overlay; `check` PASS; the build is given the path of `motion-reel.mp4` and must call `studio_frames` and `studio_look_from` on it (shown in its output); judge scores style match ≥ 4 against the reel contact sheet and confirms no copied text | the same MP4 converted to 30 fps with ffmpeg makes `check` exit 2 |
| T11 | doodle style check | plan and stills only, original topic; the build is given the path of `doodle-timeline.mp4` and derives its look with `studio_look_from`; judge scores style match ≥ 4 against the doodle contact sheet | |
| T12 | cosmos style check | stills plus a 6 s render showing line boil, a walk cycle of an original simple character and a zoom through an element; judge scores style ≥ 4; the build's own review records its frame check that no character resembles a known mascot or character (Claude's responsibility, 1.3) | |
| T13 | look from reference | `look --from` on each of the five reference videos gives a look that composes; judge scores palette and texture ≥ 4 for each against its reference | the `paper` look card judged against the cosmos reference scores ≤ 2 |
| T14 | MCP protocol | an SDK client over stdio with an empty home: `initialize` answers in under 1 s and returns the `instructions`; lists every tool, resource and prompt; `studio_guide` text equals SKILL.md with paths resolved; a `../` path in a file tool is refused; `studio_hyperframes` refuses `publish`, refuses an `-o` outside the projects folder, and runs `lint` on an imported fixture; `studio_import_hyperframes` refuses a folder without a HyperFrames `index.html` and imports a tiny plain HyperFrames fixture, which then renders and passes `studio_check`; `studio_export` copies only the five allowed items and refuses a non empty `dest` without `overwrite` | a server build with one tool removed fails the tool list assertion |
| T15 | MCP scripted end to end | a script (not Claude) rebuilds hydration-tips through MCP calls only, in the default homes: new, file writes, voice, audio, stills returning an image, render job, check job; `check` PASS. This proves the server, not Claude | |
| T16 | Claude Code live, new video | plugin installed from the repo; `claude -p "Use Synergy Studio to make a 15 second 9:16 video about drinking water before coffee"` with `--allowedTools` set to the plugin server's tools only (`mcp__synergy-studio__*` or the name the installed plugin actually uses, recorded) and `--disallowedTools Bash,Edit,Write`, `--model sonnet` and stream JSON output; an MP4 exists and `check` passes; the output shows `studio_guide` called before any other studio tool and no Bash, Edit or Write call | the same run with the plugin disabled produces no MP4 |
| T16b | Claude Code live, improve | same restrictions and assertions as T16: "Use Synergy Studio to improve this video: add word captions and an end card", with the path of `reference/footage/haura/c1.mp4`; `check` passes with captions | |
| T17 | Claude Desktop bundle | `dist/synergy-studio.mcpb` builds and validates with the official tool | |
| T18 | Claude Desktop by the owner | installs the bundle, asks for a video, gets an MP4 | owner's test; PENDING until he reports |

**Residual gaps named in advance:** `beats` can miss a click exactly at 0 s (the owner's known open item); no automatic image judge; recognising logos, mascots and characters in
frames rests on Claude's review (1.3); the per video check compares audio with its mix, and picture against
sound is proven once per computer by `synctest`, not per video; Whisper depends on
huggingface.co for its first download (if it is blocked, T3, T4, T7, T8 and T16b are PENDING, and they close
when James runs `transcribe` once on a network that reaches it or places the model file by hand as
`research/whisper-model.md` describes); Windows and Linux; rendering with the network off; voices other than
the ten listed; videos longer than 90 s.

**The lite gate is met** when T0 to T17 (with T7s and T16b) are PASS, `node --test` and `pytest` pass,
`README.md` gives install and use steps for Claude Code and Claude Desktop, and `BUILD_LOG.md` ends with the
final report (section 12). Any test that is PENDING or BLOCKED instead is listed as "awaiting James's written
acceptance"; the gate is then reported as "met except" those items, never as met.

---

## 12. Final report (last entry in `BUILD_LOG.md`, also the agent's last message)
For each test: PASS, PENDING or BLOCKED, with the literal command output that proves it. Then: every PENDING
and BLOCKED item with what would close it and who can; what was not checked; the largest gap, marked as such;
measured sizes of the tool home and the repo; which worker and model did each task. The pushed commit is named in the last message only, since a commit cannot contain its own hash.

---

## Changes made during the build
| Date | Change | Reason |
|---|---|---|
| 2026-09-30 | The MCP server supports protocol versions `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05` through `initialize`; a client asking for another version gets `2025-11-25`. Array lines (batches) get `-32600`. The server logs the version each client requests. | `research/mcp-protocol.md`: the newest revision (`2026-07-28`) replaces `initialize` with per request metadata, but Claude Code sent `initialize` on this Mac on 2026-09-30, and 8.1 names `initialize`. T14 and T16 confirm what the clients send. |
| 2026-09-30 | `setup` builds whisper.cpp's `whisper-cli` from a pinned, hashed source release into `<home>/runtime/whisper/` with cmake from PyPI and the Xcode Command Line Tools compiler, and every HyperFrames call gets `HYPERFRAMES_WHISPER_PATH`. Without a compiler, setup says transcription is unavailable and continues. | `research/whisper-model.md`: HyperFrames 0.8.92 does not ship whisper-cli and otherwise runs `brew install whisper-cpp` or a git clone build on first transcription, which this build may never do. |
| 2026-09-30 | When `project.json` omits `lead`, `pre`, `post` or `tail`, `audio` and `budget` use the section 6 defaults for the aspect (the owner's code used `post` 1.5 for every aspect). | Section 6 names the defaults by aspect; `new` already writes these values, so only hand written projects change. |

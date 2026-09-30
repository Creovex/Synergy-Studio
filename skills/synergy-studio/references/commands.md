# Commands and project.json (the complete reference)

Every tool is one command of the CLI:
```sh
node <skill folder>/scripts/studio.mjs <command> [args]     # "studio <command>" in these docs
node <skill folder>/scripts/studio.mjs help                 # the same list, printed
```
The tool home (installed programs) is `$SYNERGY_STUDIO_HOME`, by default `~/.synergy-studio`. Every command
except `setup`, `doctor` and `help` takes the project folder as its first argument. A command that fails
prints `ERROR: …` with the fix, and exits with a non-zero code (`check` exits 2 when a check fails).

## 1. The order of work per mode
| Mode (`"mode"` in project.json) | Use for | Order |
|---|---|---|
| `narrated` (default) | explainers, ads, tips: the voice sets the timing | `new` → `budget` → write `say` lines → `voice` → `audio` → `words` → add `events` → `audio` → write `src/index.html` → `stills` → `render` → `check` |
| `footage` | the user's own clips (talking head, product shots) | `new --mode footage` → put clips in `src/footage/` → `edit.clips` → `cut` → `transcribe` → set scene times → `audio` → page → `stills` → `render` → `check` |
| `film` | wordless story, music piece, showreel, photo ad to a song | `new --mode film` → music file (user's track or your score script) → `beats` (optional) → scene times → `audio` → page → `stills` → `render` → `check` |
You don't need to run `compose` yourself: `stills` and `render` run it first.

## 2. Every command
| Command | Arguments | What it does | Reads | Writes |
|---|---|---|---|---|
| `setup` | `[--whisper-model <ggml-*.bin>]` | one-time install (about 1.1 GB, 5–10 min): Node packages (HyperFrames 0.8.92, GSAP, three.js, fonts, ffprobe), a Python venv (Kokoro, ONNX Runtime, numpy, soundfile), the voice model, ffmpeg, HyperFrames' Chrome; then captions: whisper-cli (on PATH, or built from github.com/ggml-org/whisper.cpp with cmake + a C compiler) and the Whisper `small.en` model (about 466 MB, from huggingface.co). Captions are optional: if they fail, setup still succeeds and says why. `--whisper-model f` installs a model file you downloaded elsewhere (also works after setup) | – | `$SYNERGY_STUDIO_HOME/…`, `env.json`, `~/.cache/hyperframes/whisper/` |
| `doctor` | – | checks the install; FAIL lines must be fixed, WARN lines (captions) are optional; each says the fix | `env.json` | – |
| `new` | `<dir> [--mode narrated\|footage\|film] [--aspect 16:9\|9:16\|1:1\|4:5] [--platform …] [--length s] [--look paper\|midnight\|bold\|luxe]` | project skeleton. Aspect defaults to 16:9; 9:16 defaults to platform `tiktok`; the length defaults to 30 s (9:16) or 60 s | `template/` | `project.json`, `src/index.html`, `src/assets/`, `brief.md`, `shots.md`, `feedback.md` (+ `src/footage/` for footage) |
| `budget` | `<dir>` | narrated: how many words fit, per scene and in total, for `length` | project.json | – |
| `say` | `<dir> "text" [--voice id]` | narrated: speaks one line to check a pronunciation | project.json (`lexicon`, `voice`) | `audio/say.wav` |
| `voice` | `<dir> [--only s2,s4]` | narrated: Kokoro narration per scene; warns above 3.5 words/s | `scenes[].say`, `voice`, `speed`, `lexicon` | `audio/vo/<id>.wav`, `durations.json` |
| `audio` | `<dir>` | all modes: scene timing, music (generated, the user's song or your score), ducking, sound effects, mix at −14 LUFS; prints each scene's times | project.json, durations.json (narrated), `audio/voice.wav` (footage) | `timing.json`, `timing.js`, `audio/mix.wav` |
| `words` | `<dir>` | narrated only: estimated word times from the narration (±0.25 s) | project.json, timing.json | `transcript.json` |
| `compose` | `<dir>` | lint, fill `{{placeholders}}`, copy the libraries, fonts and assets | `src/`, timing.json, transcript.json | `comp/` |
| `stills` | `<dir> [t1 t2 …] [--platform p]` | compose + a page-error and contrast check + frames. Default times: 0.3 s, then the middle of each scene and the end of its narration (or the end of the scene), then the last half-second | comp/ | `stills/sheet.jpg` (all frames in time order; look at this one), `stills/safe-<platform>.jpg` (9:16), `stills/frame-*.png` |
| `render` | `<dir> [--draft]` | compose + HyperFrames render + loudness fix. A previous render (with the sources that made it) moves to `history/<time>/`. Over 25 MB it also writes a `-share.mp4` (≤ 23 MB, 720p when long) | comp/ | `out/<name>-<aspect>.mp4`, `out/source-project.json`, `out/source-index.html` |
| `check` | `<dir>` | 8 checks: video stream, audio stream, duration (timeline ±0.15 s), target length (≤ 105%; notes if much shorter), loudness −14 ±1 LUFS, true peak ≤ −1 dBTP, no black stretch ≥ 0.5 s, nothing frozen ≥ 4 s | out/*.mp4 | `out/check.json`, `stills/final-sheet.jpg` |
| `cut` | `<dir>` | footage: trims, orders, crops to the aspect, grades and cleans the voice of `edit.clips` | `edit` in project.json | `src/assets/base.mp4`, `audio/voice.wav`, `cuts.json` |
| `transcribe` | `<dir> [media or .srt/.vtt/.json]` | footage: word times of `audio/voice.wav` (Whisper; the first run downloads the model from huggingface.co) or of the file given. A caption file is imported instead (an .srt gives phrases; `captions()` spreads the words inside each phrase) | the media or caption file | `transcript.json` |
| `silences` | `<dir> <clip> [--db -32] [--min 0.4]` | pauses and speech pieces in a clip (to cut dead air) | the clip | `silences-<clip>.json` |
| `scenes` | `<dir> <clip> [--threshold 0.3]` | shot changes in a clip (to find usable shots) | the clip | `scenes-<clip>.json` |
| `beats` | `<dir> <song> [--start s]` | tempo and beat grid of a song; times count from `--start` | the song | `beats.json` |
| `reference` | `<dir> <video> [--every 2]` | reference study: contact sheet (one frame every N s) + shot changes and average shot length | the video | `reference/sheet.jpg`, `reference/cuts.json` |

Transcribe once, **after** `cut`, on `audio/voice.wav`: then the word times match the edited video. Transcribing
the raw clips gives raw-clip times, and each run replaces transcript.json.

## 3. project.json
Common fields (all modes):
| Field | Default | Meaning |
|---|---|---|
| `name` | the folder name | the output file name |
| `mode` | `"narrated"` | `narrated` · `footage` · `film` |
| `aspect` | `"16:9"` | `16:9` · `9:16` · `1:1` · `4:5` |
| `platform` | `tiktok` for 9:16, else none | `tiktok` `reels` `meta` `shorts` (safe areas) · `youtube` `linkedin` `x` `website` |
| `length` | 30 (9:16) / 60 | target seconds (`budget`, the audio warning, `check`) |
| `fps` | 30 | frames per second |
| `music` | `"warm"` | `"warm"` · `"calm"` · `"upbeat"` · `"none"` · `{"file": "src/assets/song.mp3", "start": 47.3, "gain_db": -3}` (path relative to the project; `start` = where in the song to begin) |
| `events` | `{}` | `{"s2": {"card": 0.4, "tick": {"t": 1.4, "sfx": "pop"}}}`; `sfx` is `pop`, `click` or `whoosh`. `t` counts from the narration start (narrated) or the scene start (footage, film). Use them in the page with `at("s2", "tick")` |
| `transition_whoosh` | true (false in film) | a soft whoosh at every scene change |
| `caption_fixes` | `{}` | `{"Hora": "HAURA"}`: fixes words in transcript.json when composing |

Narrated only:
| Field | Default | Meaning |
|---|---|---|
| `scenes[]` | – | `{"id": "s1", "say": "…"}`; optional per scene: `voice`, `speed`, `pre`, `post`, `hold` (extra silent seconds after the line) |
| `voice`, `speed` | `af_heart`, 0.95 | Kokoro voice id (voice-and-audio.md) and speed (0.85–1.05) |
| `lexicon` | `{}` | pronunciation spellings: `{"HAURA": "Hora"}` |
| `lead`, `pre`, `post`, `tail` | 0.9, 0.6, 1.5, 2.5 (`new` writes 0.4/0.3/0.7/2.0 for 9:16 and 0.9/0.6/1.2/2.5 for 16:9) | pause before the first line, before each line, after each line, after the last scene |

Footage and film:
| Field | Meaning |
|---|---|
| `scenes[]` | `{"id": "s1", "start": 0, "end": 4.2}` in seconds of the finished video; `start` and `end` are required |
| `edit` (footage) | `{"clips": [{"src": "src/footage/a.mp4", "in": 0.4, "out": 8.7}], "grade": "warm\|neutral\|none", "clean_voice": true}` |
| `voice_track` (footage) | `false` = don't use the clips' sound (a photo ad or footage to music); film mode sets this for you |

## 4. The page (src/index.html)
Placeholders filled by compose: `{{W}}`, `{{H}}`, `{{FPS}}`, `{{TOTAL}}`, `{{s1.start}}`, `{{s1.dur}}`, `{{s1.end}}`, `{{s1.vo}}`.
From `SS.start(opts)` (lib.js; `opts`: `{cuts: "hard"}` = no automatic scene fades, `{fadeFirst: true}`):
`tl` (the GSAP timeline), `T` (scene times), `EV` (events), `TOTAL`, `V(scene, offset)` (from the narration start),
`S(scene, offset)` (from the scene start), `at(scene, event)`, `E` (the default ease). Helpers:
`rise`, `fadeIn`, `fadeOut`, `pop`, `press`, `pick`, `count`, `drawIn`, `stagger`, `kenburns`, `punch`, `captions`, `finish`.
Canvas films: `SK.create(canvas)` from sketch.js (illustration.md). 3D: three.js via an import map (three.md).
Rules: hyperframes.md. The page must contain `window.__timelines["main"] = tl;` literally.

## 5. Older plain-HyperFrames projects (their own index.html, no project.json)
Run HyperFrames directly with the installed copy: `node <hyperframes path from studio doctor> render <folder> -o out.mp4`.
The planned MCP tools `studio_import_hyperframes` and `studio_hyperframes` will wrap this; they are not built
yet (LITE.md §6).

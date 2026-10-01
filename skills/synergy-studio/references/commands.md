# Tools and project.json (the complete reference)

Everything runs through the Synergy Studio tools (`studio_*`). Each tool does one job of the program that
the server carries; the names differ from the program's command names in a few places:
| Command of the program | Tool |
|---|---|
| `setup` | `studio_setup_start` |
| `doctor` | `studio_doctor` |
| `new` | `studio_project_new` |
| `import` | `studio_project_import` |
| `reference` | `studio_reference_study` |
| `look` | `studio_look_from` |
| `brand` | `studio_brand_check` |
| every other command (`frames`, `budget`, `say`, `voice`, `audio`, `words`, `compose`, `cues`, `score`, `stills`, `render`, `check`, `cut`, `transcribe`, `silences`, `scenes`, `beats`, `synctest`) | the tool of the same name with the prefix `studio_` |

Every option of a command is an input of its tool with the same name. The project folder is always given as
`name` (lower case letters, digits and hyphens, at most 40 characters): projects live in the server's projects folder
(on a Mac `~/Movies/Synergy Studio`, one folder per video) and you never handle that path yourself. The tool home
(the installed programs) is `~/Library/Application Support/SynergyStudioLite` on a Mac; you never need it either.
A tool that fails returns the error with the fix in plain words. Which tool to use when, jobs, pictures and the
Claude Desktop limits: mcp.md.

## 1. The order of work per mode
| Mode (`"mode"` in project.json) | Use for | Order |
|---|---|---|
| `narrated` (default) | explainers, ads, tips: the voice sets the timing | `studio_project_new` → `studio_budget` → write `say` lines → `studio_voice` → `studio_audio` → `studio_words` → add `events` → `studio_audio` → write `src/index.html` → `studio_stills` → `studio_render` → `studio_check` |
| `footage` | the user's own clips (talking head, product shots), or a finished MP4 from `studio_project_import` | `studio_project_new` with `mode: "footage"` → `studio_file_add` the clips → `edit.clips` → `studio_cut` → `studio_transcribe` → set scene times → `studio_audio` → page → `studio_stills` → `studio_render` → `studio_check` |
| `film` | wordless story, music piece, showreel, photo ad to a song | `studio_project_new` with `mode: "film"` → scene times and the cue sheet in project.json (`cues`), then `studio_cues` → the music: `src/score.json` anchored to the cues (music-for-picture skill) or the user's licensed track (`studio_file_add`, `studio_beats` optional); without either, the bundled starter score (a soft bed and a placeholder hit on every cue) → `studio_score` (checks and renders the score file, or writes the starter) → `studio_audio` → block the page with plain shapes → `studio_stills` with `cues: true` → change the score or the cues where picture and sound disagree → `studio_audio` → draw the detail → `studio_stills` with `cues: true` → `studio_render` → `studio_check` (it checks sync) |
| `kind: "hyperframes"` | an older plain HyperFrames folder | `studio_import_hyperframes` → `studio_hyperframes` (`lint`, `render`, `snapshot`) → `studio_check` |
You don't need to call `studio_compose` yourself: stills and render run it first. Call it to see every lint error and
warning at once.

## 2. Every tool
### Guide and setup
| Tool | Inputs | What it does | Result |
|---|---|---|---|
| `studio_example` | `path` (relative to the skill folder, only under `examples/` and `template/`) | reads an example or template file, for example `examples/three-product/src/index.html`, `examples/hydration-tips/project.json`, `template/sketch.js`, `template/lib.js` | text |
| `studio_guide` | none | this guide (SKILL.md) with the skill folder written out, plus the list of references | text |
| `studio_reference` | `name` | one reference file (`craft`, `design`, `footage`, `styles`, `mcp` ...) | text |
| `studio_doctor` | `full?` | one PASS or FAIL line per part: node, uv, Python and Kokoro, model files, ffmpeg, ffprobe, binary architecture, HyperFrames, render browser, Whisper program and model, instruments (tinysoundfont and the SoundFont), free disk, the last synctest. FAIL lines must be fixed; WARN lines (captions) are optional and each says the fix. `full: true` also renders a 1 s 60 fps page and a 1 s three.js page as a job | text (job with `full`) |
| `studio_setup_start` | `whisper_model?` (full path of a `ggml-small.en.bin` downloaded elsewhere), `soundfont?` (`fluidr3` or `musescore-lite` to download one, or the full path of a `.sf2` or `.sf3` file) | one-time install as a job (about 1 GB, 5 to 10 min): Node packages (HyperFrames, GSAP, three.js, the four font families, ffprobe), a Python venv (Kokoro, ONNX Runtime, numpy, soundfile, tinysoundfont), the voice model, the MuseScore General SoundFont (about 40 MB, MIT), ffmpeg, HyperFrames' Chrome, then captions: the Whisper program (built once, needs the Xcode command line tools) and the Whisper `small.en` model (about 466 MB). Captions are optional: if they fail, setup still succeeds and says why. Ends with the doctor lines and the synctest | job |
| `studio_synctest` | `beep_offset?` (a test only: beeps that many frames late, to prove the test can fail) | renders a 10 s test video of white flashes and beeps and checks that each flash and beep land within one frame; the result is kept for the doctor | job |

### Projects and files
| Tool | Inputs | What it does | Reads | Writes |
|---|---|---|---|---|
| `studio_project_new` | `name`, `mode?` `aspect?` `platform?` `length?` `look?` | project skeleton. Aspect defaults to 16:9; 9:16 defaults to platform `tiktok`; length defaults to 30 s (9:16) or 60 s. `look` sets `data-look` in the starter page, it is not a project field | the skill's templates | `project.json`, `src/index.html`, `src/assets/`, `brief.md`, `shots.md`, `feedback.md` (+ `src/footage/` for footage) |
| `studio_project_import` | `name`, `video_path`, `aspect?` (default 9:16) | a footage project from a finished video anywhere on the Mac: copies it to `src/footage/`, one clip covering the whole file, prints duration, frame rate, size and whether it has audio, returns the source sheet as an image | the video | project, `stills/source-sheet.jpg` |
| `studio_project_list` | none | projects with kind, aspect, last change and whether an MP4 exists | | |
| `studio_frames` | `video_path`, `n?` (1 to 60, default 12), `out?` (a `.jpg` inside the projects folder or the tool home) | a contact sheet of any video, in time order, without a project | the video | one JPEG |
| `studio_reference_study` | `name`, `video_path`, `every?` (seconds, default 2) | reference study: contact sheet (one frame every N seconds) plus shot changes and average shot length | the video | `reference/sheet.jpg`, `reference/cuts.json` |
| `studio_file_list` | `name` | every file of the project with its size | | |
| `studio_file_read` | `name`, `path` | text up to 200 KB, or a picture (`jpg`, `png`) as an image. Reads anywhere inside the project | | |
| `studio_file_write` | `name`, `path`, `content` | replaces a whole text file (to add to one, read it with `studio_file_read` first and write back all of it). Allowed: `project.json`, `brief.md`, `shots.md`, `feedback.md`, anything under `src/`, and `.srt` or `.vtt` files. Answers with the bytes written and the first and last line read back | | the file |
| `studio_file_add` | `name`, `from_path`, `to?` | copies a file the user has (logo, photo, clip, song, font) into `src/assets/`, `src/assets/fonts/` or `src/footage/` (`to` picks the folder or a file path inside one; the default follows the file type) | the user's file | `src/...` |
| `studio_export` | `name`, `dest`, `overwrite?` | copies `project.json`, `src/`, `brief.md`, `shots.md`, `feedback.md` to `dest` (an absolute path) for filing in a repository; never `comp/`, `stills/`, `audio/`, `out/`, `history/` or footage; refuses a `dest` that is not empty unless `overwrite` is true | | `dest` |
| `studio_open` | `name`, `show?` (`"player"` or `"finder"`), `save_to?` (a folder) | the absolute path and `file://` link of the project's newest finished MP4, the `-share.mp4` copy too when there is one, and the final sheet as a picture; `show: "player"` opens it in the computer's video player, `show: "finder"` shows the file, `save_to` copies it into a folder (never over an existing file). The chat cannot play a video, so offer these | the newest MP4 in `out/` | a copy in `save_to` |

### Building blocks
| Tool | Inputs | What it does | Reads | Writes |
|---|---|---|---|---|
| `studio_budget` | `name` | narrated: how many words fit, per scene and in total, for `length` | project.json | |
| `studio_say` | `name`, `text`, `voice?` | narrated: speaks one line to check a pronunciation; it returns the absolute path of `audio/say.wav`; give that path to the user | project.json (`lexicon`, `voice`) | `audio/say.wav` |
| `studio_voice` | `name`, `only?` (array of scene ids) | narrated: Kokoro narration per scene, silence trimmed; says abbreviations in their spoken form; warns above 3.5 words/s, about text the voice misreads, about pauses over 0.75 s inside a line, and about words Whisper hears back differently. A job | `scenes[].say`, `voice`, `speed`, `lexicon` | `audio/vo/<id>.wav`, `durations.json`, `audio/voice-report.json` |
| `studio_audio` | `name` | all modes: scene timing, cues, music (generated, the user's song or the starter score), ducking, sound effects, mix at −14 LUFS (a gain and a true-peak limiter, measured and corrected until within 0.3 LU; it warns when the limiter takes more than 6 dB off a peaky score); prints each scene's times | project.json, durations.json (narrated), `audio/voice.wav` (footage) | `timing.json`, `timing.js`, `audio/mix.wav` |
| `studio_cues` | `name` | the cue sheet from project.json in time order: each cue with its scene, the gap to the previous cue and `[sync]`; flags cues less than 3 frames apart | project.json | |
| `studio_score` | `name` | with `src/score.json` (music as data, voice-and-audio.md and the music-for-picture skill): checks it, solves the tempo from its anchors, renders it on real instruments and prints the report (solved tempo, bar 1, every anchor against its target in samples, every hit, notes, raw peak); a refused file lists every problem with its fix. `studio_audio` mixes it. Without that file, film: writes `src/assets/score.wav` from the starter score the tools carry (a soft bed and a short placeholder hit on every cue) and sets `music` to `{"file": "src/assets/score.wav", "start": 0, "gain_db": 0}`, unless the project already plays a song of the user. Both are deterministic (two runs give the same file). A job when it takes over 20 s | project.json (`cues`, `events`, `scenes`), timing (narrated: `durations.json` from `studio_voice`), `src/score.json` | `audio/score-inst.wav`, `audio/score-report.json`; or `src/assets/score.wav` |
| `studio_sounds` | `font?` | the installed SoundFont's General MIDI programs (the numbers for `"program"`) and the drum kits a score can name; `font` picks another installed font | | |
| `studio_words` | `name` | narrated only: estimated word times from the narration (±0.25 s) | project.json, timing.json | `transcript.json` |
| `studio_cut` | `name` | footage: trims, orders, crops to the aspect at `crop_x`, grades and cleans the voice of `edit.clips`; warns per clip when the audio and video streams start more than one frame apart | `edit` in project.json | `src/assets/base.mp4`, `audio/voice.wav`, `cuts.json` |
| `studio_transcribe` | `name`, `file?` | footage: word times of `audio/voice.wav` (Whisper `small.en`; each clip of a cut is transcribed separately so a word never crosses a cut; the first use downloads the model if setup could not) or of the clip named in `file`. A `.srt`, `.vtt` or `.json` file is imported instead (a file from the Mac: `studio_file_add`, then `file: "src/assets/subs.srt"`; one you write: `studio_file_write` at `subs.srt`, then `file: "subs.srt"`) (an `.srt` gives phrases; `captions()` spreads the words inside each phrase). A job | the media or caption file | `transcript.json` |
| `studio_silences` | `name`, `clip`, `db?` (default −32), `min?` (default 0.4) | pauses and speech pieces in a clip (to cut dead air), printed and saved | the clip | `silences-<clip>.json` |
| `studio_scenes` | `name`, `clip`, `threshold?` (default 0.3) | shot changes in a clip (to find usable shots) | the clip | `scenes-<clip>.json` |
| `studio_beats` | `name`, `song` (a path inside the project), `start?` | tempo (70 to 180 BPM) and beat grid of a song; times count from `start` | the song | `beats.json` |
| `studio_look_from` | `name`, `files` (image or video paths on the Mac) or `card` (a built in look) | measures a reference (palette, background, contrast, grain, edge density, and for video frame rate, cuts per minute and motion) and drafts a custom look; `card` instead draws the built in look on the same card so looks can be compared. Returns the look card as an image. A job | the references | `look-reference.json`, `src/look.css` (an earlier one is kept as `src/look.previous.css`), `stills/look-card.jpg` or `stills/look-card-<look>.jpg` |
| `studio_compose` | `name` | checks the page and project.json against the rules, fills `{{placeholders}}`, copies the libraries, fonts and assets, runs the HyperFrames lint; returns every error and warning, or "composed" | `src/`, timing.json, transcript.json | `comp/` |

### Looking, rendering, checking
| Tool | Inputs | What it does | Reads | Writes |
|---|---|---|---|---|
| `studio_stills` | `name`, `times?` (array of seconds), `cues?` (boolean), `range_from?`, `range_to?`, `every?` (seconds), `platform?` | compose, a page error and contrast report, then frames. Default times: 0.3 s, then the middle of each scene and the end of its narration (or of the scene), then the last half second. `cues: true`: every cue 4 frames before, on the cue and 6 frames after (anticipation, hit, reaction), with a legend of which frame is which cue. `range_from: 5, range_to: 12, every: 0.25`: a whole shot, such as a chase. `times`, `cues` and the range combine. Returns the sheet and, for 9:16, the safe area guide as images. A job | `comp/`, timing.json | `stills/sheet.jpg` (all frames in time order), `stills/cues.txt` (the legend), `stills/safe-<platform>.jpg` (9:16), `stills/frame-*.png` |
| `studio_render` | `name`, `draft?` | compose, HyperFrames render at the project fps (retries once), loudness measured and corrected after encoding, the caption record saved. A previous render moves to `history/<time>/` with the sources that made it. Over 25 MB it also writes a `-share.mp4`. A job; follow it with `studio_check` | `comp/` | `out/<name>-<aspect>.mp4` (the aspect written with `x`, for example `9x16`), `out/captions.json`, `out/source-project.json`, `out/source-index.html` |
| `studio_check` | `name` | eleven lines, each PASS or FAIL (plus one `sync <cue>` line per cue marked `"sync": true`, and two lines that are PASS or WARN: `voice heard back` and `sound balance`; a WARN does not fail the video, but fix it or tell the user why it is fine): video stream (h264 at the project size), frame rate (equals `fps`), audio stream (AAC), duration (timeline ±0.15 s), target length (≤ `length` × 1.05; notes if much shorter), loudness (−14 ±1 LUFS), true peak (≤ −1.0 dBTP), no black frames (none ≥ 0.5 s), nothing frozen (no still stretch of 4 s or more), audio against mix (lag within one frame, correlation ≥ 0.9, the last 2 s match, no silence in the MP4 where the mix has sound), captions (only for pages that call `captions()`: every transcript word is in `out/captions.json`, none highlighted more than 150 ms early). Each `sync <cue>` line says that the sharp sound onset nearest the cue (within ±0.15 s) starts within ±1.5 frames of it. Returns the lines and the final sheet as an image. A job. Works on a plain HyperFrames project too | `out/*.mp4` | `out/check.json`, `stills/final-sheet.jpg` |
| `studio_brand_check` | `name`, `brand` (array of hex colours, for example `["#2A67B7"]`), `files?` (pictures inside the project; default the project's `stills/frame-*.png`) | how much of each picture is in the brand's hue (within 20°): ACCENT (at most 15%), HEAVY (15 to 35%) or FLOODED (over 35%, the brand colour is wallpaper: rebuild the palette, brand-colours.md). Prints the share per brand colour, the share of near neutral pixels and the main hues. FLOODED on a scene means redo the palette | the pictures | |
| `studio_inspect` | `name`, `from?`, `to?` (seconds) | a picture of a stretch of the video on one time axis: frames, scenes with their words, the voice level with the words Whisper heard, the music level (with a line 6 dB under the voice), each effect with its level, the finished level, warnings in red; the same as text. Use it to find the cause of a problem before changing anything | `timing.json`, `audio/layers.json` (`studio_audio`), `audio/voice-report.json` (`studio_voice`), the newest MP4 | `stills/inspect.png` |

### Jobs
| Tool | Inputs | What it does |
|---|---|---|
| `studio_job_status` | `job_id`, `wait_sec?` (at most 25) | the state and progress of a job; waits up to `wait_sec`; when done, returns the result with the images |
| `studio_job_log` | `job_id`, `lines?` (default 40) | the last lines of a job's log, for progress or the full error of a failed job |

### Plain HyperFrames projects
| Tool | Inputs | What it does |
|---|---|---|
| `studio_import_hyperframes` | `folder` (full path), `name` | copies a plain HyperFrames folder (its own `index.html` with a HyperFrames root composition, assets and mixed audio) into the projects folder as a project of `kind: "hyperframes"`; compose is skipped for it. Refuses a folder without such an `index.html` |
| `studio_hyperframes` | `name`, `command`, `args?` | runs the installed HyperFrames on that project. Allowed: `render lint check validate snapshot inspect info timeline compositions transcribe tts beats normalize-audio remove-background`. Refused: publishing, cloud, install and preview commands. `args` holds only flags and their values (for example `["-o", "out/video.mp4"]`); the project folder is passed for you and every path must stay inside it. `render` and `transcribe` are jobs. `tts`, `transcribe` and `remove-background` may download a model on first use |

A tool that runs long returns a `job_id` instead of the result; a tool that finishes within about 20 s returns the result
directly. `studio_setup_start`, `studio_voice`, `studio_transcribe`, `studio_look_from`, `studio_stills`,
`studio_render`, `studio_check` and `studio_synctest` are always jobs. Setup, render and transcription take a lock so only
one of them runs at a time; a second one waits and says so.

## 3. project.json
Common fields (all modes; an unknown field is an error at compose):
| Field | Default | Meaning |
|---|---|---|
| `name` | the folder name | the output file name |
| `kind` | `studio` | `hyperframes` marks a plain HyperFrames folder brought in by `studio_import_hyperframes` |
| `mode` | `"narrated"` | `narrated` · `footage` · `film` |
| `aspect` | `"16:9"` | `16:9` · `9:16` · `1:1` · `4:5` (1920×1080, 1080×1920, 1080×1080, 1080×1350) |
| `platform` | `tiktok` for 9:16, else none | `tiktok` `reels` `meta` `shorts` (safe areas) · `youtube` `linkedin` `x` `website` |
| `length` | 30 (9:16) / 60 | target seconds (`studio_budget`, the audio warning, `studio_check`) |
| `fps` | 30 | frames per second: 24, 25, 30 or 60. `studio_check` asserts the file's rate equals it |
| `music` | `"warm"` | `"warm"` · `"calm"` · `"upbeat"` · `"none"` · `{"file": "src/assets/song.mp3", "start": 47.3, "gain_db": -3}` (path relative to the project; `start` = where in the song to begin) |
| `events` | `{}` | `{"s2": {"card": 0.4, "tick": {"t": 1.4, "sfx": "pop"}}}`; `sfx` is `pop`, `click` or `whoosh`. `t` counts from the narration start (narrated) or the scene start (footage, film). Use them in the page with `at("s2", "tick")` |
| `transition_whoosh` | true (false in film) | a soft whoosh at every scene change |
| `cues` | `{}` (film: one example) | the cue sheet: `{"slam": 21.4, "bang": {"t": 30.6, "sync": true, "sfx": "pop"}}`, absolute seconds of the finished video. The page reads `CUE.slam`, the starter score puts its hit at the same time, `studio_stills` with `cues: true` shoots each one and `studio_check` measures the sync of `"sync": true` cues. `sfx` adds a built in pop, click or whoosh. Mark as sync the hits that must land on a frame (a slam, a stamp, a note) |
| `caption_fixes` | `{}` | `{"Hora": "HAURA"}`: fixes words in transcript.json when composing (a key may be several words) |

Narrated only:
| Field | Default | Meaning |
|---|---|---|
| `scenes[]` | | `{"id": "s1", "say": "…"}`; ids look like `s1`, `s2`; optional per scene: `voice`, `speed`, `pre`, `post`, `hold` (extra silent seconds after the line; a silent scene has `say: ""` and a `hold`) |
| `voice`, `speed` | `af_heart`, 0.95 | Kokoro voice id (voice-and-audio.md) and speed (0.85 to 1.1 sounds natural; outside it the voice tool warns) |
| `lexicon` | `{}` | pronunciation spellings: `{"HAURA": "Hora"}` |
| `lead`, `pre`, `post`, `tail` | 9:16: 0.4, 0.3, 0.7, 2.0; otherwise 0.9, 0.6, 1.2, 2.5 | pause before the first line, before each line, after each line, after the last scene; `studio_project_new` writes them, and when a hand written project omits one the tools use the same defaults |

Footage and film:
| Field | Meaning |
|---|---|
| `scenes[]` | `{"id": "s1", "start": 0, "end": 4.2}` in seconds of the finished (edited) video; `start` and `end` are required |
| `edit` (footage) | `{"clips": [{"src": "src/footage/a.mp4", "in": 0.4, "out": 8.7, "crop_x": 0.5}], "grade": "warm\|neutral\|none", "clean_voice": true}`; `in` and `out` are source seconds; `crop_x` (0 left to 1 right, default 0.5) sets the reframing crop |
| `voice_track` (footage) | `false` = don't use the clips' sound (a photo ad or footage to music); film mode sets this for you |

Transcribe once, **after** `studio_cut`, on `audio/voice.wav`: then the word times match the edited video.
Transcribing the raw clips gives raw-clip times, and each run replaces transcript.json.

## 4. The page (src/index.html)
Write it with `studio_file_write`. Placeholders filled by compose: `{{W}}`, `{{H}}`, `{{FPS}}`, `{{TOTAL}}`,
`{{s1.start}}`, `{{s1.dur}}`, `{{s1.end}}`, `{{s1.vo}}`.
From `SS.start(opts)` (lib.js; `opts`: `{cuts: "hard"}` = no automatic scene fades, `{fadeFirst: true}`):
`tl` (the GSAP timeline), `T` (scene times), `EV` (events), `CUE` (the cue sheet; a misspelt name throws), `TOTAL`, `V(scene, offset)` (from the narration start),
`S(scene, offset)` (from the scene start), `at(scene, event)`, `E` (the default ease). Helpers:
`rise`, `fadeIn`, `fadeOut`, `pop`, `press`, `pick`, `count`, `drawIn`, `stagger`, `kenburns`, `punch`, `captions`,
`finish`.
`captions({top, left, right, size, font, weight, color, highlight, box, boxColor, maxWords, maxChars, from, to, style,
boxText})`: word by word captions from the transcript. `style` is `"color"` (the default: the active word turns
`highlight`), `"pop"` (the active word also scales to 1.15) or `"box"` (the active word gets a `highlight` coloured box
and its text turns `boxText`, default `#111`). `box: false` removes the dark pill behind the group. Call it once per
page. Every group is recorded with its words and times, and the render saves the record as `out/captions.json`.
Canvas films: `SK.create(canvas)` from sketch.js (illustration.md, styles.md). 3D: three.js via an import map (three.md).
Rules: hyperframes.md. The page must contain `window.__timelines["main"] = tl;` literally.
To read lib.js or sketch.js, call `studio_example` with `path: "template/lib.js"` or `"template/sketch.js"`.

## 5. Older plain-HyperFrames projects (their own index.html, no project.json)
`studio_import_hyperframes` copies the folder in as a project of `kind: "hyperframes"`. Then `studio_hyperframes` runs
`lint`, `render` (a job), `snapshot` and the other allowed commands on it, and `studio_check` checks the result
(duration against the page's `data-duration`; the audio against mix line only when the project names its mixed audio
file). The LSPedia ad is not a HyperFrames project (its own Playwright renderer and `scripts/build.sh`), so it does
not import.

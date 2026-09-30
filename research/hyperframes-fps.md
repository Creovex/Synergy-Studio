# HyperFrames frame rates

Research date: 2026-09-30. Tool: HyperFrames `0.8.92` (installed under `~/Library/Application Support/SynergyStudioLite`). Machine: macOS 27.0, 12 CPUs, 24 GB RAM, hardware GPU (render log says `drawelement capture · hardware gpu`). All renders used the required environment (`HOME=<home>/node/hf-home`, `HYPERFRAMES_SKIP_SKILLS=1`, `HYPERFRAMES_NO_TELEMETRY=1`, `PATH=<home>/bin:<home>/runtime/node/bin:/usr/bin:/bin`), the bundled node, and no npx.

## Summary

- HyperFrames `0.8.92` renders 24, 25, 30 and 60 fps exactly. Each output has the requested `r_frame_rate` and `avg_frame_rate`, `nb_frames` equals fps times duration, and the video and audio durations are both `3.000000` s.
- The largest gap found is render time, not correctness: 60 fps took about 1.6 times as long as 24 fps on this 640x360 page (median 6.3 s against 3.8 s). Timing is dominated by fixed startup of about 1.5 s plus a per frame cost, and run to run noise is about 1 s.
- Fractional rates exist but only as an exact rational such as `30000/1001` (output duration then differs slightly, 3.003 s for 90 frames). Decimals such as `29.97` are rejected.

## 1. How fps is set, allowed values, fractional rates

From `render --help` (literal):

```
-f, --fps=<fps>   Frame rate. Accepts integer (24, 25, 30, 50, 60, 120, 240) or ffmpeg-style rational (30000/1001 for NTSC 29.97, 24000/1001 for 23.976, 60000/1001 for 59.94). Range 1-240. Defaults to the composition's root data-fps, else 30.
```

From the package code (`dist/render-BQ55H4P5.js`, `dist/chunk-RZC26MUU.js`, `dist/chunk-YEIFI443.js`, `dist/chunk-ZOF426FA.js`):

- Precedence: the `--fps` flag wins; otherwise the `data-fps` attribute of the root composition element (`[data-composition-id][data-root="true"]`, else the first `[data-composition-id]` with no composition ancestor) is used if it parses; otherwise `30`. `resolveDefaultFpsArg` returns the flag if set, then `readCompositionFps(html)` if `parseFps(declared).ok`, else nothing, and the caller does `parseFps(fpsArg ?? "30")`.
- `parseFps` accepts: an integer from 1 to 240; a rational `num/den` with both positive integers and `1 <= num/den <= 240`. It rejects decimals (`ambiguous-decimal`), zero or negative, and values above 240 (`out-of-range`).
- The list "24, 25, 30, 50, 60, 120, 240" in the help text is examples, not a whitelist. Any integer 1 to 240 passes `parseFps`. (Other code paths such as the studio server may have a narrower list; `readAllowedCompositionFpsFromDir` exists in `chunk-YEIFI443.js`. Its allowed set was not traced: UNCONFIRMED.)
- GIF output caps fps at 30 (`gifFpsCapped`); not relevant to mp4.

Verified on the installed tool:

```
$ render . --fps 29.97
Got "29.97". Decimal frame rates are ambiguous — use the exact rational form instead (e.g. 30000/1001 for 29.97).
$ render . --fps 241
Got "241". Frame rate must be in the range 1–240.
```

Rational works: `--fps 30000/1001` gave

```
r_frame_rate=30000/1001
avg_frame_rate=30000/1001
nb_frames=90
duration=3.003000
```

No `--fps` flag with `data-fps="60"` on the page gave 60/1, 180 frames, 640x360 (the page attribute is honoured). Not tested: a flag that disagrees with `data-fps` (code reading says the flag wins; UNCONFIRMED by a render). Note the flag was always passed explicitly in the timing runs below.

## 2. Test page and renders

Page: the `fps60` doctor fixture copied to `tmp/fps-research/base`, changed to `data-duration="3"` (root and scene), the GSAP tween lengthened to 3 s (a box moving 460 px and rotating 90 degrees, `ease: "none"`), and this added inside the root:

```
<audio id="tone" data-start="0" data-duration="3" data-track-index="2" src="tone.wav"></audio>
```

`gsap.min.js` and `doctor-sans.woff2` sit next to the page (local `@font-face`, no Google Fonts fetch). Tone made with:

```
<home>/bin/ffmpeg -f lavfi -i sine=frequency=440:duration=3 -ar 48000 tone.wav
```

(`-ar 48000` added so the source is 48 kHz.) Command per rate (default quality `looks`, default workers):

```
hyperframes render . -o out<FPS>.mp4 --fps <FPS> --quiet
```

### Literal ffprobe output, video stream and container

Command: `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,avg_frame_rate,nb_frames,codec_name,width,height -show_entries format=duration out<FPS>.mp4`

```
=== 24
[STREAM]
codec_name=h264
width=640
height=360
r_frame_rate=24/1
avg_frame_rate=24/1
nb_frames=72
[/STREAM]
[FORMAT]
duration=3.000000
[/FORMAT]
=== 25
[STREAM]
codec_name=h264
width=640
height=360
r_frame_rate=25/1
avg_frame_rate=25/1
nb_frames=75
[/STREAM]
[FORMAT]
duration=3.000000
[/FORMAT]
=== 30
[STREAM]
codec_name=h264
width=640
height=360
r_frame_rate=30/1
avg_frame_rate=30/1
nb_frames=90
[/STREAM]
[FORMAT]
duration=3.000000
[/FORMAT]
=== 60
[STREAM]
codec_name=h264
width=640
height=360
r_frame_rate=60/1
avg_frame_rate=60/1
nb_frames=180
[/STREAM]
[FORMAT]
duration=3.000000
[/FORMAT]
```

### Literal ffprobe output, audio stream

Command: `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels,duration,nb_frames out<FPS>.mp4`. The result was identical for all four rates:

```
[STREAM]
codec_name=aac
sample_rate=48000
channels=2
duration=3.000000
nb_frames=142
[/STREAM]
```

`-count_frames` decoded counts (`nb_read_frames`) were 72, 75, 90 and 180, matching `nb_frames`. Stream start times (`-show_entries stream=codec_type,start_time,duration`) for every file:

```
video,0.000000,3.000000 audio,0.000000,3.000000
```

The audio is not silent and not altered: `volumedetect` on the 30 fps output gave `mean_volume: -21.1 dB`, `max_volume: -17.6 dB`; the source WAV gave `mean_volume: -21.1 dB`, `max_volume: -18.1 dB`. The source is mono and the output is stereo (2 channels); this was not investigated further.

## 3. Frame count and audio versus video

| fps requested | r_frame_rate measured | avg_frame_rate | nb_frames | expected (fps x 3 s) | video duration | audio duration | wall time, 3 runs (s) | median (s) |
|---|---|---|---|---|---|---|---|---|
| 24 | 24/1 | 24/1 | 72 | 72 | 3.000000 | 3.000000 | 5.71, 3.80, 3.79 | 3.80 |
| 25 | 25/1 | 25/1 | 75 | 75 | 3.000000 | 3.000000 | 3.95, 3.81, 3.94 | 3.94 |
| 30 | 30/1 | 30/1 | 90 | 90 | 3.000000 | 3.000000 | 4.00, 4.05, 4.99 | 4.05 |
| 60 | 60/1 | 60/1 | 180 | 180 | 3.000000 | 3.000000 | 6.58, 5.71, 6.32 | 6.32 |

Frame count equals fps times duration for all four rates, and audio duration equals video duration to six decimals, with both streams starting at 0. Wall time is the whole `render` process, measured with `python3 time.time()` around the call (includes node startup and browser launch). The very first render of the session (cold) took 3.95 s at 24 fps, 4.63 s at 25, 7.27 s at 30 and 6.46 s at 60, so cold start was not a large factor. The 5.71 s and 4.99 s outliers are noise.

Render time as reported by the tool for one verbose run each (`capture` stage; setup about 1.5 s and encode overlap capture):

```
fps 24  capture 2.0s   workerCount 1
fps 25  capture 2.1s   workerCount 1
fps 30  capture 2.3s   workerCount 1
fps 60  capture 3.8s   workerCount 1
```

Capture cost scales about linearly with frame count: roughly 28 to 36 ms per frame here, so time grows with fps but is diluted by the fixed setup.

Other observations:

- Auto workers chose 1 worker on every run (`workerCount":1`), so `--workers` mattered little (see section 4).
- Every run logged `[WARN] drawElement blank-frame suspect; re-capturing ... frame 12`, followed by `[INFO] drawElement small frame is deterministic; accepted`. This is harmless on this simple page, and the output is correct.
- The tool ran the drawElement fast capture path (`experimental-fast-capture` default on on macOS with a hardware GPU) and its self verify passed (`psnrDb` about 57).

## 4. Quality and speed flags

Defaults come from `render --help` and `dist/render-BQ55H4P5.js` (`QUALITY_ALIASES`), `dist/chunk-NRAXUJQS.js` (`ENCODER_PRESETS`).

| flag | default | notes |
|---|---|---|
| `-q, --quality` | `looks` | choices `draft`, `looks`, `delivery`, and aliases `standard`, `high` |
| `-w, --workers` | `auto` | each worker is a separate Chrome process, about 256 MB RAM; `--low-memory-mode` (auto on when RAM is 8 GB or less) pins to 1 worker |
| `--player-ready-timeout` | `45000` ms | env `PRODUCER_PLAYER_READY_TIMEOUT_MS`; raise for heavy pages |
| `--browser-timeout` | 60 s | page navigation only |
| `--protocol-timeout` | `300000` ms | CDP timeout |
| `--crf` / `--video-bitrate` | not set | mutually exclusive; override encoder rate control |
| `--experimental-fast-capture` | on where it can engage | macOS plus a hardware GPU browser; falls back to screenshot capture automatically |
| `--browser-gpu` | auto probe | `--no-browser-gpu` forces software |
| `--gpu` | false | GPU encoding |
| `--strict`, `--strict-all` | false | fail on lint errors, or errors and warnings |
| `--resolution` | none | presets such as `1080p`; the aspect ratio must match and the scale must be an integer multiple |

Quality mapping (from the code):

```
draft:    { quality: "draft" }                 -> x264 preset ultrafast, quality 28
standard: { quality: "standard" }              -> x264 preset medium, quality 18
high:     { quality: "high" }                  -> x264 preset slow, quality 15
looks:    { quality: "standard", crf: 16 }     -> preset medium, CRF 16 (the default)
delivery: { quality: "high" }                  -> preset slow, quality 15
```

Draft affects only the encoder; it does not change fps or resolution. The help text says "draft" is a quality name and there is no separate draft mode flag. Measured effect on this small page:

| case (3 s page) | time (s) | size |
|---|---|---|
| 640x360 draft, 24 fps | 3.84 | 142562 bytes |
| 640x360 draft, 25 fps | 4.79 | not recorded |
| 640x360 draft, 30 fps | 4.09 | not recorded |
| 640x360 draft, 60 fps | 7.69 | not recorded |
| 640x360 `looks`, `--workers 1`, 30 fps | 3.58 | not recorded |
| 640x360 `looks`, `--workers 1`, 60 fps | 6.71 | not recorded |
| 640x360 draft, `--workers 1`, 30 fps | 3.48 | not recorded |
| 640x360 draft, `--workers 1`, 60 fps | 4.89 | 167914 bytes |
| 1920x1080 `looks`, 30 fps | 4.35 | not recorded |
| 1920x1080 draft, 30 fps | 3.71 | 285029 bytes |
| 1920x1080 `looks`, 60 fps | 4.66 | 389125 bytes |
| 1920x1080 draft, 60 fps | 4.22 | not recorded |

Single runs, so differences under about 1 s are within noise. Conclusion: on a page this light, draft and worker count change wall time by 0 to 2 s, and fps is the larger factor. Speed gains from draft are UNCONFIRMED for heavy pages; at 1080p 60 fps the single measurement was 4.66 s against 4.22 s. The 1080p times being similar to or lower than 360p times is not explained; it is likely noise from one run each and from the fast capture path.

## 5. Recommended render command

Pass `--fps` explicitly from the project's `fps` (do not rely on `data-fps` alone, so the flag and the `check` assertion cannot drift), and keep the default workers. Use rate values 24, 25, 30 and 60 as plain integers.

Final:

```
"<home>/runtime/node/bin/node" "<home>/node/node_modules/hyperframes/bin/hyperframes.mjs" render "<project dir>" -o "<project dir>/renders/final.mp4" --fps <24|25|30|60> --quiet
```

(quality stays at the default `looks`, CRF 16; use `--quality delivery` only if a slower, larger file is wanted.)

Draft:

```
... render "<project dir>" -o "<project dir>/renders/draft.mp4" --fps <24|25|30|60> --quality draft --quiet
```

Both run with `HOME="<home>/node/hf-home" HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_TELEMETRY=1 PATH="<home>/bin:<home>/runtime/node/bin:/usr/bin:/bin"`. For `--draft` also keep the real fps: rendering a draft at a lower fps would break the `check` frame rate assertion. Add `--workers 1` only on low RAM machines (auto already chooses 1 for light pages). Raise `--player-ready-timeout` (for example `120000`) only for heavy pages. Keep `data-fps` on the root composition equal to the flag value for consistency.

Measured expectation for planning: for a small page, 60 fps costs about 1.6 times the 24 fps time; output frame count is exactly fps times seconds.

## Unconfirmed items

- Behaviour when `--fps` disagrees with `data-fps` (code says the flag wins; no render made).
- Whether other entry points (studio server) restrict fps to a narrower list.
- Draft speed gains on heavy compositions.
- Why the output audio is 2 channels from a mono WAV (probably the encoder stereo mixdown; not checked).
- Whether the `blank-frame suspect` warning appears on pages with more content.

## Sources

- `hyperframes render --help` (v0.8.92), run on the installed tool.
- `~/Library/Application Support/SynergyStudioLite/node/node_modules/hyperframes/package.json` (version `0.8.92`).
- `.../hyperframes/dist/chunk-ZOF426FA.js`: `parseFps`, `parseFpsWithDefault`, `fpsToFfmpegArg`.
- `.../hyperframes/dist/render-BQ55H4P5.js`: `createRenderPlan`, `QUALITY_ALIASES`, `formatFpsParseError`, fps option description.
- `.../hyperframes/dist/chunk-RZC26MUU.js`: `resolveDefaultFpsArg`.
- `.../hyperframes/dist/chunk-YEIFI443.js`: `readCompositionFps`, `readAllowedCompositionFpsFromDir`.
- `.../hyperframes/dist/chunk-NRAXUJQS.js`: `ENCODER_PRESETS`.
- `skills/synergy-studio/scripts/lib/doctor-fixtures/fps60/index.html` and `skills/synergy-studio/scripts/lib/doctor.mjs` (the base page and how the doctor renders it with `--workers 1`).
- Own measurements: ffprobe and ffmpeg (`volumedetect`) from `<home>/bin`, run 2026-09-30.

# Troubleshooting (most of these happened while building the example videos)

| Symptom | Cause | Fix |
|---|---|---|
| Video in the render is frozen, or no sound | an element with `data-start` has no `id` | give every such element a unique `id` |
| `lint: Missing window.__timelines registration` | the registration line is not in the page | keep `window.__timelines["main"] = tl;` in the page's own script |
| Text renders black on a dark look | colours defined on `#root` but text outside it, or a fixed colour | put everything inside `#root`; use `var(--ink)` etc. |
| Stills show old content | stale `comp/` | `studio_stills` and `studio_render` always recompose from `src/`; edit `src/index.html`, never `comp/` (it cannot be written) |
| Scenes appear at wrong times after changing a line | timing not rebuilt | `studio_voice` with `only: ["sN"]`, then `studio_audio`, then render |
| Render fails once with "Chrome cannot start" | the first browser start after install is slow | `studio_render` retries once; call it again if needed |
| Model or font 404 in stills | file not in `src/assets/` | put every file under `src/assets/` and reference `assets/<name>` |
| Lint says "font family used without @font-face declaration" | the check doesn't read looks.css | harmless if the stills show the right font |
| Video longer than planned | pauses between scenes count too | `studio_audio` prints narration vs pauses; cut words or lower pre/post/tail |
| Captions under the TikTok side buttons | old caption margins | `captions()` now clears the platform's side band; override with `left`/`right` |
| Loudness about 1 dB low in the MP4 | AAC encoding | handled: `studio_render` re-normalises the final file |
| `studio_transcribe` fails ("Download failed: HTTP 403", or the Whisper program is missing) | the Whisper model comes from huggingface.co once (setup normally fetches it), and the Whisper program is built by setup, which needs the Xcode command line tools for the compiler | `studio_doctor` shows which part is missing and the fix. Blocked network: the user downloads `ggml-small.en.bin` on any computer, and you call `studio_setup_start` with `whisper_model` set to its full path; or import captions (an existing `.srt` on the Mac: `studio_file_add` with `from_path` (it lands in `src/assets/`, for example `src/assets/subs.srt`), then `studio_transcribe` with `file: "src/assets/subs.srt"`; captions you write yourself: `studio_file_write` of `subs.srt` at the project root, then `file: "subs.srt"`) |
| Captions unreadable on bright footage | white text without backing | `captions()` adds a dark pill by default; keep it |
| Beat grid wrong | run on a mix with voice, or half/double tempo | call `studio_beats` on the song file; check that `bpm` sounds right |
| three.js scene empty in the render | registration ran before an async model load | `await` the load before the `__timelines` line |
| three.js warning "PCFSoftShadowMap has been removed" | the pinned three.js dropped it | use `THREE.PCFShadowMap` |
| Brand name misread by the voice | Kokoro guesses spelling | `lexicon` in project.json |
| Caption shows a misheard name | Whisper guesses | `caption_fixes` in project.json |
| "X is not defined" for a function from your own `.js` file, although the file is there | the file contains the text `</script>` (even in a comment); HyperFrames inlines scripts | remove it from the file (write "script tag" instead) |
| The MP4 is too big to send in chat (over 30 MB) | hatching, grain and particles compress badly | use the `-share.mp4` that `studio_render` writes when the file is over 25 MB |
| Canvas text in the wrong font | the font was never used by an HTML element, so it never loaded | add a hidden element with that font (illustration.md) |
| An SVG character or group vanishes when animated | GSAP replaces the `transform` attribute of an SVG `<g>` (its `translate(x y)` is lost) | position with an outer `<g transform="translate(…)">`, animate an inner `<g id>` |
| `studio_words` says "no timing.json yet" | words needs the scene timing | call `studio_audio` first, then `studio_words`, then set the events and call `studio_audio` again |
| A deterministic "random" is needed (rain, stars) | `Math.random` changes every render | use a fixed hash: the fractional part of `Math.sin(i*127.1 + j*311.7)*43758.5453`, which is what `hash(i, j)` in the sketch kit returns (styles.md) |
| Beat grid a few ms early | onset detection | `studio_beats` is accurate to about 10 ms (a third of a frame) and keeps a beat at 0 s; nudge events by hand only if a hit looks late |
| `studio_check`: true peak above −1 dBTP (sharp pops, claps, clicks in the music) | AAC encoding overshoots transients | fixed in `studio_render`: the final audio comes from the lossless mix with a limiter at 4x oversampling; render again. Never encode the AAC track of an existing MP4 a second time (a second lossy pass raises the peaks) |

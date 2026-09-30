# Troubleshooting (most of these happened while building the example videos)

| Symptom | Cause | Fix |
|---|---|---|
| Video in the render is frozen, or no sound | an element with `data-start` has no `id` | give every such element a unique `id` |
| `lint: Missing window.__timelines registration` | the registration line is not in the page | keep `window.__timelines["main"] = tl;` in the page's own script |
| Text renders black on a dark look | colours defined on `#root` but text outside it, or a fixed colour | put everything inside `#root`; use `var(--ink)` etc. |
| Stills show old content | stale `comp/` | `studio stills` and `studio render` always recompose from `src/`; edit `src/index.html`, never `comp/` |
| Scenes appear at wrong times after changing a line | timing not rebuilt | `studio voice … --only sN`, then `studio audio`, then render |
| Render fails once with "Chrome cannot start" | the first browser start after install is slow | `studio render` retries once; run it again if needed |
| Model or font 404 in stills | file not in `src/assets/` | put every file under `src/assets/` and reference `assets/<name>` |
| Lint says "font family used without @font-face declaration" | the check doesn't read looks.css | harmless if the stills show the right font |
| Video longer than planned | pauses between scenes count too | `studio audio` prints narration vs pauses; cut words or lower pre/post/tail |
| Captions under the TikTok side buttons | old caption margins | `captions()` now clears the platform's side band; override with `left`/`right` |
| Loudness about 1 dB low in the MP4 | AAC encoding | handled: `studio render` re-normalises the final file |
| `studio transcribe` fails with HTTP 403 | the network blocks huggingface.co (first model download) | use another network once, or import captions: `studio transcribe <dir> subs.srt` |
| A script hangs when it calls `page.evaluate(() => tl.seek(t))` | Playwright tries to send the GSAP timeline back | return nothing: `() => { tl.seek(t); }` (only if you write your own Playwright code) |
| Captions unreadable on bright footage | white text without backing | `captions()` adds a dark pill by default; keep it |
| Beat grid wrong | run on a mix with voice, or half/double tempo | run `studio beats` on the song file; check that `bpm` sounds right |
| three.js scene empty in the render | registration ran before an async model load | `await` the load before the `__timelines` line |
| three.js warning "PCFSoftShadowMap has been removed" | r186 change | use `THREE.PCFShadowMap` |
| Brand name misread by the voice | Kokoro guesses spelling | `lexicon` in project.json |
| Caption shows a misheard name | Whisper guesses | `caption_fixes` in project.json |
| "X is not defined" for a function from your own `.js` file, although the file is there | the file contains the text `</script>` (even in a comment); HyperFrames inlines scripts | remove it from the file (write "script tag" instead) |
| The MP4 is too big to send in chat (over 30 MB) | hatching, grain and particles compress badly | use the `-share.mp4` that `studio render` writes when the file is over 25 MB |
| Canvas text in the wrong font | the font was never used by an HTML element, so it never loaded | add a hidden element with that font (illustration.md) |
| An SVG character or group vanishes when animated | GSAP replaces the `transform` attribute of an SVG `<g>` (its `translate(x y)` is lost) | position with an outer `<g transform="translate(…)">`, animate an inner `<g id>` |
| `studio words` says "no timing.json yet" | words needs the scene timing | run `studio audio <dir>` first, then `studio words`, then set the events and run `studio audio` again |
| A deterministic "random" is needed (rain, stars) | `Math.random` changes every render | use a fixed hash, e.g. `x = sin(i*127.1 + j*311.7)*43758.5453; x - floor(x)` |

# HyperFrames composition rules (verified with HyperFrames 0.8.92)

A video is one HTML page. HyperFrames loads it in headless Chrome, seeks the GSAP timeline frame by frame,
screenshots each frame and encodes the MP4 with the audio.

## Page structure (the template in `<skill>/template/index.html` already follows it)
- `<div id="root" data-composition-id="main" data-width data-height data-fps data-duration>`: the frame.
- Each scene: `<div id="s1" class="scene clip" data-start="{{s1.start}}" data-duration="{{s1.dur}}" data-track-index="1">`.
  `studio compose` replaces `{{s1.start}}`, `{{s1.dur}}`, `{{s1.end}}`, `{{s1.vo}}`, `{{TOTAL}}`, `{{W}}`, `{{H}}`, `{{FPS}}`.
- **Every element with `data-start` needs a unique `id`.** Without it a `<video>` renders frozen and `<audio>` silent.
- Track indexes: background video 0, scenes 1–49, overlays 50–89, the mix `<audio id="mix">` 99.
- **Persistent elements** (a progress tracker, a logo bug, a frame) can sit directly inside `#root` outside
  the scene divs with no `data-start`; they stay for the whole video and you animate them with `tl.to`.
  Put them after the scene divs (or give them `z-index`) so they sit on top.
- One `<audio>`: the finished mix from `studio audio`. Footage `<video>` elements are always `muted`.
- Scripts in `<head>`: `gsap.min.js`, `timing.js`, `words.js`, `lib.js` (+ `sketch.js` for the canvas kit,
  illustration.md); styles: `looks.css`. HyperFrames inlines local scripts: never put the text `</script>`
  in a `.js` file, even in a comment.
- Everything is local: `studio compose` copies fonts, GSAP, three.js and `src/assets/*` into `comp/`.

## Timeline
```js
const {tl, V, S, at, rise, pop, press, pick, count, drawIn, stagger, kenburns, punch, captions, finish} = SS.start();
rise("#title", S("s1", 0.3));        // S(scene, offset): from the scene's start
pop("#card", V("s2", 0.4));          // V(scene, offset): from the scene's narration start
press("#btn", at("s3", "click"));    // at(scene, event): an event from project.json (its sfx lands here too)
finish();
window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;   // keep literally
```
- Scenes fade in at their start and out at their end automatically (the last one stays).
  `SS.start({cuts: "hard"})` turns this off (match cuts, continuous camera, canvas films).
- Initial states with `gsap.set` (the helpers do it); animation only with `tl.to(target, vars, absoluteTime)`.
- Drawing that changes every frame (counters, canvas, three.js): one `tl.to(state, {..., onUpdate: draw}, t)`
  whose `draw()` depends only on `state` (see `count()` in lib.js). Never clocks or `requestAnimationFrame`.
- `yoyo`/`repeat` are fine (deterministic). Eases: `power2/3.out` to enter, `power2.in` to exit, `back.out(1.8)` for pops, `none` only for camera moves.
- Async work (loading a `.glb` model, a big image) must finish **before** the `__timelines` line runs:
  put the registration after the `await` in a `<script type="module">`.

## Commands
- `studio compose` also runs `hyperframes lint`; its warnings about nesting or "editable ids" are harmless, and
  so is "font family used without @font-face declaration: manrope/inter" (the fonts are declared in
  looks.css, which the static check does not read); trust the stills.
- `studio stills <dir> [t1 t2 …]` = `hyperframes snapshot` at 0.3 s, the middle and end of every scene and the
  last second (or your times) + `stills/sheet.jpg` (all frames in time order) and, for 9:16,
  `stills/safe-<platform>.jpg`. HyperFrames also writes its own `contact-sheet*.jpg`; use `sheet.jpg`.
- Render: `hyperframes render comp -o … --player-ready-timeout 60000`; `--quality draft` for quick looks.
- The first browser start after install can time out; `studio render` retries once.

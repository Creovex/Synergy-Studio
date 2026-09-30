# Illustration: hand-drawn looks, textures and procedural art

Not every video should look like clean vector motion graphics. When the idea or the reference calls for
drawn, textured, cinematic images, use the **sketch kit** (`template/sketch.js`, read it with `studio_example` `path: "template/sketch.js"`; compose copies it into `comp/` by
`compose`). It draws on one `<canvas>`, frame by frame, from the time `t`.

## Setup
```html
<canvas id="cv" width="{{W}}" height="{{H}}"></canvas>   <!-- inside #root, after the scene divs -->
<script src="sketch.js"></script>                        <!-- in <head>, after lib.js -->
```
```js
const {tl, finish} = SS.start({cuts: "hard"});           // no automatic scene fades: you control every frame
const K = SK.create(document.getElementById("cv"));
const {ink, rr, circ, ell, poly, tube, glow, cam, screen, vgrad, paperBG, darkBG, stars, circles, seg, ease, eOut, lerp, hash} = K;
let ctx = K.ctx;
function render(t) { K.frame(t); /* choose the shot by t and draw it */ }
const st = {t: 0}; tl.to(st, {t: {{TOTAL}}, duration: {{TOTAL}}, ease: "none", onUpdate: () => render(st.t)}, 0); render(0);
finish(); window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
```
Keep the scene divs (empty is fine): they carry the timing and the sound-effect events.

## The kit
| Function | What it gives |
|---|---|
| `ink(path, fill, hatchColour, {lw, oc, ha})` | flat colour + crayon hatching + a wobbly ink outline (`lw: 0` = none) |
| `rr(x, y, w, h, r, seed)`, `circ`, `ell`, `poly(points)` | paths for `ink`/`glow`; `rr` wobbles like a hand-drawn line |
| `tube(points, colour, width, hatch)` | a thick crayon stroke: beams, strands, lightning |
| `glow(path, colour, blur)` | light sources, eyes, stars |
| `cam(zoom, fx, fy, shake)` / `screen()` | the camera (cinema.md §3) / back to screen space |
| `paperBG()`, `darkBG(top, bottom)`, `vgrad(stops)`, `stars(n, seed)` | backgrounds with grain or scratches |
| `circles(cx, cy, k)` | thin concentric guide circles, a sketchbook motif |
| `K.frame(t)` | clears the frame and steps the **line boil** (10 changes a second, like drawn animation) |
| `K.use(ctx2, matrix, boil)` | draw into another canvas (a polaroid, a TV screen, a thumbnail); returns a restore function |
| `hash(i, j)`, `rng(seed)`, `seg(t, a, b)`, `ease`, `eOut`, `eIn`, `eBack`, `lerp` | deterministic noise and timing |

Rendered, working snippets of the kit (a match cut through an eye, drawing on twos, particles, a look card) are in
styles.md. To read the kit itself, call `studio_example` with `path: "template/sketch.js"`.

## Craft
- **Full-bleed hero images.** One big subject fills the frame (a prism, a sunflower, a galaxy). Small props
  in empty space look unfinished.
- **Texture everywhere.** Grain on light backgrounds, scratches on dark ones, hatching on every filled shape.
  Flat vector fills look cheap next to a textured reference.
- **Light.** Use a glow on anything that emits light, a light cone with `globalCompositeOperation = "lighter"`,
  and reflections (draw the character flipped at 25% opacity inside a puddle shape).
- **Procedural art** is the canvas superpower. A few hundred lines of maths give images no stock library has:
  - phyllotaxis: seed i at angle i × 137.5°, radius c√i (sunflowers);
  - flocking: particles on noisy orbits, blended toward target shapes (a murmuration forms a heart);
  - spiral galaxies (two arms, radius → angle);
  - L-system plants, starfields, DNA helices.
  Keep every particle's position a pure function of `t` and its index (`hash(i, k)`).
- **Callbacks.** Render earlier moments into polaroids or screens with `K.use()`: memories feel earned.

## Performance and determinism
- One 1080p canvas with a few thousand strokes renders at about 3 s of video per second of wall time on a laptop CPU.
- Build textures once (the kit does); never create images inside `render`.
- No `Math.random`, no `Date`, no `requestAnimationFrame`. The render seeks `t` in any order.
- Canvas text needs its font loaded. Put a hidden HTML element that uses the same font in the page
  (`<div style="position:absolute;left:-9999px;font-family:Manrope;font-weight:800">Aa</div>`).
- The hatching and line boil make big files (about 55 MB for 51 s at 1080p). `studio_render` then also writes
  a `-share.mp4` under 25 MB for chat.

## Other hand-made looks (HTML/SVG instead of canvas)
SVG filters: `feTurbulence` + `feDisplacementMap` for line boil (change the `seed` attribute every 0.1 s
with `tl.set`), and `<pattern>` fills for hatching. They cost more render time than canvas, so try one
scene first. A CSS `mix-blend-mode: multiply` paper image over everything gives a quick printed look.

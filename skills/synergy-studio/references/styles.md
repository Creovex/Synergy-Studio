# Styles: how to reach any style

The four built in looks are starting points. Any other style is reachable with the same tools, in this order of effort:
a built in look, a custom look written from words, a look measured from a reference, a textured or hand drawn
canvas, generative shapes, a different frame rate, and caption styles. Every snippet below was rendered once with
these tools and looked at before it went in; copy it, then make it your own. Nothing here needs the web.

Two rules hold for every style. First, the picture is a pure function of time: only `gsap.set` and `tl.to` at
absolute times, or one tween whose `onUpdate` draws from the tween state (hyperframes.md). Second, the style comes from
this video's brief (tone.md), not from a habit: if you are about to reuse the last video's look, change three channels.

## 1. Built in looks
`paper` (warm cream), `midnight` (navy and cyan), `bold` (yellow, black, hot pink) and `luxe` (near black, ivory, gold)
are set with `data-look` on `#root`, or with `look` when you call `studio_project_new` (design.md). To choose between
them, call `studio_look_from` with `card: "luxe"` (and again for the others): each call draws the same card (title,
body, a card, chips, an accent shape, the palette) in that look, as an image, so the looks can be judged side by side.
Override single variables for a brand in a `<style>` block on `#root` (`#root{--accent:#1B6FE0}`) and keep `data-look`
on the closest look.

## 2. A custom look from words
Turn the tone words ("dusk, warm, calm, a little grainy") into variables and at most two font families, and write them
as `src/look.css` with `studio_file_write`. Compose loads `src/look.css` after `looks.css` whenever it exists, so the
page needs no link. The rule targets `#root, #root[data-look]` so that it wins whatever `data-look` the page has, and it
should define every variable (design.md lists them). The bundled fonts are Manrope, Inter, Cormorant Garamond and Jost. Any
other font must be an open licence font that the user gives you as a file: add it with `studio_file_add` (it lands in
`src/assets/fonts/`) and declare it with `@font-face`, using a path relative to the page (`assets/fonts/...`, because
compose copies `src/assets/` to `assets/`) and the weight the file really has.
```css
/* A custom look written from words: "dusk, warm, calm, a little grainy" */
@font-face{font-family:"Dusk Display";src:url(assets/fonts/dusk-display.woff2) format("woff2");font-weight:500}
#root, #root[data-look]{
  --bg:#2B1B2E;--bg2:#1B1020;--glow:#4A2C45;--ink:#F7E9DC;--muted:#C9A9A0;--line:#6B4A5C;--card:#3A2540;
  --accent:#FF9F6B;--accent2:#F2C46D;--accent3:#8FB8A8;--accent4:#E56B7D;
  --soft:#4F3050;--soft2:#3F2A4A;--soft3:#3A3A45;--ok:#8FB8A8;--bad:#E56B7D;
  --h-font:"Dusk Display",Manrope,sans-serif;--h-weight:500;--b-font:Inter,sans-serif;--cap-font:var(--h-font);--cap-weight:500
}
#root[data-look]{font-family:var(--b-font)}
#root[data-look] .h1{font-family:var(--h-font);font-weight:var(--h-weight);letter-spacing:.01em}
```
The page then uses the usual classes (`.h1`, `.card`, `.chip`) and `var(--accent)`; `--cap-font` and `--cap-weight` set
the caption type. When the stills show the headline in the new face, the font loaded. Keep text and background at a
contrast the stills report accepts (`studio_stills` prints "low contrast" lines).

## 3. A look from a reference
When the user gives images or a video whose look should be matched: for a video, look at it first with `studio_frames`
(or `studio_reference_study` inside a project). Then call `studio_look_from` with `files` (the full paths of the images
or videos on the Mac). It measures the palette (six colours), the background and whether the look is light or dark, the
text to background contrast, grain, edge density and, for video, frame rate, cuts per minute and motion energy. It
writes `look-reference.json` (every number), `src/look.css` (a look drafted from the numbers, in the format of section 2,
with comments that suggest fonts and motion; an earlier one is kept as `src/look.previous.css`) and
`stills/look-card.jpg`, which it returns as an image. Look at the card next to the reference, then edit `src/look.css`:
choose the fonts and the motion pace yourself. If the reference has grain, the file's comment holds a small overlay to
add once inside `#root`. Only numbers and colours are taken from the reference; the layout, the shapes and any text
are your own design for this brief. To compare with a built in look, call the tool again with `card`.

## 4. Textured and hand drawn styles: the sketch kit
Hatching, line boil, ink outlines, paper and scratch textures, glow and a camera come from `template/sketch.js`
(read it with `studio_example` `path: "template/sketch.js"`; `SK.create(canvas)`, set up as in illustration.md). Everything it draws is a function of the time `t`: `K.frame(t)`
steps the line boil ten times a second, `rng(seed)` gives a seeded sequence (create it inside the render function, so
every frame restarts it and the lashes never flicker), and `hash(i, j)` gives one fixed number per item. Use
`SS.start({cuts: "hard"})` so scenes do not fade, and draw each shot from the time. A match cut is one shape that stays at the
same place and size across the cut: here the iris fills the frame at zoom 8, and the next shot starts as a planet at
zoom 8 and pulls back. Keep the (empty) scene divs: they carry the timing and the sound effects.
```html
<canvas id="cv" width="{{W}}" height="{{H}}" style="position:absolute;left:0;top:0"></canvas>
```
```js
const {tl, finish} = SS.start({cuts: "hard"});              // no automatic scene fades
const K = SK.create(document.getElementById("cv"));
const {ink, ell, circ, glow, tube, cam, paperBG, darkBG, stars, seg, eOut, ease, lerp, hash, rng} = K;
const CX = 960, CY = 540;

function eye(t) {                                            // shot 1: hatched eye, push in until the iris fills the frame
  paperBG();
  cam(lerp(1, 8, ease(seg(t, 0.4, 3.9))), CX, CY, 0);
  const r = rng(5);                                          // seeded inside the render: the same lashes every frame
  for (let i = 0; i < 9; i++) { const a = -Math.PI * (0.15 + 0.7 * i / 8), L = 70 + r() * 40;
    tube([[CX + Math.cos(a) * 250, CY + Math.sin(a) * 140], [CX + Math.cos(a) * (250 + L), CY + Math.sin(a) * (140 + L * 0.7)]], "#2A1D17", 6); }
  ink(ell(CX, CY, 260, 150), "#F4E9D4", "#B9A889");          // white of the eye: flat colour, crayon hatching, ink outline
  ink(circ(CX, CY, 110), "#3E6FB0", "#1E3F70");              // iris
  ink(circ(CX, CY, 48), "#15110F", null, {lw: 0});           // pupil
  glow(circ(CX - 34, CY - 36, 14), "#FFFFFF", 18);           // highlight
}
function planet(t) {                                         // shot 2: the same circle, now a planet, pulling back
  darkBG(); stars(160, 3);
  cam(lerp(8, 1, eOut(seg(t, 4.05, 7.6))), CX, CY, 0);
  glow(circ(CX, CY, 118), "#7FB2FF", 60, 0.7);
  ink(circ(CX, CY, 110), "#3E6FB0", "#1E3F70");
  ink(ell(CX, CY + 20, 190, 30), null, null, {lw: 4, oc: "#F4E9D4"});
}
function render(t) { K.frame(t); if (t < 4) eye(t); else planet(t); }
const st = {t: 0};
tl.to(st, {t: {{TOTAL}}, duration: {{TOTAL}}, ease: "none", onUpdate: () => render(st.t)}, 0); render(0);
finish();
window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
```
This is an 8 s film (`"mode": "film"`, two scenes of 4 s, `"music": "calm"`). Light backgrounds get grain (`paperBG`),
dark ones get scratches (`darkBG`). Give every filled shape a hatch colour, and every emitter a `glow`. Camera moves,
shot sizes and transitions: cinema.md; acting: character.md.

## 5. Drawing on twos inside a 24 fps render
Hand drawn animation is usually drawn on twos: 12 drawings a second, each held for two frames. Set `"fps": 24` in
project.json and compute the time of the current drawing from the frame number, then draw everything from that time,
including the line boil. Use `Math.round`, never `Math.floor` on the time: the renderer can ask for a time a hair before
a frame's exact time, and a floor then flips the drawing one frame early (the holds come out as 1 and 3 frames).
```js
const FPS = 24;                                              // a 24 fps render, a new drawing every second frame (on twos)
function render(t) {
  const f = Math.round(t * FPS), td = (f >> 1) * 2 / FPS;       // the time of the current drawing: held for two frames
  K.frame(td);                                               // the line boil steps on the same drawings
  paperBG();
  const bob = Math.sin(td * Math.PI * 2 * 1.5) * 26;         // a 1.5 Hz bounce, sampled 12 times a second
  const x = 300 + td * 340;                                  // walks across the frame in jumps of 12 poses a second
  const sq = 1 - 0.08 * Math.max(0, -Math.sin(td * Math.PI * 2 * 1.5));   // squash at the bottom of the bounce
  ink(ell(x, 800, 110, 18), "#D8CFC0", null, {lw: 0});       // shadow
  K.ctx.save(); K.ctx.translate(x, 700 - bob); K.ctx.scale(1 / sq, sq); K.ctx.translate(-x, -(700 - bob));
  ink(circ(x, 640, 120), "#D9775A", "#A4482C");              // body
  ink(circ(x - 40, 620, 20), "#FFFFFF", null, {lw: 3});
  ink(circ(x + 40, 620, 20), "#FFFFFF", null, {lw: 3});
  ink(circ(x - 34 + 6 * Math.sin(td * 3), 622, 8), "#15110F", null, {lw: 0});
  ink(circ(x + 46 + 6 * Math.sin(td * 3), 622, 8), "#15110F", null, {lw: 0});
  K.ctx.restore();
}
```
The rest of the page is as in section 4 (one canvas, one tween that calls the render function with the tween's time, and `SS.start({cuts: "hard"})`).
Twos suits characters; a camera move or a background can use the smooth `t` instead of `td`, which reads as a
drawn character on a moving world. Consecutive frames of the render alternate: identical, then different.

## 6. Particles and generative shapes
A canvas whose `draw()` depends only on tween state can hold thousands of particles. Each position is a pure function of
`t` and the particle's index; `hash(i, k)` gives every particle its own fixed random numbers, so nothing is remembered
between frames and any frame can be rendered alone. Draw with plain `fillRect` or `arc` on `K.ctx` (a `glow` per
particle is slow), and ease the swarm from hashed starting places onto its targets.
```js
const {darkBG, seg, ease, eOut, lerp, hash} = K;
const W = K.W, H = K.H, GOLDEN = Math.PI * (3 - Math.sqrt(5));     // 137.5 degrees
const N = 900, SWARM = 700;

// Every position below is a pure function of t and the index i (hash gives each particle its own fixed random numbers).
function render(t) {
  K.frame(t); darkBG("#07101F", "#12264A");
  const c = K.ctx;
  // phyllotaxis: seed i sits at angle i * 137.5 degrees and radius 12 * sqrt(i); seeds appear one after another
  const shown = Math.floor(N * eOut(seg(t, 0.2, 3.2)));
  const spin = t * 0.12;
  for (let i = 0; i < shown; i++) {
    const a = i * GOLDEN + spin, r = 12 * Math.sqrt(i), pulse = 1 + 0.15 * Math.sin(t * 2 - i * 0.02);
    c.fillStyle = `hsl(${170 + i * 0.12}, 80%, ${55 + 20 * hash(i, 4)}%)`;
    c.beginPath(); c.arc(W * 0.3 + Math.cos(a) * r, H / 2 + Math.sin(a) * r, (1.5 + i / 260) * pulse, 0, 7); c.fill();
  }
  // a swarm: each particle starts at a hashed place and eases onto its own point of a ring, then keeps orbiting it
  const gather = ease(seg(t, 2.0, 4.6));
  for (let i = 0; i < SWARM; i++) {
    const sx = hash(i, 1) * W, sy = hash(i, 2) * H;                                  // where it starts
    const ang = (i / SWARM) * Math.PI * 2 + t * 0.4, ring = 210 + 20 * Math.sin(i * 0.7 + t * 1.5);
    const tx = W * 0.72 + Math.cos(ang) * ring, ty = H / 2 + Math.sin(ang) * ring;   // where it belongs
    c.fillStyle = `rgba(53,224,196,${0.35 + 0.6 * hash(i, 3)})`;
    c.fillRect(lerp(sx, tx, gather), lerp(sy, ty, gather), 3, 3);
  }
}
```
This is a 6 s film on the `midnight` look with `"music": "calm"`. The same recipe gives spiral galaxies (radius as a
function of angle), flocks that form a shape (blend each particle toward a target point of the shape), L-system
plants and starfields (illustration.md).

## 7. 60 fps motion pieces
Set `"fps": 60` in project.json for kinetic type and fast graphics. `studio_check` then asserts that the file really is
60 fps, and `studio_doctor` with `full: true` proves the machine can render it. Rendering takes about twice as many
frames, so keep such pieces short. At 60 fps a quarter second is 15 frames: use hard eases (`power4`), stretch or skew
the word while it moves fast, and let it settle to a readable rest. Scenes fade by default; in film mode there is no narration,
so times come from `S(scene, offset)`.
```js
const {tl, S, at, finish} = SS.start();
// at 60 fps a move of 0.25 s has 15 frames: short, hard eases read as speed (power4), and a stretch on the fast part sells it
gsap.set("#word", {x: -1500, skewX: -18, scaleX: 1.5});
tl.to("#word", {x: 0, skewX: 0, scaleX: 1, duration: 0.28, ease: "power4.out"}, S("s1", 0.2));
tl.to("#word", {scale: 1.06, duration: 0.5, ease: "power1.inOut"}, S("s1", 0.55));
tl.to("#bar", {x: 2900, duration: 0.7, ease: "power3.inOut"}, S("s1", 0.9));
tl.to("#word", {x: 1700, skewX: 18, scaleX: 1.5, duration: 0.25, ease: "power4.in"}, S("s1", 2.4));
finish();
window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;
```
This is a 3 s film on the `bold` look (`"fps": 60`, `"music": "upbeat"`), with `#word` (a `.h1` line at 260 px) and
`#bar` (a 900 px bar starting off screen at the left).

## 8. Caption styles
`captions()` takes a `style`: `"color"` (the default: the active word turns `highlight`), `"pop"` (the active word also
scales to 1.15) and `"box"` (the active word sits in a `highlight` coloured box and its text turns `boxText`, default
`#111`). Call it once per page; `from` and `to` limit it to a stretch of the video; `box: false` removes the dark pill
behind the group. By default it sits just above the platform's bottom band and clears the side buttons. Pick the style
from the tone: `pop` for playful, `box` for loud and clear, `color` for calm. The highlight must contrast with
the background: a hot pink on the yellow `bold` look measured 2.0 : 1 in the stills report, and a dark red passed.
```js
// pop: dark text on a light look, the active word grows and turns a dark red
captions({style: "pop", size: 84, color: "#111", highlight: "#B5233F", box: false});
// box: white text in the dark pill, the active word in a yellow box with dark text
captions({style: "box", size: 84, color: "#fff", highlight: "#FFE14D", boxText: "#111"});
```
Both ran on a narrated 9:16 project (`studio_words` first, so the transcript exists) and `studio_check` reported the
captions line PASS. For footage, `studio_transcribe` gives the word times instead.

## When the style cannot be reached
Say so plainly and offer the nearest thing. The kit draws 2D on a canvas, and three.js does light 3D (three.md); neither
makes photographs, live action or a painterly render. An AI image or video generator can supply such ingredients only
when it is connected and the user agrees (generators.md). Fonts and images the user does not supply cannot be fetched.

# Cinema: reference study, shots and camera

Use this for stories, films, music pieces and anything the user compares to a reference video. Ads and
explainers can borrow from it too. Everything here is a tool, not a rule.

## 1. Study the reference before you design (when the user gives one)
`studio_reference_study` needs a project, so make one first with `studio_project_new`; then `studio_reference_study` (project `name`, `video_path`) writes `reference/sheet.jpg` (one frame every 2 s) and
`reference/cuts.json` (shot changes, average shot length). Look at the sheet, and for a closer look call `studio_frames`
with a small `n` (4 to 6: fewer, larger tiles; a tile is 480 px wide). No tool returns a full-size frame of a video, so
when a detail matters (a logo, a face, a texture) ask the user for a still of it. Then write a **style card** in brief.md:

| Line | What to write (be literal) | Example (the owner's mascot reference) |
|---|---|---|
| Medium | how it is made | 2D, hand-drawn look, crayon hatching over flat colour |
| Line | outline weight and quality | thick dark ink, slight wobble, rounded joins |
| Texture | paper, grain, hatching, scratches | paper grain with specks; navy skies with diagonal scratches |
| Palette | 4–6 colours with roles | cream paper, orange mascot, deep navy, rainbow accents |
| Light | flat, glow, rim light | soft glows on light sources and stars |
| Composition | subject size and placement | one hero subject, large, centred, full-bleed |
| Shot sizes | wide / medium / close / extreme close | wide walk → extreme close-up of the face → into the eye |
| Camera | still, push-in, pan, shake, parallax | slow push-ins; a zoom through the eye into the cosmos |
| Transitions | how shots connect | match cut through an object (eye → universe), hard cuts on the beat |
| Pacing | average shot length from cuts.json | about 2 s per image, faster in the montage |
| Sound | music, effects, voice | no voice; music carries the emotion |

**Before animating, build one still that matches the reference** and put the two side by side. If a
stranger couldn't tell they belong to the same film, fix the style first. In review, compare 3 moments
side by side and name the differences (review.md ◇ 24).

"Use this as a reference" can mean the style, the structure or both. When it is unclear and matters, ask one
question; otherwise take the style and say so.

## 2. Shot sizes: vary them, it is how films breathe
| Shot | Frame | Use for |
|---|---|---|
| Extreme wide | the character is tiny in a big world | loneliness, the start of a journey, scale |
| Wide | the whole body and the place | action, where we are |
| Medium | the upper body fills half the frame | conversation, reactions |
| Close-up | the face fills the frame | emotion: fear, joy, surprise |
| Extreme close-up | one eye, one detail | a turning point, a portal to the next scene |
Use at least three sizes in anything over 20 s. Don't keep the characters small on one ground line for the
whole film: that looks like a stage play.

## 3. Camera moves (with the sketch kit, `cam(zoom, focusX, focusY, shake)`; or a scaled "world" group in HTML)
- **Push-in**: zoom 1.0 → 1.15 over a shot, which builds attention. A **fast push-in** to a close-up gives a reaction beat.
- **Pull-back**: zoom 1.5 → 1.0 reveals the place, for loneliness, scale or a surprise in the wide shot.
- **Through an object**: zoom 1 → 60–80× into an eye, a window or a photo. Draw the next scene clipped inside
  that shape, and cut to it once the shape fills the frame. The camera focus must be the exact centre of the shape.
- **Shake**: 10–30 px of random offset per boil step, for 0.3–0.5 s, on impacts (thunder, a fall).
- **Parallax**: move far layers slower (0.3×) than near layers (1×). It turns a flat side view into a world.
- **Speed lines, smear**: a few hatched lines behind a fast move.

## 4. Transitions that mean something
- **Match cut**: the same shape in both shots (an eye → a planet, a stone stack → a skyline).
- **Iris**: the next image opens in a growing circle. Good for a montage on the beat.
- **Flash to white**: at a magical moment (a meeting, an idea).
- **Hard cut on the beat**: the default in a music-driven montage.
A transition is cheap when it has no reason. A whip pan inside a calm luxury ad reads as rushed (HAURA
feedback). A zoom through an eye into a memory is the idea itself.

## 5. Pace to the music
Take the score's tempo or `studio_beats`. Cut and hit on beats (one beat = 60 / BPM s). Let the quiet acts
breathe: 4–6 s shots with slow moves. Speed up in the montage: 1.5–3 s shots.

## 6. Wordless storytelling
A wordless short still needs a clear arc. For example: **setup** (who, where, what they want) → **try and
fail** → **low point** (alone, scared) → **turn** (someone or something arrives) → **flourish** (they
make something together) → **echo** (a callback to the opening image, changed). Each act needs one
readable image and one clear emotion on the character's face (character.md).

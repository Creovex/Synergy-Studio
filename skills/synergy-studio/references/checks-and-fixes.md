# Checks and fixes

`studio check <dir>` measures the rendered MP4 and writes `out/check.json` and `stills/final-sheet.jpg`.

| Check | Pass | If it fails |
|---|---|---|
| video stream | h264 at the project size | the page's `data-width/height` differ from the aspect: keep `{{W}}`/`{{H}}` |
| audio stream | AAC present | the `<audio id="mix">` lost its `id` or `data-start`; run `studio audio` |
| duration | the timeline ± 0.15 s (usually slightly longer: encoder padding on the last frame and audio block) | `data-duration` on #root must be `{{TOTAL}}`; re-run `studio audio` after voice changes |
| target length | ≤ `length` × 1.05 (only when project.json sets `length`) | script too long for the brief: cut words (`studio budget`) or shorten pauses |
| loudness | −14 ± 1 LUFS | render again (render re-normalises); a song file very quiet or loud: adjust `gain_db` |
| true peak | ≤ −1.0 dBTP | same as loudness |
| no black frames | none ≥ 0.5 s | a scene starts before its content appears, or a gap between scenes: check start times |
| nothing frozen ≥ 4 s | none | add motion there: `kenburns` on the background, a counter, a staggered list |

## What the machine cannot check: look at the sheets
Before rendering (`stills/sheet.jpg`) and after (`stills/final-sheet.jpg`), check each frame:
- **Readable:** text large enough (design.md sizes), strong contrast (dark text on light, light on dark;
  add a soft dark backing behind text on photos), nothing cut off at the edges.
- **Safe:** in 9:16 no key text in the bottom 22% or right 12% (except captions at 65–75%).
- **Meaning:** each frame shows what is being said at that moment; the message is clear without sound.
- **Clean:** nothing overlaps by accident; titles, captions and logos keep their place across scenes.
- **Brand:** the user's real logo and colours; spelling of names.
Fix in `src/index.html`, then `studio stills` again. Common fixes: move or shrink an element, raise a
font size, delay an overlay so it does not collide, add a backing behind captions.

## Then the review gate
Run every condition in `review.md` (TRUE / FALSE / N/A with evidence) before calling the video done.

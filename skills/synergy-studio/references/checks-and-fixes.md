# Checks and fixes

`studio_check` measures the rendered MP4 and writes `out/check.json` and `stills/final-sheet.jpg`; it returns the lines and the final sheet.
A FAIL line stops delivery. A WARN line does not fail the video, but fix it or tell the user why it is fine before delivering.

| Check | Pass | If it fails |
|---|---|---|
| video stream | h264 at the project size | the page's `data-width/height` differ from the aspect: keep `{{W}}`/`{{H}}` |
| frame rate | the file's frame rate equals `fps` in project.json | the page's `data-fps` must be `{{FPS}}`; render again |
| audio stream | AAC present | the `<audio id="mix">` lost its `id` or `data-start`; call `studio_audio` |
| duration | the timeline ± 0.15 s (usually slightly longer: encoder padding on the last frame and audio block) | `data-duration` on #root must be `{{TOTAL}}`; call `studio_audio` again after voice changes |
| target length | ≤ `length` × 1.05 (only when project.json sets `length`) | script too long for the brief: cut words (`studio_budget`) or shorten pauses |
| loudness | −14 ± 1 LUFS | render measures and corrects itself, so a FAIL is rare: a near-silent file, or a score so peaky that `studio_audio` warned. Use a less peaky track or softer hits; a song file very quiet or loud: adjust `gain_db` |
| true peak | ≤ −1.0 dBTP | same as loudness |
| no black frames | none ≥ 0.5 s | a scene starts before its content appears, or a gap between scenes: check start times |
| nothing frozen ≥ 4 s | none | add motion there: `kenburns` on the background, a counter, a staggered list |
| sync `<cue>` | the sound of each `"sync": true` cue starts within ±1.5 frames | the sound sits at a retyped time instead of the cue's time, or it has a slow attack (a whistle into a thud: cue the thud); the check takes the sharp onset nearest the cue, so a drum or a lead-in whoosh close by rarely fools it; in a busy mix a PASS means some sharp hit starts on the cue, so also look at `studio_stills` with `cues: true` |
| audio against mix | the sound in the MP4 lines up with `audio/mix.wav`: lag within one frame, correlation ≥ 0.9, the last 2 s match, no silent stretch of 0.5 s or more where the mix has sound | an `<audio>` without an `id`, or a renderer that shifted or trimmed the sound; render again, and if it repeats call `studio_synctest` |
| voice heard back (WARN, not FAIL) | every narrated line was heard back by Whisper as written, with no pause over 0.75 s inside a line and no text the voice misreads (`audio/voice-report.json`, made by `studio_voice`) | listen with `studio_say`; reword, add a `lexicon` entry or split the line; `studio_voice` with `only` for that scene, then `studio_audio` and render. Whisper can mishear a brand name: if the line sounds right, say so to the user |
| sound balance (WARN, not FAIL) | the music is 6 dB or more under the voice while it speaks, and no effect is more than 3 dB above the voice's usual level (`audio/mix-report.json`, made by `studio_audio`) | a quieter song (`gain_db`), a calmer mood or `"music": "none"`; move an effect off the words or drop it; `studio_audio` again |
| captions | only for pages that call `captions()`: every transcript word is in `out/captions.json` and none is highlighted more than 150 ms early | render again so the record is saved; if words are missing, `studio_transcribe` again and check `from` and `to` in `captions()` |

## What the machine cannot check: look at the sheets
Before rendering (`stills/sheet.jpg`) and after (`stills/final-sheet.jpg`), check each frame:
- **Readable:** text large enough (design.md sizes), strong contrast (dark text on light, light on dark;
  add a soft dark backing behind text on photos), nothing cut off at the edges.
- **Safe:** in 9:16 no key text in the red areas of `stills/safe-<platform>.jpg` (design.md lists them per platform; captions may sit inside the lower band).
- **Meaning:** each frame shows what is being said at that moment; the message is clear without sound.
- **Clean:** nothing overlaps by accident; titles, captions and logos keep their place across scenes.
- **Brand:** the user's real logo and colours; spelling of names.
Fix in `src/index.html`, then call `studio_stills` again. Common fixes: move or shrink an element, raise a
font size, delay an overlay so it does not collide, add a backing behind captions.

## Then the review gate
Run every condition in `review.md` (TRUE / FALSE / N/A with evidence) before calling the video done.

# Footage edits, captions, photo ads and beats

**The principle:** with real footage your value is *compression and structure*, not generation. Find the
strongest moments, cut everything else, put them in the order that tells the story, then add only the
overlays that help understanding. Structure before style: get the order and the cuts right before any
animation.

## Finding the cuts (do this before writing edit.clips)
1. **Read the words:** `studio_transcribe` with `file: "src/footage/c1.mp4"` on a raw clip to *choose* cuts (each run
   replaces transcript.json and its times are raw-clip times). Label each sentence: keep / cut / maybe, and the
   story role (hook, point, proof, CTA). After `studio_cut`, call `studio_transcribe` once more (no `file`):
   that transcript has the edited video's times and is the one captions use.
2. **Dead air and fillers:** `studio_silences` with `clip: "src/footage/c1.mp4"` lists every pause ≥ 0.4 s and the
   speech pieces between them (already padded 0.12 s). Keep the pieces you need; drop repeated takes,
   "um"s and false starts (the transcript shows them).
3. **Shot changes:** `studio_scenes` with `clip: "src/footage/long.mp4"` finds cuts inside screen recordings or
   multi-shot footage.
4. **Highlights from long recordings:** read the transcript with its times and pick the strongest
   moments by these tests: it makes sense on its own, it has a clear point or a strong emotion, and it
   fits the message in brief.md. For a short, one idea only.
5. Write the chosen pieces into `edit.clips` in story order, then `studio_cut`.
6. Watch the joins in the stills: a jump in the middle of a sentence or a visible jump cut on a face gets
   a `punch()` zoom or a B-roll overlay to hide it.

## Talking-head / selfie reel (like the Haura founder intro)
1. Put the clips in `src/footage/` with `studio_file_add`. Look at them first: `studio_frames` (with the path of the
   user's clip, `n` from 6 to 12) returns a contact sheet in time order, and the speech (step 3) decides the story order.
2. `project.json`:
```json
{ "name": "haura-intro", "mode": "footage", "aspect": "9:16", "fps": 30, "music": "upbeat",
  "edit": { "grade": "warm", "clean_voice": true, "clips": [
      { "src": "src/footage/c4.mp4", "in": 0.4, "out": 8.7 },
      { "src": "src/footage/c3.mp4", "in": 0.2, "out": 11.9 } ] },
  "caption_fixes": { "Harrison": "Haura Scent", "sense": "scent" },
  "scenes": [ { "id": "s1", "start": 0, "end": 8.3 }, { "id": "s2", "start": 8.3, "end": 20.0 } ],
  "events": { "s1": { "badge": { "t": 1.2, "sfx": "pop" } } } }
```
   - `in`/`out` trim each clip (cut lead-in silence, "um"s and long pauses: split a clip into two entries).
   - Order in the list = story order. `grade`: `warm` (5400 K, +20% saturation, gentle contrast), `neutral`, `none`.
   - `clean_voice`: high-pass, denoise, presence EQ, compression.
3. `studio_cut` → `src/assets/base.mp4` (reframed to the aspect, no audio), `audio/voice.wav`,
   and `cuts.json` (where each clip starts in the edit).
4. `studio_transcribe` → `transcript.json` word timings (Whisper small.en, offline after the first
   model download from huggingface.co, which setup normally does; `studio_doctor` shows whether captions are ready and
   the fix if not; or import captions: an existing `.srt` on the Mac: `studio_file_add` with `from_path` (it lands in `src/assets/`, for example `src/assets/subs.srt`), then `studio_transcribe` with `file: "src/assets/subs.srt"`; captions you write yourself: `studio_file_write` of `subs.srt` at the project root, then `file: "subs.srt"`). Each clip of the cut is
   transcribed separately, so a word never runs across a cut.
   Read it, fix misheard names in `caption_fixes`, and set `scenes` from the sentences.
5. `studio_audio` (voice + ducked music + effects), then write `src/index.html` with `studio_file_write`:
```html
<video id="base" src="assets/base.mp4" muted playsinline data-start="0" data-duration="{{TOTAL}}" data-track-index="0"
       style="position:absolute;left:0;top:0;width:{{W}}px;height:{{H}}px;object-fit:cover"></video>
```
   and in the script: `captions({top: "70%", size: 76, highlight: "#FFE14D"})` (three styles: `style: "color"` is the default, `"pop"` scales the active word, `"box"` puts it in a box with `boxText` for its text colour; styles.md shows each), `punch("#base", cutTime)` on
   each cut (anchor zooms at chin height with `transform-origin` so captions never cover the face),
   name tags, badges, product photos popping on the words that name them (find the time in transcript.json).
6. `studio_stills` → `studio_render` → `studio_check`. Lip sync holds because the video and voice come from the same cut.

## Captions for narrated videos
`studio_words` estimates word timings from the `say` text (±0.25 s), then call `captions()` in the page.
Re-running it overwrites transcript.json, so fix wording with `"caption_fixes"` in project.json (it applies
to estimated and transcribed words alike), not by editing transcript.json. Limit captions to part of the video
with `captions({from: 4.7, to: 13})`.

## Photo / slideshow ad cut to music (like the Haura sale ad)
- Photos in `src/assets/` (`studio_file_add`), full-bleed: `<img id="p1" src="assets/p1.jpg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`.
- Each photo gets a slow `kenburns("#p1", t0, t1, {to: 1.08})` and a dissolve (next photo `fadeIn` over 0.6 s).
- Cut on the beat: `studio_beats` with `song: "src/assets/song.mp3"` and `start: 47.3` → `beats.json`; in project.json use
  `"music": {"file": "src/assets/song.mp3", "start": 47.3}`; put photo changes on `downbeats` (every bar)
  and the offer on the strongest moment. Scenes can be time ranges (`"mode": "footage"` without `edit`,
  and a silent `audio/voice.wav` is not needed: set `"voice_track": false`).
- Text always in the same place (a soft dark pool behind it), never over product labels.
- No tool cleans a photo (removing burned-in text or seams). Crop or reframe in the page when you can, or ask the user for a clean file.

# Examples (all rendered and checked with this skill on 2026-09-30)

| Folder | Kind | What it shows |
|---|---|---|
| `hydration-tips/` | narrated motion graphics, 9:16, `midnight` look, 28 s | scenes from `project.json`, events with sound effects, counters, the helper library |
| `footage-captions/` | footage edit, 9:16, `bold` look, about 12 s | `edit` clips → `studio_cut`, word captions from `studio_transcribe`, overlays, zoom punch on the cut, `caption_fixes` (Whisper hears "OneScan" as "one scan"); `captions.srt` shows the import route |
| `three-product/` | three.js product shot, 16:9, `paper` look, 7 s | import map, deterministic `draw()`, soft shadows, a camera orbit, an HTML label |

Read an example with `studio_example` (for example `path: "examples/three-product/src/index.html"`), or as the resources `synergy://examples/<name>/project.json` and
`synergy://examples/<name>/index.html` (the page). To run one: make a project with `studio_project_new` (same `mode`
and `aspect` as the example), write the example's `project.json` and `src/index.html` into it with `studio_file_write`,
then `studio_voice` (narrated only), `studio_audio`, `studio_render`, `studio_check`.
`footage-captions` needs a 16:9 explainer clip of at least 25 s with a narrator, added with `studio_file_add` as
`src/footage/clip.mp4`. Its clip ranges and `caption_fixes` were written for the OneScan explainer (the test harness copies
it there); for another clip, change the ranges. Then call `studio_cut`, `studio_transcribe` (no file: it transcribes the
cut's narration), `studio_audio`, `studio_render`, `studio_check`.
`captions.srt` is an import example, timed to a different clip: `studio_transcribe` with `file: "captions.srt"` uses it
instead of Whisper (an existing `.srt` on the Mac: `studio_file_add` with `from_path` (it lands in `src/assets/`, for example `src/assets/subs.srt`), then `studio_transcribe` with `file: "src/assets/subs.srt"`; captions you write yourself: `studio_file_write` of `subs.srt` at the project root, then `file: "subs.srt"`).

Older full projects to learn from (other branches of the storage repository): `media/haura-intro-reel` (founder
talking-head reel with word captions), `media/haura-sale-ad` (photos cut to a song), AllSpace reels
`media/allspacehq-listing-translator-reel` and `media/allspacehq-lagos-flood-watch-reel` (narrated
Instagram reels), `media/lspedia-onescan-ad` and `media/synergy-studio-explainer`.

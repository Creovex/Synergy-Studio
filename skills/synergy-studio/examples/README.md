# Examples (all rendered and checked with this skill on 2026-09-30)

| Folder | Kind | What it shows |
|---|---|---|
| `hydration-tips/` | narrated motion graphics, 9:16, `midnight` look, 28 s | scenes from `project.json`, events with sound effects, counters, the helper library |
| `footage-captions/` | footage edit, 9:16, `bold` look, about 12 s | `edit` clips → `studio cut`, word captions from `studio transcribe`, overlays, zoom punch on the cut, `caption_fixes` (Whisper hears "OneScan" as "one scan"); `captions.srt` shows the import route |
| `three-product/` | three.js product shot, 16:9, `paper` look, 7 s | import map, deterministic `draw()`, soft shadows, a camera orbit, an HTML label |

To run one: copy the folder, then `studio voice` (narrated only), `studio audio`, `studio render`, `studio check`.
`footage-captions` needs a 16:9 explainer clip of at least 25 s with a narrator, saved as `src/footage/clip.mp4`. Its clip ranges and
`caption_fixes` were written for the OneScan explainer (the test harness copies it there); for another clip, change the ranges. Then run
`studio cut <dir>`, `studio transcribe <dir>` (no file: it transcribes the cut's narration), `studio audio`, `studio render`, `studio check`.
`captions.srt` is an import example, timed to a different clip: `studio transcribe <dir> captions.srt` uses it instead of Whisper.

Older full projects to learn from (other branches of this repository): `media/haura-intro-reel` (founder
talking-head reel with word captions), `media/haura-sale-ad` (photos cut to a song), AllSpace reels
`media/allspacehq-listing-translator-reel` and `media/allspacehq-lagos-flood-watch-reel` (narrated
Instagram reels), `media/lspedia-onescan-ad` and `media/synergy-studio-explainer` (on this branch).

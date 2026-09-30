# Working through the Synergy Studio tools

Claude Code and Claude Desktop both reach Synergy Studio through one MCP server on the user's Mac. There is no
terminal in Claude Desktop, so every step of this skill is a tool call. The full list with inputs and outputs is in
commands.md; this page says when to use which tool and how the tools behave.
Messages printed by a tool sometimes name a step the way the older command line did, for example "studio audio". Read
that as the tool `studio_audio`: every command has a tool of the same name with an underscore, except `setup`
(`studio_setup_start`), `doctor` (`studio_doctor`), `new` (`studio_project_new`), `import` (`studio_project_import`),
`reference` (`studio_reference_study`) and `look` (`studio_look_from`).

## Which tool when
| You want to | Tool |
|---|---|
| start the conversation | `studio_guide` (this guide), then `studio_doctor` |
| read one reference (craft, design, footage, styles ...) before a step that needs it | `studio_reference` with `name` |
| read an example page or `template/sketch.js` | `studio_example` with `path` |
| install everything (only when the doctor says "not set up") | `studio_setup_start`, then `studio_job_status` |
| make, list or find a project | `studio_project_new`, `studio_project_list` |
| work from a finished MP4 made anywhere | `studio_project_import` |
| look at any video without making a project | `studio_frames` |
| study a reference video for style and cut rhythm | `studio_reference_study` |
| measure a look from reference images or videos, or compare a built in look | `studio_look_from` |
| see what a project holds, read a file or a picture, write a file | `studio_file_list`, `studio_file_read`, `studio_file_write` |
| bring the user's own logo, photo, clip, song or font in | `studio_file_add` |
| plan the words, make the voice, build the timing and mix | `studio_budget`, `studio_say`, `studio_voice`, `studio_audio`, `studio_words` |
| cut, transcribe and analyse footage | `studio_cut`, `studio_transcribe`, `studio_silences`, `studio_scenes`, `studio_beats` |
| see every lint error, or look at the video before rendering | `studio_compose`, `studio_stills` |
| render and verify | `studio_render`, `studio_check` |
| find the MP4 (and its `-share.mp4` when the file was large) again, or file a project's sources in a repository | `studio_open`, `studio_export` |
| follow or debug long work | `studio_job_status`, `studio_job_log` |
| prove picture and sound line up on this computer | `studio_synctest` |
| an older plain HyperFrames folder | `studio_import_hyperframes`, `studio_hyperframes`, `studio_check` |

## Jobs and waiting
Every tool answers within about 20 seconds. Work that takes longer runs as a job: the answer holds a `job_id` and
the state `queued`. Setup, voice, transcription, look measuring, stills, render, check and synctest are always jobs.
Any other tool that runs past the limit becomes one too, and says so.
- Call `studio_job_status` with the `job_id` and `wait_sec` 25. It waits up to that long and returns the state
  (`queued`, `running`, `done`, `failed`) with the progress text. Call it again until the state is `done` or
  `failed`. When it is `done` it returns the result, with contact sheets, stills and look cards as images.
- `studio_job_log` shows the last lines of the log (`lines` sets how many): progress while it runs, the full error
  when it failed. A failed compose inside stills or render returns the lint errors as the job result.
- Setup, render and transcription take a lock, so only one of them runs at a time. A second one waits and says so;
  it is not stuck.
- A job keeps running if the conversation is quiet, and its status survives a restart of the server. While you wait
  you can keep planning, but do not start a second render of the same project.
- Rough sizes on a laptop: a few seconds of stills, seconds for a short film render, about a minute for 30 s of
  1080p, longer with three.js or canvas hatching. Setup takes 5 to 10 minutes once.
- Say what you are waiting for in one line ("rendering, about a minute"), not each poll.

## Pictures come back as images
Contact sheets, stills, safe area guides, look cards, source sheets and the final sheet are returned as images (JPEG,
at most 1600 px wide and 1 MB) inside the result of the tool or job that made them. Look at each one and judge it
(review.md). To look again later, or at one frame at full size, call `studio_file_read` with the path, for example
`stills/sheet.jpg` or `stills/frame-02-at-4s.png`. Videos are never returned: give the user the path from
`studio_open`.

## File path rules
- A project is one folder in the server's projects folder (on a Mac `~/Movies/Synergy Studio`). You name it
  (`name`: lower case letters, digits and hyphens, at most 40 characters) and never handle its path.
- Inside a project every path is relative (`src/index.html`) and must stay inside the folder; `..` and symbolic
  links that lead out are refused.
- You may read anything inside a project (text up to 200 KB, or a jpg or png as an image). You may write only
  `project.json`, `brief.md`, `shots.md`, `feedback.md`, anything under `src/`, and `.srt` or `.vtt` files. The
  folders `comp/`, `audio/`, `out/`, `stills/` and `history/` are made by the tools. One write is at most 5 MB:
  split a long page's scripts into `.js` files under `src/assets/` and load them with `<script src="assets/x.js">`.
- The user's own files (logo, photo, clip, song, font, a video to import or study) can be anywhere on the Mac. The
  user names the full path, and you pass it as `from_path` (`studio_file_add`), `video_path` (`studio_project_import`,
  `studio_frames`, `studio_reference_study`) or `files` (`studio_look_from`). Everything is copied or read; the
  original is never changed.
- Paths named in project.json and in the page are relative to the project (`src/assets/song.mp3` in `music.file`,
  `assets/logo.png` in the page, because compose copies `src/assets/` to `assets/`).

## Limits in Claude Desktop
- **No web access.** You cannot download a font, an image or a model, and the page may not use web URLs. Fonts beyond
  the bundled Manrope, Inter, Cormorant Garamond and Jost come only from font files the user gives, which you add
  with `studio_file_add` (they land in `src/assets/fonts/`). Use open licence fonts only, at most two families.
- **A video attached in the chat has no file path.** Ask the user to type the path of the file on the Mac (for
  example `/Users/name/Movies/clip.mp4`), or to move it into a folder they can name, and use that path.
- **Models can download on first use.** Through `studio_hyperframes`, the commands `tts`, `transcribe` and
  `remove-background` may download a model the first time. Transcription for captions normally has its model from
  setup; if the download is blocked, `studio_transcribe` says what is missing, and you can import a `.srt` instead (an existing `.srt` on the Mac: `studio_file_add` with `from_path` (it lands in `src/assets/`, for example `src/assets/subs.srt`), then `studio_transcribe` with `file: "src/assets/subs.srt"`; captions you write yourself: `studio_file_write` of `subs.srt` at the project root, then `file: "subs.srt"`).
- **No terminal.** Everything you would have run by hand is a tool. If an instruction cannot be done with a tool
  (for example writing a custom music score), say so and offer the nearest thing: a generated bed or the user's track.

## Examples and templates
`studio_example` reads a file of the skill's examples or templates: `path` is relative to the skill folder and only under
`examples/` and `template/`, for example `examples/three-product/src/index.html`, `examples/hydration-tips/project.json`,
`template/sketch.js` or `template/lib.js`. Clients that read MCP resources can also open `synergy://examples/<name>/project.json`
and `synergy://examples/<name>/index.html`. The starter page of every project is the template: `studio_project_new` writes it to `src/index.html`, and after
`studio_example` with `path: "template/lib.js"` or `"template/sketch.js"` gives the helper libraries.

## When nobody can answer
In a scheduled or non interactive run there is no one to ask. Take the stated defaults (intake.md lists them), mark
every assumption `PROPOSED:` in brief.md, build the video, and say in the delivery message which items were assumed and
that the user can change them.

## Reading and rewriting files
`studio_file_write` replaces the whole file. To add to `brief.md`, `feedback.md`, `shots.md` or `project.json`, read it with
`studio_file_read` first and write back the complete new content.

## Errors
A tool that fails returns a plain error with the fix. If the error says the tools are not set up, call
`studio_doctor` and follow SKILL.md step 0. If a path or name is refused, correct it and call again. Never ask the
user to install Node, Python or ffmpeg: setup brings its own.

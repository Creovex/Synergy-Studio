---
title: Synergy Studio (lite) video skill
kind: skill
status: active
created: 2026-09-30
updated: 2026-09-30
tags: [video, hyperframes, gsap, kokoro, tts, captions, three-js, skill, synergy-studio]
summary: Lightweight Synergy Studio - a skill plus scripts that let Claude work as a creative director and editor, making narrated motion graphics, footage reels with captions, photo ads cut to music and light 3D with HyperFrames, Kokoro and ffmpeg.
---

# Synergy Studio (lite) video skill

## What it is
The owner asked (2026-09-30) for a lightweight first version of Synergy Studio that mirrors how the videos
in this repository were made (LSPedia, HAURA, AllSpace, the Synergy Studio explainer), instead of the full
MCP server in `code/synergy-studio/ARCHITECTURE.md`. Split of work: the **scripts** own the fixed, fiddly
parts (install, voice, timing, mix, compose/lint, render, loudness, checks); **Claude writes the creative
code** of each video (one HTML page with GSAP) guided by `SKILL.md`, the references and the examples.
The architecture is summarised in `code/synergy-studio/LITE.md`.

## How to use or rebuild it
- Use in Claude Code or Cowork: make the skill available (copy `skills/synergy-studio/` into the project's
  `.claude/skills/` or the user's skills folder), then ask for a video.
- One-time: `node skills/synergy-studio/scripts/studio.mjs setup` (Node 20+, Python 3.10–3.12 or uv;
  about 1 GB: 715 MB tools + 260 MB render browser, measured). Home folder: macOS
  `~/Library/Application Support/SynergyStudioLite`, Windows `%LOCALAPPDATA%\SynergyStudioLite`, Linux
  `~/.local/share/synergy-studio-lite`, or `SYNERGY_STUDIO_HOME`.
- `node skills/synergy-studio/scripts/studio.mjs help` lists every command.

## Files
- `SKILL.md`: the workflow Claude follows.
- `scripts/studio.mjs`: the CLI (setup, doctor, new, voice, audio, compose, stills, render, check, cut,
  transcribe, words, beats). `voice.py` (Kokoro), `audio.py` (timing + music + mix), `beats.py` (beat grid).
- `template/`: `index.html` (page skeleton with `{{…}}` placeholders), `lib.js` (animation helpers and
  captions), `looks.css` (paper / midnight / bold).
- `references/`: creative (finding the idea), intake (brief and business frame), craft (short-form know-how,
  platform specs), storytelling, design (looks, sizes, safe areas), hyperframes, voice-and-audio, footage (cuts,
  captions, beats), three, review (guard rails ⛔ and craft checks ◇), checks-and-fixes, generators (AI
  image/video tools if connected), troubleshooting.
- `template/brief.md`, `shots.md`, `feedback.md`: planning and learning files `studio new` puts in each project.
- `examples/`: three tested projects (see `examples/README.md`).

## Design choice
The owner wants a professional that is still free to be creative (2026-09-30): the references are craft
knowledge and defaults the AI may break on purpose; only the ⛔ guard rails in `references/review.md` are fixed.
Ideas were taken from three skills the owner supplied (video-editing, video-content-strategist, creative-studio).

## Verified (2026-09-30, Linux x64 cloud, 4 CPU)
- Fresh `setup` + `doctor`: all PASS. Narrated 9:16 (28 s) rendered in 46 s; footage edit with captions
  (13 s) in 41 s; three.js product shot (7 s) in 63 s. All passed `studio check` (−14 LUFS, no black or frozen stretches).
- `studio beats`: 118.0 and 96.0 BPM exactly on synthetic songs, beat times within 5 ms.
- **Not verified here:** `studio transcribe` with Whisper (this network blocks huggingface.co, where
  HyperFrames downloads the model); caption import from SRT was verified instead. macOS and Windows runs
  are pending the owner's first use.

## Open items
- First run on the owner's Mac (check transcription there).
- Nigerian English / Pidgin voices are not available in Kokoro; use on-screen text or recorded voice.

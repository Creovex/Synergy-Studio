---
title: Synergy Studio (lite) video skill
kind: skill
status: active
created: 2026-09-30
updated: 2026-09-30
tags: [video, hyperframes, gsap, kokoro, tts, captions, three-js, skill, synergy-studio, mcp]
summary: Lightweight Synergy Studio: a skill plus tools that let Claude work as a creative director and editor, making narrated motion graphics, footage reels with captions, photo ads cut to music, wordless films in any visual style and light 3D with HyperFrames, Kokoro and ffmpeg, in Claude Code and Claude Desktop.
---

# Synergy Studio (lite) video skill

## What it is
The owner asked (2026-09-30) for a lightweight first version of Synergy Studio that mirrors how the videos
in this repository were made (LSPedia, HAURA, AllSpace, the Synergy Studio explainer), instead of the full
system in `code/synergy-studio/ARCHITECTURE.md`. Split of work: the **tools** own the fixed, fiddly
parts (install, voice, timing, mix, compose and lint, render, loudness, checks); **Claude writes the creative
code** of each video (one HTML page with GSAP) guided by `SKILL.md`, the references and the examples.
An MCP server carries the skill (`studio_guide` returns `SKILL.md`, `studio_reference` returns a references file) and
exposes every step as a tool named `studio_*`, so the same skill works in Claude Code and in Claude Desktop, where
there is no terminal. The architecture is summarised in `code/synergy-studio/LITE.md`.

## How to use or rebuild it
- Install it as the Claude Code plugin (the repository is the plugin root; the plugin starts the MCP server) or, for
  Claude Desktop, as the bundle `dist/synergy-studio.mcpb`. The install steps are in the repository's `README.md`.
  Copying the skill folder alone is not enough: the text calls tools that only the server provides.
- One-time setup is a tool call: `studio_doctor`, and if it says "not set up", `studio_setup_start` (about 1 GB, 5 to
  10 minutes; it brings its own Node, uv, Python, ffmpeg and render browser, so the user installs nothing). The tool
  home is `~/Library/Application Support/SynergyStudioLite` on a Mac (or `SYNERGY_STUDIO_HOME`); projects live in
  `~/Movies/Synergy Studio` (or `SYNERGY_STUDIO_PROJECTS`).
- `references/commands.md` lists every tool with its inputs, outputs and the order of work; `references/mcp.md` says
  when to use which and how jobs and pictures work.

## Files
- `SKILL.md`: the workflow Claude follows.
- `references/`: creative (finding the idea), intake (brief and business frame), craft (short-form know-how,
  platform specs), storytelling, design (looks, sizes, safe areas), styles (how to reach any style, with rendered
  snippets), tone, brand-colours (a brand colour as an accent, with a check), cinema, illustration, character,
  hyperframes, voice-and-audio, footage (cuts, captions, beats),
  three, review (guard rails ⛔ and craft checks ◇), checks-and-fixes, generators (AI image and video tools if
  connected), troubleshooting, commands (the tool reference) and mcp (working through the server).
- `template/`: `index.html` (page skeleton with `{{…}}` placeholders), `lib.js` (animation helpers and captions),
  `sketch.js` (the sketch kit for drawn and textured looks), `looks.css` (paper, midnight, bold, luxe), and the brief,
  shot list and feedback templates that `studio_project_new` puts in each project.
- `scripts/`: the program that the tools run (Node modules and Python for voice, audio, beats and look).
- `examples/`: three tested projects (see `examples/README.md`).

## Design choice
The owner wants a professional that is still free to be creative (2026-09-30): the references are craft
knowledge and defaults the AI may break on purpose; only the ⛔ guard rails in `references/review.md` are fixed.
Ideas were taken from three skills the owner supplied (video-editing, video-content-strategist, creative-studio).

## Verified (2026-09-30, macOS on Apple silicon, the owner's MacBook)
- Setup and `studio_doctor`: every line PASS (Node, uv, Python and Kokoro, model files, ffmpeg, ffprobe, arm64
  binaries, HyperFrames, render browser, Whisper program and model, free disk). `studio_synctest`: every flash and
  beep within one frame, mean offset 0 ms.
- The rendered snippets in `references/styles.md` (a match cut with the sketch kit, drawing on twos at 24 fps,
  particles, a 60 fps motion piece, caption styles `pop` and `box`) each rendered and passed the `studio_check` lines.
- The examples render and pass `studio_check` on this Mac (test T5 of the build).
- **Not verified:** use inside Claude Desktop (the owner's test of the bundle); Windows and Linux (the code is written
  for them, the runs are pending).

## Open items
- The owner's first use of the bundle in Claude Desktop, and of the plugin in Claude Code, on his Mac.
- Nigerian English and Pidgin voices are not available in Kokoro; use on-screen text or a recorded voice.
- No tool writes a custom music score; a story that needs one takes the user's track or a generated bed.
- Fonts beyond the four bundled families come only from files the user gives (no web access in Claude Desktop).

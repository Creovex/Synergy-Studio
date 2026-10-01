# Synergy Studio lite

A Claude plugin that makes and improves short videos in any visual style on a Mac. Claude writes each video as
one HTML page animated with GSAP and rendered by HyperFrames, with a local voice (Kokoro), generated music and
ffmpeg. An MCP server carries the skill and exposes the scripts as tools, so Claude Code and Claude Desktop both
see the instructions and can run the whole pipeline: new videos, footage edits with word captions, improving a
finished MP4, looks taken from a reference, three.js scenes.

- Specification: `LITE.md`. Build record and test evidence: `BUILD_LOG.md`. Licences: `NOTICE.md`.
- Proven on macOS on Apple Silicon. Windows and Linux are written for but not proven (PENDING).
- The first use downloads about 2 GB into `~/Library/Application Support/SynergyStudioLite` (its own Node, uv,
  Python, the voice model, the Whisper model, ffmpeg and the render browser). Nothing is installed system wide and
  nothing needs sudo or Homebrew. Videos go to `~/Movies/Synergy Studio`.
- Needs about 10 GB of free disk, and the Xcode Command Line Tools for speech to text captions
  (`xcode-select --install` once, if setup says so).

## Install in Claude Code

Needs Claude Code and Node (any current version; Claude Code starts the server with `node`).

```sh
claude plugin marketplace add Creovex/Synergy-Studio
claude plugin install synergy-studio@synergy-local
```
To use a local copy of this repository instead: `claude plugin marketplace add /path/to/Synergy-Studio`, then the
same install line. Remove it with `claude plugin uninstall synergy-studio@synergy-local` and
`claude plugin marketplace remove synergy-local`.

Then, in any Claude Code session:
- "Use Synergy Studio to create a new video about why you should drink water before coffee."
- "Use Synergy Studio to improve this video: add word captions and an end card. /Users/you/Movies/clip.mp4"

The first time, Claude runs the one time setup (5 to 10 minutes) and then makes the video. The tools are named
`mcp__plugin_synergy-studio_synergy-studio__studio_*`; in headless runs allow them with
`--allowedTools "mcp__plugin_synergy-studio_synergy-studio__*"`.

## Install in Claude Desktop

1. Build the bundle (needs Node and npm, once): in this repository run `npm ci` and then
   `node scripts/pack-bundle.mjs`. It writes and validates `dist/synergy-studio.mcpb`.
2. In Claude Desktop open Settings, then Extensions, then Advanced settings, then Install Extension, and choose
   `dist/synergy-studio.mcpb` (or double click the file). Review the details and install.
3. Start a new chat and ask: "Use Synergy Studio to create a new video about <topic>."

Limits in Claude Desktop: there is no web access, so fonts beyond the bundled Manrope, Inter, Cormorant Garamond
and Jost come only from files you give; a video attached in the chat has no file path, so type the path of a file
on your Mac instead.

## Owner's test in Claude Desktop (T18)

1. Build the bundle as in step 1 above and confirm the last lines say the unpacked server lists 40 tools.
2. Install `dist/synergy-studio.mcpb` in Claude Desktop (Settings, Extensions, Advanced settings, Install Extension).
3. Quit Claude Desktop completely and open it again, then start a new chat.
4. Ask: "Use Synergy Studio to create a new 15 second 9:16 video about drinking water before coffee."
5. If Claude says Synergy Studio is not set up, let it run the setup (about 2 GB, 5 to 10 minutes; the tool home is
   shared with Claude Code, so it is instant if Claude Code already set it up).
6. When Claude gives the MP4 path, open it from Finder (`~/Movies/Synergy Studio/<project>/out/`) and watch it.
7. Then ask: "Use Synergy Studio to improve this video: add word captions and an end card. <path of a short talking
   head clip on your Mac>" and watch that result too.
8. Tell the builder what happened: the answers Claude gave, whether both MP4s play, and anything that looked wrong.
   Logs are in `~/Library/Logs/Claude/` (files starting with `mcp`) and `~/Library/Application Support/SynergyStudioLite/server.log`.

## For developers

- CLI: `node skills/synergy-studio/scripts/studio.mjs help` (the same commands the tools run).
- Tests: `node --test test/*.test.mjs` and pytest on `tests/` (see `tests/requirements-dev.txt`); the harness scripts
  in `test/harness/` run the lite gate's assertions (their README explains each).
- The skill Claude follows is `skills/synergy-studio/SKILL.md` with its `references/`.

## Writing rules

1. No version labels in prose ("v1", "v2", "phase 2" and similar). Pinned versions in code, lockfiles and install logic stay exactly as pinned; `BUILD_LOG.md`, `NOTICE.md` and `research/` may quote them as identifiers.
2. Never use a dash as punctuation between words or clauses; use a comma, colon, semicolon or full stop. Hyphens inside compound names and file names are fine.
3. These rules are copied into `README.md`, `AGENTS.md` and `BUILD_LOG.md`.
4. Name every gap. Nothing unproven is called done: it is PENDING or BLOCKED with the reason.

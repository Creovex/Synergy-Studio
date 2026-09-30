# Synergy Studio lite

A Claude plugin that makes and improves short videos in any visual style on a Mac. Claude writes each video as
one HTML page animated with GSAP and rendered by HyperFrames, with a local voice, generated music and ffmpeg.
An MCP server carries the skill and exposes the scripts as tools, for Claude Code and Claude Desktop.

The specification is `LITE.md`. The build record is `BUILD_LOG.md`.

Install and use steps for Claude Code and Claude Desktop: PENDING (written when the build proves them).

## Writing rules

1. No version labels in prose ("v1", "v2", "phase 2" and similar). Pinned versions in code, lockfiles and install logic stay exactly as pinned; `BUILD_LOG.md`, `NOTICE.md` and `research/` may quote them as identifiers.
2. Never use a dash as punctuation between words or clauses; use a comma, colon, semicolon or full stop. Hyphens inside compound names and file names are fine.
3. These rules are copied into `README.md`, `AGENTS.md` and `BUILD_LOG.md`.
4. Name every gap. Nothing unproven is called done: it is PENDING or BLOCKED with the reason.

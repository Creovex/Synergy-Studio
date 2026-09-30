# Build log

The public record of the lite build: for every task, the worker and its model, the commands rerun by the
orchestrator, their literal output, and PASS, BLOCKED or PENDING.

## Writing rules

1. No version labels in prose ("v1", "v2", "phase 2" and similar). Pinned versions in code, lockfiles and install logic stay exactly as pinned; `BUILD_LOG.md`, `NOTICE.md` and `research/` may quote them as identifiers.
2. Never use a dash as punctuation between words or clauses; use a comma, colon, semicolon or full stop. Hyphens inside compound names and file names are fine.
3. These rules are copied into `README.md`, `AGENTS.md` and `BUILD_LOG.md`.
4. Name every gap. Nothing unproven is called done: it is PENDING or BLOCKED with the reason.

## L0: machine and workspace

Worker: orchestrator (Opus 5.5). Date: 2026-09-30.

`ls ~/Documents ~/Downloads` raised no privacy prompt. Repo folder: the only match is
`/Users/blaze/Documents/Claude Code/Synergy-Studio`; it was empty; `git init` run.

Machine, literal output:
```
$ uname -m
arm64
$ sysctl -n machdep.cpu.brand_string
Apple M4 Pro
$ sw_vers
ProductName:		macOS
ProductVersion:		27.0
BuildVersion:		26A5421a
$ git --version
git version 2.50.1 (Apple Git-155)
$ df -h ~
Filesystem      Size    Used   Avail Capacity iused ifree %iused  Mounted on
/dev/disk3s5   460Gi   385Gi    15Gi    97%    3.2M  159M    2%   /System/Volumes/Data
```
15 GiB free, above the 10 GB floor.

Reference code: `https://github.com/Creovex/random-research`, branch `claude/clever-lamport-n7of0u`, cloned to
`reference/lite-branch/`. Four commits follow `7bc67f3` (`35a02a2`, `646cb60`, `3b0881b`, `6035de2`); James chose
the newest skill files, so the contract commit is `6035de2`, rechecked for newer commits at L10.
`media/haura-intro-reel/` of branch `claude/brave-sagan-ne9yqw` taken by a shallow sparse checkout into
`reference/haura-original/` (508K). Branch files read for L0: none beyond the commit list and file list.

L0: PASS.

## L1: research and rubrics

Workers (Agent tool, model sonnet, one per file, web only): `research/mcp-protocol.md`, `research/claude-code-plugins.md`,
`research/claude-desktop-bundles.md`, `research/runtime-pins.md`. Each has sources and the read date 2026-09-30.
Orchestrator rerun of the pins that go into code (`ledger` evidence L1-pins), literal output:
```
$ curl -s https://nodejs.org/dist/index.json | first v22
v22.23.3 2026-09-23 Jod
$ curl -s https://nodejs.org/dist/v22.23.3/SHASUMS256.txt | grep darwin-arm64.tar.gz
23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53  node-v22.23.3-darwin-arm64.tar.gz
$ curl -sL .../uv/releases/download/0.12.21/uv-aarch64-apple-darwin.tar.gz.sha256
b88bda573e566ef9bced66b155fe0408626fbbc053aee1c30ba686f0728c9447  uv-aarch64-apple-darwin.tar.gz
$ pillow latest
12.3.0
```
Findings that change the build:
- The newest MCP revision (`2026-07-28`) drops `initialize`; Claude Code sent `initialize` on this Mac today, so the
  server supports `2025-11-25` and older (LITE.md "Changes made during the build").
- Plugin MCP tools are named `mcp__plugin_synergy-studio_synergy-studio__<tool>` (from documentation; confirmed at L8).
- Bundle tool: `@anthropic-ai/mcpb` 2.1.2, manifest version `0.3`. MCP TypeScript SDK 1.31.0 for tests.
Rubrics `test/rubrics/T10.md` to `T13.md` written by the orchestrator before any video exists; frozen after L3.

L1: PASS.

# Working in this repository

Read `LITE.md` (the specification) before changing anything. `BUILD_LOG.md` is the public record of every task.

## Writing rules

1. No version labels in prose ("v1", "v2", "phase 2" and similar). Pinned versions in code, lockfiles and install logic stay exactly as pinned; `BUILD_LOG.md`, `NOTICE.md` and `research/` may quote them as identifiers.
2. Never use a dash as punctuation between words or clauses; use a comma, colon, semicolon or full stop. Hyphens inside compound names and file names are fine.
3. These rules are copied into `README.md`, `AGENTS.md` and `BUILD_LOG.md`.
4. Name every gap. Nothing unproven is called done: it is PENDING or BLOCKED with the reason.

## Working rules

- `tmp/` is scratch and is emptied after every task.
- `reference/` and `ledger/` are never committed; neither are videos, renders, models or archives.
- Each worker owns only its own files; no two workers edit the same file.
- Commit format: `lite L<n>: <what changed>`, one commit per level.

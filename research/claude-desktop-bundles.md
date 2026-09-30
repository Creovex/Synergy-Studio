# Claude Desktop MCP bundles (.mcpb): research notes

Research date: 2026-09-30. Method: web only (npm registry, GitHub raw files of modelcontextprotocol/mcpb, Claude docs and help centre, Anthropic engineering blog). Nothing was installed. Page contents were read through a fetch tool that summarises pages, so exact quotes below are as returned by that tool; anything it could not show is marked UNCONFIRMED.

## 1. The current official bundle tool

| Item | Value | Source and date |
| --- | --- | --- |
| npm package | `@anthropic-ai/mcpb` (replaces the deprecated `dxt` CLI, package `@anthropic-ai/dxt`) | npm registry and mcpb README, read 2026-09-30 |
| Latest version | `2.1.2` (dist-tag `latest`; no later version exists) | https://registry.npmjs.org/@anthropic-ai/mcpb, read 2026-09-30 |
| Publish date of 2.1.2 | 2025-12-04 04:57:44 UTC | same registry document, `time` field |
| Registry `modified` | 2026-06-04 (metadata change, not a new version) | same |
| Recent versions | 2.1.2, 2.1.1, 2.1.0 (all 2025-12-04); 2.0.1, 2.0.0 (both 2025-11-04) | same |
| Licence | MIT | same |
| Binary | `mcpb` (points to `dist/cli/cli.js`) | same |
| `engines` field | Not set in registry metadata (Node requirement for the CLI itself is UNCONFIRMED) | same |
| Runtime dependencies (2.1.2) | zod, fflate, ignore, galactus, commander, node-forge, pretty-bytes, @inquirer/prompts, zod-to-json-schema | same |

Install as a dev dependency inside the repo (not global): `npm install --save-dev --save-exact @anthropic-ai/mcpb@2.1.2`, then call it through `npx mcpb ...` or `node_modules/.bin/mcpb`. The official docs show the global form `npm install -g @anthropic-ai/mcpb`; the repo-local form is standard npm behaviour, not something the docs describe (UNCONFIRMED as an officially documented flow, but the package exposes a normal `bin`).

### CLI commands (exact syntax)

Source: https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/CLI.md, read 2026-09-30.

Global: `mcpb [options] [command]`, options `-V, --version` and `-h, --help`.

- `mcpb init [directory]`: interactive manifest creator. Directory defaults to the current directory. Prompts for name, author, id, display name, version (defaults from package.json or 1.0.0), description, server type (Node.js, Python or Binary), entry point, tools, keywords, licence, repository.
- `mcpb validate <path>`: validates a manifest against the schema. `<path>` is manifest.json or a directory containing it. The docs do not say whether it checks that files referenced by `entry_point`, `icon` or `args` exist (UNCONFIRMED; test it, see the gap list).
- `mcpb pack <directory> [output]`: validates manifest.json, applies default exclusions and `.mcpbignore`, writes a ZIP with maximum compression. Output defaults to `extension.mcpb` when `[output]` is omitted. So the exact command for this repo is: `npx mcpb pack <staging-dir> dist/synergy-studio.mcpb`.
- `mcpb info <mcpb-file>`: shows file size, signature status and certificate details if signed.
- `mcpb sign <mcpb-file> [options]`: options `--cert, -c <pem>` (default `cert.pem`), `--key, -k <pem>` (default `key.pem`), `--intermediate, -i <pem...>`, `--self-signed` (generate a self-signed cert if none exists). Signature format is PKCS#7 (CMS), DER encoded.
- `mcpb verify <mcpb-file>`: signature validity, certificate subject, issuer, dates, fingerprint, self-signed warning.
- `mcpb unsign <mcpb-file>`: removes a signature; for development and testing.

Validate command for this repo: `npx mcpb validate bundle/manifest.json` (or the staging directory). Because `pack` validates as well, `pack` failing is also a validation signal.

## 2. The manifest.json schema

Source: https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/MANIFEST.md (spec last updated 2025-12-02 per the file), read 2026-09-30. Cross-checked with https://github.com/modelcontextprotocol/mcpb/blob/main/examples (hello-world-node manifest), read 2026-09-30.

Current `manifest_version`: `"0.3"`. (Whether a `"0.4"` exists is UNCONFIRMED; the main branch spec read showed `"0.3"`.)

### Required

- `manifest_version`: `"0.3"`
- `name`: machine readable identifier
- `version`: semver string
- `description`: short description
- `author`: object, `name` required, `email` and `url` optional
- `server`: object with:
  - `type`: `"node"`, `"python"`, `"binary"` or `"uv"`
  - `entry_point`: path to the main file, relative to the bundle root
  - `mcp_config`: `command`, `args`, optional `env`, optional `platform_overrides`

### Optional

`display_name`, `long_description` (markdown), `icon` (single file) and `icons` (variants with `size` and `theme`), `repository` (`{type, url}`), `homepage`, `documentation`, `support`, `screenshots`, `keywords`, `license`, `privacy_policies` (needed when the server talks to external services handling user data), `localization`, `compatibility`, `user_config`, `tools` (array of `{name, description}`), `prompts` (array of `{name, description, arguments, text}`), `tools_generated` and `prompts_generated` (booleans), `_meta`.

`compatibility` object (all keys optional, semver ranges): `claude_desktop` (for example `">=1.0.0"`), `platforms` (array of `"darwin"`, `"win32"`, `"linux"`), `runtimes` (for example `{"node": ">=16.0.0"}`).

`user_config` types: `string`, `number`, `boolean`, `directory`, `file`; fields include `title`, `description`, `sensitive`, `required`, `default`, `min`, `max`, `multiple`.

Icon guidance (Claude docs, https://claude.com/docs/connectors/building/mcpb, read 2026-09-30): `icon.png`, PNG with transparency, 512x512 recommended, 256x256 minimum, in bundle root or a given path.

### Substitutions (in `args`, `env`, and user_config defaults)

`${__dirname}` (unpacked extension directory), `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}`, `${DOWNLOADS}`, `${pathSeparator}` or `${/}`, `${user_config.KEY}`. The Anthropic blog (https://www.anthropic.com/engineering/desktop-extensions, published 2025-06-26) also lists `${TEMP}`.

### Minimal valid example, Node server, all three platforms

Node and `${__dirname}` are platform neutral, so one config serves macOS (`darwin`), Windows (`win32`) and Linux. Adapted to this repo's entry `mcp/server.mjs`:

```json
{
  "manifest_version": "0.3",
  "name": "synergy-studio",
  "version": "1.0.0",
  "description": "Synergy Studio MCP server for Claude Desktop",
  "author": { "name": "Synergy Studio" },
  "server": {
    "type": "node",
    "entry_point": "mcp/server.mjs",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/mcp/server.mjs"]
    }
  },
  "compatibility": {
    "platforms": ["darwin", "win32", "linux"],
    "runtimes": { "node": ">=18.0.0" }
  }
}
```

Notes:
- The upstream minimal example (name `my-extension`, entry `server/index.js`) has exactly the required fields above; `compatibility` is my addition and is optional.
- The Node floor `>=18.0.0` is my choice, not from the docs (upstream examples use `>=16.0.0`). Set it to whatever the server needs; the bundled Node version is UNCONFIRMED (section 3).
- Claude docs say Claude Desktop itself runs on macOS and Windows only. `linux` in `platforms` is valid schema but has no Claude Desktop meaning today. Keep it or drop it; harmless either way.
- The upstream full example uses `"args": ["server/index.js"]` without `${__dirname}` in one place, while the minimal example uses `${__dirname}`. Use `${__dirname}` to be safe.
- Because `skills/` is read by the server at run time, the server should resolve it from `import.meta.url` or the `${__dirname}` path, not from the working directory (see section 3).

## 3. How Claude Desktop runs a Node bundle

- Built-in runtime: CONFIRMED that Claude Desktop ships a Node.js runtime on macOS and Windows so users need no separate install. Sources: mcpb README ("Node.js ships with Claude for macOS and Windows, which means your bundle will work out-of-the-box"), https://claude.com/docs/connectors/building/mcpb, and the help centre article https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop, all read 2026-09-30.
- Which Node version: UNCONFIRMED. No page I could read states the bundled version. Do not rely on features newer than the manifest's declared floor; verify empirically (see gap list).
- Transport: the server runs on the user's machine over stdio.
- PATH available to the server: UNCONFIRMED. The docs do not state it. Use `command: "node"` as the spec shows, and avoid spawning other tools that need a user shell PATH (a zero dependency server does not need to).
- Working directory: UNCONFIRMED. No documentation found. Do not depend on it; resolve all paths from `import.meta.url` or from a `${__dirname}` passed in `args`.
- Substitution: the host replaces `${__dirname}` with the absolute path of the unpacked extension directory, and `${HOME}` and similar tokens with user paths, before starting the process (spec text and blog above). `${user_config.KEY}` is replaced with values the user entered at install time. Sensitive `user_config` values are stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux distro keychain) per the help centre article.
- Logs on macOS: general Claude Desktop MCP logging is `~/Library/Logs/Claude/mcp*.log`, with `mcp-server-SERVERNAME.log` capturing the server's stderr (secondary sources: https://wjgilmore.com/articles/viewing-claude-desktop-mcp-server-logs/ and a web search summary, read 2026-09-30). The exact file name for `.mcpb` extensions is UNCONFIRMED (the help centre only says to check the log in the Extensions settings panel and enable debug logging). Practical rule: write diagnostics to stderr only; stdout is the JSON-RPC channel.

## 4. What gets packed

Source: CLI.md (read 2026-09-30), mcpb README, blog.

- `.mcpbignore`: honoured, in the project root (the directory passed to `pack`). Supports exact filenames, globs (`*.log`, `temp/*`), directory paths (`docs/`, `coverage/`), `#` comments and blank lines. Patterns merge with the default exclusions and the CLI reports how many extra patterns it applied. Under the hood the package depends on `ignore` (gitignore style matcher); full gitignore semantics such as `!` negation are UNCONFIRMED.
- Default exclusions: `.DS_Store`, `Thumbs.db`, `.git/`, `*.log`, `npm-debug.log*`, `node_modules/.cache/`, `*.map`, `.env.local`, `package-lock.json`, `yarn.lock`, "and others" (the full list is UNCONFIRMED). Watch out: any `.log` or `.map` file under `skills/` would be dropped silently.
- `node_modules`: included when present in the directory being packed (the docs tell Node bundle authors to run `npm install --production` and ship the whole `node_modules`), except `node_modules/.cache/` and `node_modules/.bin/`. This matters for us: the repo will have the dev dependency `@anthropic-ai/mcpb` and its tree in `node_modules`. Because the server has zero dependencies, pack from a staging directory that contains only `manifest.json`, `mcp/` and `skills/` (and an optional `icon.png`), not from the repo root. Alternatively list `node_modules/` in `.mcpbignore`.
- Whether `pack` requires a `package.json`: UNCONFIRMED (not stated; the README calls it optional).
- Size limits: UNCONFIRMED. No documented maximum bundle size was found in the CLI docs, README, Claude docs or blog. The CLI depends on `pretty-bytes`, and `mcpb info` prints file size, but no limit is documented. Compression is ZIP at maximum level.

## 5. How a user installs a `.mcpb`

Source: https://claude.com/docs/connectors/building/mcpb and the help centre article, both read 2026-09-30.

Any of these three:
1. Double click the `.mcpb` file.
2. Drag and drop the file into the Claude Desktop window.
3. Settings > Extensions > Advanced settings > Install Extension..., then select the file.

Each opens an installation dialog where the user reviews extension details and permissions, fills any required settings (generated from `user_config`), grants permissions and completes installation. Installation is per user. On macOS the help centre says system permission dialogs may appear. Directory listing of desktop extensions is deprecated and the directory no longer accepts MCPB submissions, so distribution is by handing users the file (or via a plugin). Team and Enterprise admins have allowlist and policy controls (see https://support.claude.com/en/articles/12702546-deploying-enterprise-grade-mcp-servers-with-desktop-extensions, not read in full: UNCONFIRMED details).

## 6. Does the server receive the user's environment?

UNCONFIRMED. No source read states whether the child process inherits Claude Desktop's environment or only `mcp_config.env` plus a minimal set. The spec says `mcp_config.env` holds environment variables to set, and the blog describes `${HOME}` and `${TEMP}` as system environment values usable in configuration. Safe design: treat the environment as minimal, set every variable the server needs explicitly in `mcp_config.env` (using `${user_config.*}` or `${HOME}` substitutions), and never assume `PATH`, `SHELL` or shell profile variables exist.

## Gaps, ranked by importance for this project

1. Largest gap: environment inheritance, PATH, working directory and bundled Node version (sections 3 and 6). None is documented in the pages I could read. Resolve by a one minute empirical test: a tiny bundle whose server writes `process.version`, `process.cwd()`, `process.env.PATH` and `Object.keys(process.env)` to stderr, installed in Claude Desktop, then read the log.
2. Exact `.mcpb` log file name and location on macOS (section 3).
3. Size limits (section 4).
4. Whether `mcpb validate` checks that referenced files exist, and the full default exclusion list (sections 1 and 4). Test locally after adding the dev dependency.
5. Whether a manifest version newer than `"0.3"` exists and whether the Node floor in `compatibility.runtimes` is enforced by Claude Desktop.

## Sources

- https://registry.npmjs.org/@anthropic-ai/mcpb (package metadata, read 2026-09-30; version 2.1.2 published 2025-12-04)
- https://github.com/modelcontextprotocol/mcpb (repository; README read 2026-09-30)
- https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/README.md (read 2026-09-30)
- https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/CLI.md (read 2026-09-30)
- https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/MANIFEST.md (spec dated 2025-12-02, read 2026-09-30)
- https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/examples/hello-world-node/manifest.json (read 2026-09-30)
- https://claude.com/docs/connectors/building/mcpb (Claude docs, read 2026-09-30)
- https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop (read 2026-09-30)
- https://www.anthropic.com/engineering/desktop-extensions (published 2025-06-26, read 2026-09-30)
- https://wjgilmore.com/articles/viewing-claude-desktop-mcp-server-logs/ (secondary source for log paths, via search result, 2026-09-30)
- https://support.claude.com/en/articles/12702546-deploying-enterprise-grade-mcp-servers-with-desktop-extensions (listed in search results only, 2026-09-30)

# Claude Code plugins, marketplaces, MCP naming and headless runs

Researched 2026-09-30. Installed CLI: `claude --version` printed `2.1.285 (Claude Code)`.

Method: official docs fetched from code.claude.com on 2026-09-30, plus read only `claude --help`, `claude plugin --help`, `claude plugin marketplace --help`, `claude mcp --help` and the help of `install`, `uninstall`, `disable`, `validate`, `marketplace add`. Nothing was installed, added or changed. Where a statement comes from the docs it carries the URL; where it comes from the local CLI it says "CLI help".

Confidence tags: CONFIRMED (docs or CLI help say it in so many words), LOCAL (observed on this Mac), INFERRED (follows from a documented rule but not stated for our exact case), UNCONFIRMED.

---

## 1. Schemas

### 1.1 `.claude-plugin/plugin.json`

Source: https://code.claude.com/docs/en/plugins/manifest-reference (fetched 2026-09-30).

The manifest is optional. Without it Claude Code loads the standard layout and takes the name from the marketplace entry. `name` is the only required key. Save at `.claude-plugin/plugin.json`; every other plugin file (skills, hooks, `.mcp.json`) lives at the plugin root, not inside `.claude-plugin/`.

Top level fields (CONFIRMED):

| Field | Type | Notes |
| :- | :- | :- |
| `name` | string, REQUIRED | Non empty, no spaces, no `@`, no `:`, no path separators. Use kebab-case. Namespaces every component. |
| `$schema` | string | Ignored at load. |
| `displayName` | string | UI label only. |
| `version` | string | Not checked against semver. Setting it pins users to that version until it changes. |
| `description` | string | Optional (validator warns if missing). |
| `author` | object | `name` required inside it; `email`, `url` optional. |
| `homepage` | string | Must parse as a URL or the plugin fails to load. |
| `repository`, `license`, `keywords` | string, string, string[] | Metadata. |
| `metadata` | object | Free form, not read. |
| `defaultEnabled` | boolean | Default `true`. |
| `dependencies` | array | Other plugins. |
| `settings` | object | Only `agent` and `subagentStatusLine` take effect. |
| `userConfig` | object | Prompted values; strict object. |
| `channels` | array | Strict. |
| `skills` | path or path[] | ADDS to the default `skills/` scan. `"./"` or `"."` means plugin root. |
| `commands` | path, path[] or object | REPLACES default `commands/`. |
| `agents` | path or path[] | `.md` files only; replaces default `agents/`. |
| `hooks` | path, object or array | Merged with `hooks/hooks.json`. |
| `mcpServers` | path, object or array | Merged with `.mcp.json` (see section 2). |
| `lspServers`, `outputStyles`, `workflows`, `experimental` | various | Not relevant to us. |

Unrecognised top level keys are stripped and `claude plugin validate` warns (error under `--strict`). Unknown keys inside `userConfig`, `channels`, `lspServers` or `monitors` entries are errors. All component paths must start with `./`, resolve inside the plugin root and exist.

Minimal manifest that is enough for our repo (INFERRED from the above; nothing more than `name` is required):

```json
{
  "name": "synergy-studio",
  "version": "0.1.0",
  "description": "Synergy Studio video tools",
  "author": { "name": "Synergy" }
}
```

Note: a `CLAUDE.md` at the plugin root is NOT loaded as context and validate warns about it; put instructions in a skill (same page).

### 1.2 `.claude-plugin/marketplace.json`

Sources: https://code.claude.com/docs/en/plugins/marketplace-reference and https://code.claude.com/docs/en/plugin-marketplaces (fetched 2026-09-30).

Required top level: `name`, `owner`, `plugins` (CONFIRMED: "`name`, `owner`, and `plugins` are required").

| Field | Rule |
| :- | :- |
| `name` | Letters, digits, `.`, `_`, `-`; start with letter or digit; no `..`. Becomes the part after `@` in every plugin id. Reserved names exist (`claude-plugins-official`, `anthropic-*`, `inline`, `builtin`, `skills-dir`, `synced`, `npm`, `github` and others, and anything starting `claudeai-`). Do not use these. |
| `owner` | Object; `name` required, `email` and `url` optional. |
| `plugins` | Array of entries. Each entry is validated alone. |
| `description`, `version`, `metadata.*` | Optional. `metadata.pluginRoot` (v2.1.239+) allows bare source names. |

Plugin entry: `name` and `source` required. Entry `name` is what users type before `@`. Keep it identical to the `name` in `plugin.json` (the docs warn that a mismatch produces `Plugin "<manifest-name>" not found in marketplace`).

`source` for a plugin at the marketplace root. The reference table says of the relative path type: "A directory inside the marketplace, resolved from the marketplace root. Must start with `./`, unless you write a bare name under `metadata.pluginRoot`. `"."` on its own means the root itself." So both `"./"` and `"."` are documented as the root (CONFIRMED for `"."`; `"./"` follows the `./` prefix rule and the `skills` field explicitly treats `"."` and `"./"` as equal, so INFERRED for `"./"` in a marketplace entry). Recommendation: run `claude plugin validate` on the real file before relying on it (see section 3).

Example for our repo (marketplace name deliberately different from the plugin name to avoid confusion in ids; either works):

```json
{
  "name": "synergy-local",
  "description": "Local marketplace for the Synergy Studio plugin",
  "owner": { "name": "Synergy" },
  "plugins": [
    {
      "name": "synergy-studio",
      "source": "./",
      "description": "Synergy Studio video tools"
    }
  ]
}
```

Install id would then be `synergy-studio@synergy-local`.

Strict mode caveat (CONFIRMED, marketplace-reference): "When a marketplace entry whose `source` is the marketplace root lists specific `skills` subdirectories, only those subdirectories load, and the plugin's default `skills/` directory isn't scanned." So do NOT put a `skills` key in the marketplace entry for a root plugin unless that is wanted. `strict` defaults to `true`; with `plugin.json` present the entry's component fields are appended to it.

UNCONFIRMED: whether a plugin whose root equals the marketplace root gets the whole repo folder copied into the plugin cache when the marketplace was added as a directory. The docs say a marketplace added from a local directory is "read in place" and plugins from a relative path "read the plugin's files directly from `my-marketplace/plugins/`" with no version bump needed (create-marketplace page, "Test an edit to a plugin"). So for a `directory` marketplace, `${CLAUDE_PLUGIN_ROOT}` most likely points at the repo folder itself. Verify with `claude plugin list --json` (`installPath` field is documented) after install.

---

## 2. Where plugin MCP servers are declared, and `${CLAUDE_PLUGIN_ROOT}`

Sources: https://code.claude.com/docs/en/mcp ("Plugin-provided MCP servers") and https://code.claude.com/docs/en/plugins/manifest-reference (fetched 2026-09-30).

CONFIRMED: "Plugins define MCP servers in `.mcp.json` at the plugin root or inline in `plugin.json`." Both work. Claude Code "loads `.mcp.json` at the plugin root first, then each declared shape in order. A server name declared later replaces an earlier one." So a root `.mcp.json` alone is sufficient and no `mcpServers` key is needed in `plugin.json`. Do not declare the same server in both places; the later one wins.

`.mcp.json` shape, per the docs (top key is `mcpServers`):

```json
{
  "mcpServers": {
    "synergy-studio": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]
    }
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` (CONFIRMED, manifest-reference "Environment variables"): resolves to the "Absolute path of the plugin's installed version". For MCP stdio servers it is substituted inline in `command`, `args` and `env`, and it is also exported as an environment variable (`CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`) to the server process. For http/sse/ws servers it substitutes in `url`, `headers`, `headersHelper`. It is not present in the environment of commands the model runs through Bash. `${CLAUDE_PLUGIN_ROOT}` changes on plugin update, so do not write state there; use `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`, survives updates) or another user path for renders. No quoting is needed inside `args` because each element is one argument, which matters if the install path contains spaces (our folder is `Claude Code/Synergy-Studio`, which has a space).

Lifecycle (CONFIRMED): enabled plugins' servers connect automatically at session start; you add or remove them by installing or uninstalling the plugin, not via `/mcp`. In a session without an interactive terminal, `/reload-plugins` does not connect or disconnect plugin MCP servers; changes take effect next session.

Validation (CONFIRMED, needs v2.1.281+, we have 2.1.285): `claude plugin validate` also checks each MCP entry in `.mcp.json`, in a `.json` file named by `mcpServers`, or inline.

---

## 3. Commands: add a local marketplace, install, disable, uninstall, remove, validate

Sources: CLI help (2.1.285, 2026-09-30) and https://code.claude.com/docs/en/plugins/cli-reference (fetched 2026-09-30).

Literal CLI help lines:

- `add [options] <source>      Add a marketplace from a URL, path, or GitHub repo`
- `--scope <scope>      Where to declare the marketplace: user (default), project, or local`
- `install|i [options] <plugin>         Install a plugin from available marketplaces (use plugin@marketplace for specific marketplace)`
- `-s, --scope <scope>        Installation scope: user, project, or local (default: "user")`
- `-y, --yes                  Accept the displayed marketplace-declared command ... (required when stdin or stdout is not a TTY)` (only relevant to `command` sources; not needed for a relative path source)
- `--json                     Print one machine-readable result line on stdout instead of the human message`
- `disable [options] [plugin]           Disable an enabled plugin` with `-a, --all`, `-s, --scope <scope>  Installation scope: user, project, local (default: auto-detect)`
- `uninstall|remove [options] <plugin>  Uninstall an installed plugin` with `--keep-data`, `-s, --scope` (default user), `--prune`, `-y`
- `remove|rm [options] <name>  Remove a configured marketplace`
- `validate [options] <path>            Validate a plugin or marketplace manifest, or the skills, agents, and commands in a directory` with `--json` and `--strict` ("Treat warnings as errors (exit 1)")

Exact sequence for our repo (the path form `./path`, `../path`, `/path` or `~/path` to a directory yields a `directory` source that is read in place; CONFIRMED in the `marketplace add` table):

```bash
cd "/Users/blaze/Documents/Claude Code/Synergy-Studio"

# 0. validate first (read only)
claude plugin validate . --strict          # picks marketplace.json if present, else plugin.json
claude plugin validate ./.claude-plugin/plugin.json --strict   # validate the plugin manifest explicitly

# 1. add the local marketplace (declares it in settings for the chosen scope)
claude plugin marketplace add "/Users/blaze/Documents/Claude Code/Synergy-Studio" --scope user

# 2. install
claude plugin install synergy-studio@synergy-local --scope user

# 3. confirm
claude plugin list --json          # id, version, scope, enabled, installPath
claude plugin details synergy-studio
```

Scope meaning (CONFIRMED): `--scope` names the settings file written: `user` (default), `project` (shared `.claude/settings.json`), `local` (this project, gitignored). For test runs, `--scope local` keeps the change out of the user wide config but is tied to the project directory; `--scope user` makes it available in every directory.

Teardown:

```bash
claude plugin disable synergy-studio@synergy-local --scope user      # keep installed, switch off
claude plugin enable  synergy-studio@synergy-local --scope user
claude plugin uninstall synergy-studio@synergy-local --scope user [--keep-data]
claude plugin marketplace remove synergy-local                       # also uninstalls every plugin from it
```

Documented behaviour: uninstalling from the last scope also deletes the plugin's stored options and `~/.claude/plugins/data/<id>/` unless `--keep-data`. `marketplace remove` from the last declaring scope "deletes its cache and uninstalls every plugin you installed from it". Exit codes: 0 success, 1 failure; `validate` adds 2 for an unexpected error. Already installed returns exit 0.

Non interactive: `claude plugin install/uninstall/enable/disable` need no TTY for a normal relative path source (the TTY and `-y` requirement applies to marketplace declared `command` sources and to `uninstall --prune`). INFERRED for `marketplace add` (docs show no prompt).

Validation: `claude plugin validate <path>` is "the authoritative check for a manifest". CONFIRMED.

Alternative that avoids installing anything: `claude --plugin-dir <path>` loads a plugin "for this session only" (CLI help: `--plugin-dir <path>  Load a plugin from a directory or .zip for this session only`). It shows up under marketplace name `inline`. This is the cleanest option for repeated headless tests: no settings change, no cleanup. Whether the MCP tool prefix is identical (`mcp__plugin_synergy-studio_synergy-studio__*`) for `--plugin-dir` plugins is UNCONFIRMED, but the docs give one naming rule for plugin servers without a per source exception. Read `tools` in the `system/init` event to see the real names.

---

## 4. Tool names for `--allowedTools` and `--disallowedTools`

Sources: https://code.claude.com/docs/en/mcp, https://code.claude.com/docs/en/plugins/components, https://code.claude.com/docs/en/permissions (fetched 2026-09-30).

Naming (CONFIRMED):

- Ordinary (user, project, `--mcp-config`) server: `mcp__<server-name>__<tool-name>`.
- Plugin server: `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`. "Any character outside `A-Z`, `a-z`, `0-9`, `_`, and `-` is replaced with `_`". The docs example: server `database-tools` in plugin `my-plugin`, tool `query`, is `mcp__plugin_my-plugin_database-tools__query`.

For us (plugin `synergy-studio`, server `synergy-studio`, hyphens are kept):

```
mcp__plugin_synergy-studio_synergy-studio__<tool>
```

So `mcp__synergy-studio__<tool>` is the name only if the server is loaded as a normal server (for example `--mcp-config` with the same server name, or `claude mcp add`). It will NOT match the plugin loaded server (INFERRED from the naming rule; not tested locally). Hook matchers on a plugin server name alone "never fire", so full tool names are required there.

Wildcards (CONFIRMED, permissions page, lines on allow rules):

- `mcp__puppeteer` matches any tool of that server.
- `mcp__puppeteer__*` "uses wildcard syntax and also matches all tools from the `puppeteer` server".
- "Allow rules accept tool-name globs only after a literal `mcp__<server>__` prefix. The server segment must be glob-free". `mcp__github__get_*` matches its `get_` tools. An unanchored allow glob such as `"*"`, `"B*"` or `"mcp__*"` "is skipped with a warning and doesn't auto-approve anything".
- Deny rules: a bare name or glob deny "removes the matching tools from Claude's context"; `"mcp__*"` denies every MCP tool across all servers.
- Rules with parentheses on `mcp__` names are skipped (no argument matching for MCP tools via allow rules).

To allow every tool of our plugin server (recommended, so a new tool added later is allowed without editing the command):

```bash
--allowedTools "mcp__plugin_synergy-studio_synergy-studio__*"
# equivalent bare server form:
--allowedTools "mcp__plugin_synergy-studio_synergy-studio"
```

`mcp__synergy-studio__*` would work only for the non plugin route. If the test must be robust to either route, pass both entries; an allow rule that matches nothing is harmless.

Also allow the skill so it is not blocked (see section 6): skills are invoked through the Skill tool; UNCONFIRMED whether a `Skill` allow entry is required in `-p` mode, so include `Skill` in `--allowedTools` for the first run and then drop it if unnecessary. Do not add Bash, Edit or Write.

Verification step that removes all doubt: run once with `--output-format stream-json --verbose` and read the `tools` array and `mcp_servers` array in the first `system/init` event (documented fields: `mcp_servers` with `name` and `status`, `plugins` with `name` and `path`, `plugin_errors`). The exact tool strings there are what the permission rules must match.

Caveat: `--tools` restricts built-ins only; "The flag doesn't affect MCP tools; to deny those too, use `--disallowedTools "mcp__*"`" (CLI reference). `--disallowedTools Bash,Edit,Write` as planned is valid; a bare name removes the tool from context.

---

## 5. `claude -p` flags

Sources: CLI help 2.1.285, https://code.claude.com/docs/en/cli-reference and https://code.claude.com/docs/en/headless (fetched 2026-09-30).

| Flag | Finding |
| :- | :- |
| `--max-turns` | NOT listed in `claude --help` on 2.1.285, but documented: "Limit the number of agentic turns (print mode only). Exits with an error when the limit is reached. No limit by default." The CLI reference states "`claude --help` does not list every flag, so a flag's absence from `--help` does not mean it is unavailable." UNCONFIRMED on this binary (not executed; we may not run a session). Test it with a trivial prompt before relying on it. |
| `--output-format stream-json` | CLI help: `"text" (default), "json" (single result), or "stream-json" (realtime streaming)`. The docs' streaming example is `claude -p "..." --output-format stream-json --verbose --include-partial-messages`; the CLI reference examples for `--forward-subagent-text`, `--include-hook-events`, `--prompt-suggestions` all pair stream-json with `--verbose`. Treat `--verbose` as REQUIRED for stream-json in `-p` (well known to error without it; the fetched docs show it in every example but do not print the error text, so the hard requirement itself is INFERRED). Last line is a `result` message. |
| `--model sonnet` | CLI help: alias accepted (`'fable', 'opus', or 'sonnet'`, or full name). CONFIRMED. |
| `--permission-mode` | CLI help choices: `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan` (docs also list `default`, with `manual` as alias). In `-p` with nothing configured the mode is `default`, so any tool not in `--allowedTools` is denied automatically because nobody can answer (docs: "In a `-p` run with no host, these requests are denied either way"). Best fit for our test: `--permission-mode dontAsk` (denies anything that would prompt; allow rules still apply) plus `--allowedTools`. CONFIRMED semantics. Do not use `bypassPermissions`. |
| `--permission-prompts none` | v2.1.259+. Optional; tells the model not to retry denied calls. Listed in CLI help. |
| `--mcp-config <configs...>` | Loads MCP servers from JSON files or strings. With `-p` Claude Code waits for still pending servers up to `MCP_TIMEOUT` (default 30 s) before the first turn (v2.1.221+). Entries that fail validation are skipped silently and reported in `mcp_server_errors` in `system/init`. |
| `--strict-mcp-config` | CLI help: "Only use MCP servers from --mcp-config, ignoring all other MCP configurations". Docs do not say it also drops plugin servers. UNCONFIRMED whether plugin MCP servers survive it; do not combine it with the plugin route. Use it only in the `--mcp-config` route to keep other servers (the many claude.ai connectors on this Mac) out. |
| `--plugin-dir` | Session only plugin load (CLI help). |
| `--bare` | Skips hooks, skills, plugins, MCP servers, CLAUDE.md auto discovery. Would remove our plugin unless `--plugin-dir` and `--mcp-config` are passed explicitly. Also requires `ANTHROPIC_API_KEY` (no OAuth or keychain). Do not use it for the plugin test. |
| `--max-budget-usd` | Print mode only; a second safety cap. CONFIRMED. |
| `--no-session-persistence` | Print mode only; keeps test runs out of the session list. |

Do plugin skills and plugin MCP servers load in `-p`? Docs (headless page, CONFIRMED): "Without `--bare`, `claude -p` loads the same context an interactive session would, including anything configured in the working directory or `~/.claude`." `--bare` "skip[s] auto-discovery of hooks, skills, custom commands, subagents, installed plugins, MCP servers". Therefore in plain `-p` installed (or `--plugin-dir`) plugins, their skills and their MCP servers load. The docs' "Fail CI when a plugin or MCP server doesn't load" section documents `plugins`, `plugin_errors`, `mcp_servers`, `mcp_server_errors` in `system/init`, which is direct evidence that plugins and MCP servers are loaded in `-p`. Note `/reload-plugins` does not attach plugin MCP servers in a non interactive session, so install BEFORE starting the run.

MCP tool discovery detail: MCP tools may be deferred behind tool search (default on); in `-p`, docs (mcp page) say a server needing auth is reported as unavailable. Not relevant to a stdio server without auth.

### Recommended `--max-turns` for 40 to 80 tool calls

Recommendation: `--max-turns 120` for the video run, with `--max-budget-usd` as the money guard.

Reasoning:
- One agentic turn is one model response, which usually carries one tool call; the model can batch several parallel calls in one turn, but a pipeline where each step depends on the previous result is mostly one call per turn. The plan is 40 to 80 calls, so up to about 80 turns of tool use.
- Add overhead: 1 turn to read or invoke the skill, 1 to 3 turns of planning or recovery after a tool error, and the final answer turn. That is about 85 at the top of the range.
- A limit that trips mid render is the worst outcome (the run exits with an error and no final answer), while an unused limit costs nothing. So set about 1.5 times the upper estimate: 120.
- For a smoke test that should only prove the tools are reachable, use `--max-turns 6`.
- Documented behaviour on hitting the cap: "Exits with an error when the limit is reached." The exact `result` subtype (commonly `error_max_turns`) is UNCONFIRMED in the fetched pages; assert on `is_error` / non zero exit rather than the subtype string, and read `permission_denials` in the final `result` line when `stream-json` is used.

Suggested command (plugin installed at user scope):

```bash
claude -p "Use Synergy Studio to make a 15 second 9:16 video about ..." \
  --model sonnet \
  --permission-mode dontAsk \
  --allowedTools "mcp__plugin_synergy-studio_synergy-studio__*" "Skill" \
  --disallowedTools Bash,Edit,Write \
  --output-format stream-json --verbose \
  --max-turns 120 --max-budget-usd 5 \
  --no-session-persistence
```

Session only alternative (no install): add `--plugin-dir "/Users/blaze/Documents/Claude Code/Synergy-Studio"`.

---

## 6. Skill discovery and MCP server `instructions`

### Skills

Source: https://code.claude.com/docs/en/plugins/components and manifest-reference "Standard layout" (fetched 2026-09-30). CONFIRMED:

- Default location `skills/`, "One `<name>/SKILL.md` per skill". Auto discovered with no manifest key needed (the `skills` key only ADDS extra directories).
- "Claude reads every skill's `description`, and when what the user asks for matches it ... Claude loads the skill's instructions and follows them. The user can also run it directly as `/my-plugin:review`."
- Command name is `/<plugin>:<directory>`; a frontmatter `name` replaces the last segment and the plugin prefix stays. For us: `skills/synergy-studio/SKILL.md` in plugin `synergy-studio` becomes `/synergy-studio:synergy-studio`. So the skill `description` must contain the trigger words a prompt like "Use Synergy Studio to make a video" would match, because model invocation depends on the description.
- Direct invocation in `-p` works: "User-invoked skills and custom commands work. Include `/skill-name` in the prompt string and Claude Code expands it before running." (headless page). For a deterministic test, start the prompt with `/synergy-studio:synergy-studio ...` (INFERRED for the namespaced form; the docs give the `/skill-name` form).
- `${CLAUDE_PLUGIN_ROOT}` also substitutes inside skill Markdown bodies.
- `claude plugin validate` does not check a `SKILL.md` at the plugin root; ours is under `skills/`, which it does check.

### MCP server `instructions`

- The public docs pages fetched (mcp, headless, cli-reference, plugins) contain NO statement on the `instructions` field of the initialize result. CONFIRMED absence, so the official docs neither promise nor deny it.
- Web search on 2026-09-30 returned a summary claiming Claude Code passes server instructions to the model and truncates instructions and each tool description at 2KB ("put the main routing facts first"). Sources: https://sunpeak.ai/blogs/mcp-server-instructions-chatgpt-claude/ (secondary, third party) and the GitHub issue list https://github.com/anthropics/claude-code/issues/23808 ("[BUG] MCP server instructions from initialize response are not passed to the model") which shows this was once a bug report. Status of that issue was not read. So: UNCONFIRMED from official docs.
- LOCAL evidence (this very session, 2026-09-30, Claude Code 2.1.285): the harness prompt of this research session contains a block "# MCP Server Instructions ... The following MCP servers have provided instructions" listing per server text (for example for claude.ai connectors), with long ones cut off by a "[truncated]" marker. That shows the current build injects server `instructions` into the model context and truncates long ones. It was observed for claude.ai connector servers, not for a stdio plugin server; the mechanism is per server so a plugin stdio server very likely behaves the same (INFERRED). Advice: keep `instructions` short (well under 2KB), put the critical routing rules first, and ALSO put the workflow in the skill so nothing depends on `instructions`.

---

## 7. `notifications/tools/list_changed`

- LOCAL finding, 2026-09-30, this Mac (Claude Code 2.1.285), from our own test: a headless session listed a new tool after the server sent `notifications/tools/list_changed`, without reconnecting. Recorded as given by the project; not re-run here.
- Docs agree (CONFIRMED): https://code.claude.com/docs/en/mcp says "Claude Code supports MCP `list_changed` notifications, allowing MCP servers to dynamically update their available tools, prompts, and resources without requiring you to disconnect and reconnect. When an MCP server sends a `list_changed` notification, Claude Code automatically refreshes the available capabilities from that server." On the "v2 runtime" Claude Code receives them over a stream it holds open and reopens it (limits: closes again within 10 s, reopen up to 3 times; stays open longer than 10 s then closes, after 5 reopens in an hour it waits about 6 hours). That stream detail is for servers on the newer protocol revision; a stdio server is unaffected by those reopen limits (INFERRED).
- Implication for permissions: a tool added later still needs to match an allow rule; the wildcard `mcp__plugin_synergy-studio_synergy-studio__*` covers it.

---

## Summary of gaps

Largest gap: none of the plugin route was executed (by instruction), so three facts that decide whether the headless test command works are not empirically confirmed: (a) the exact tool prefix for our plugin server (expected `mcp__plugin_synergy-studio_synergy-studio__*`, and whether `--plugin-dir` produces the same), (b) whether `--strict-mcp-config` also drops plugin servers, and (c) `--max-turns` behaviour and result subtype on 2.1.285. The `system/init` event (`tools`, `mcp_servers`, `plugins`, `plugin_errors`) from a first cheap run settles (a) and (b).

Other UNCONFIRMED items: `"./"` versus `"."` as marketplace entry source for a root plugin (validate will tell); whether the plugin root equals the repo folder for a `directory` marketplace (`claude plugin list --json` `installPath`); whether `--verbose` is a hard requirement for `stream-json` (all docs examples include it); whether `Skill` needs to be allowed in `-p`; MCP `instructions` behaviour for a stdio plugin server and the exact 2KB cap (official docs silent).

## Sources

All fetched or searched on 2026-09-30.

- https://code.claude.com/docs/en/plugins/manifest-reference (plugin.json fields, paths, `${CLAUDE_PLUGIN_ROOT}`, standard layout)
- https://code.claude.com/docs/en/plugins/marketplace-reference (marketplace.json fields, relative source, strict, reserved names)
- https://code.claude.com/docs/en/plugin-marketplaces (create and test a local marketplace)
- https://code.claude.com/docs/en/plugins/cli-reference (install, uninstall, disable, validate, marketplace add and remove, scopes, exit codes)
- https://code.claude.com/docs/en/plugins/components (skills discovery, plugin MCP tool naming)
- https://code.claude.com/docs/en/mcp (plugin provided MCP servers, list_changed, `--strict-mcp-config`, headless MCP)
- https://code.claude.com/docs/en/permissions (MCP allow and deny rule syntax and wildcards)
- https://code.claude.com/docs/en/cli-reference (flags including `--max-turns`, `--permission-mode`, `--plugin-dir`, `--bare`)
- https://code.claude.com/docs/en/headless (`claude -p`, stream-json, bare mode, `system/init` fields, permission modes in `-p`)
- https://sunpeak.ai/blogs/mcp-server-instructions-chatgpt-claude/ and https://github.com/anthropics/claude-code/issues/23808 (secondary, only for the `instructions` question; not official)
- Local CLI help, Claude Code 2.1.285: `claude --help`, `claude plugin --help`, `claude plugin marketplace --help`, `claude plugin install --help`, `claude plugin marketplace add --help`, `claude plugin validate --help`, `claude plugin uninstall --help`, `claude plugin disable --help`, `claude mcp --help`
- Local test finding (list_changed) and local harness observation (server instructions injected and truncated), both on this Mac, 2026-09-30

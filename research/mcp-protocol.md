# MCP protocol research (for the zero dependency stdio server)

Research date and access date for every source below: 2026-09-30. Web only (WebFetch, WebSearch).
Spec pages were read at modelcontextprotocol.io. Anything not confirmed is marked UNCONFIRMED.

## 0. Headline finding (read this first)

The current MCP revision is **2026-07-28**, and it is a breaking redesign: there is **no `initialize` handshake and no `notifications/initialized`**, and **no `ping`**. Every request carries the protocol version and client capabilities in `params._meta`, and servers must implement a new `server/discover` RPC. Our spec ("Implements `initialize` ... `notifications/initialized`, `ping` ...") describes the **legacy era** (2025-11-25 and earlier), which the 2026-07-28 spec calls "handshake-based". Every published client that has not yet moved to 2026-07-28 still sends `initialize`. Recommendation: build the legacy path exactly as specified, and treat `server/discover` plus per-request `_meta` as an additive dual-era layer (section 1 and 9). The spec text in the task ("echo the client's requested version when supported") is the legacy rule and remains correct for `initialize`.

## 1. Published protocol version strings

Source: https://modelcontextprotocol.io/llms.txt (read 2026-09-30) lists spec URLs for exactly these released versions plus `draft`. Source: https://modelcontextprotocol.io/specification/versioning (read 2026-09-30) states: "The current protocol version is 2026-07-28."

| Version string | Status | Notes |
| --- | --- | --- |
| `2024-11-05` | Final | Original. HTTP+SSE transport. JSON-RPC batching allowed. |
| `2025-03-26` | Final | Streamable HTTP introduced. Batching still allowed. |
| `2025-06-18` | Final | Batching removed (changelog item 1). Structured tool output, `title`, resource links, elicitation. |
| `2025-11-25` | Final | Last `initialize` era revision. Tasks (experimental), icons, `serverInfo.description`. |
| `2026-07-28` | **Current** | Stateless. No `initialize`. `server/discover`. `resultType` on every result. |
| `draft` | Draft | Not for consumption. |

Version format is `YYYY-MM-DD` of the last backwards incompatible change (versioning page).

### Recommended supported list for a server built today

* For the `initialize` path (what our spec requires): `["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]`. Order newest first; the first entry is the fallback returned for unknown requests (section 2).
* Optional modern layer: add `"2026-07-28"` only if we implement `server/discover`, the required `_meta` handling, `resultType: "complete"` on every result, and `ttlMs`/`cacheScope` on list results (section 9). Do not advertise `2026-07-28` in an `initialize` response unless that whole layer exists. UNCONFIRMED: whether the 2026-07-28 spec allows a legacy `initialize` reply to name `2026-07-28`; the compatibility text says an `initialize` request selects legacy semantics "as specified by the negotiated legacy protocol version", so do not.
* If we keep it minimal and only serve `initialize`: supporting all four legacy versions is safe, because the wire shapes we implement (section 3 and 4) are a compatible subset of all four. Fields added later (`title`, `outputSchema`, `structuredContent`, `icons`) are optional and ignored by older clients.

Sources: versioning page and llms.txt above; https://modelcontextprotocol.io/specification/2025-06-18/changelog (read 2026-09-30); https://modelcontextprotocol.io/specification/2026-07-28/changelog (read 2026-09-30).

## 2. Version negotiation rule

### Legacy (initialize era), source https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle (read 2026-09-30)

Quoted rules:

* "In the `initialize` request, the client MUST send a protocol version it supports. This SHOULD be the latest version supported by the client."
* "If the server supports the requested protocol version, it MUST respond with the same version. Otherwise, the server MUST respond with another protocol version it supports. This SHOULD be the latest version supported by the server."
* "If the client does not support the version in the server's response, it SHOULD disconnect."

So for an unsupported requested version the server returns a **successful `initialize` result** whose `protocolVersion` is the server's latest supported version (not an error). The same page also shows an "Example initialization error" (`-32602`, message "Unsupported protocol version", `data: {supported: [...], requested: "1.0.0"}`), listed under error handling as a case implementations should be prepared for. The normative MUST is the "respond with another version" rule, so our default is: reply with a result carrying `"2025-11-25"` (our latest). An error reply is tolerated by the page's own example but is not the primary rule.

### Modern (2026-07-28), source https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning (read 2026-09-30)

If the server does not implement the requested version it MUST respond with `UnsupportedProtocolVersionError`:

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32022,"message":"Unsupported protocol version","data":{"supported":["2026-07-28","2025-11-25"],"requested":"1900-01-01"}}}
```

The client then retries with a version from `supported`.

## 3. `initialize` result (2025-11-25 shape)

Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle (read 2026-09-30). Request example params: `protocolVersion`, `capabilities`, `clientInfo` (`name`, `title`, `version`, `description`, `icons`, `websiteUrl`). Response example, verbatim structure:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "logging": {},
      "prompts":   { "listChanged": true },
      "resources": { "subscribe": true, "listChanged": true },
      "tools":     { "listChanged": true }
    },
    "serverInfo": {
      "name": "ExampleServer",
      "title": "Example Server Display Name",
      "version": "1.0.0",
      "description": "An example MCP server providing tools and resources"
    },
    "instructions": "Optional instructions for the client"
  }
}
```

(The page's example also includes `tasks` capability and `icons`/`websiteUrl` in `serverInfo`; both omitted here because they are optional and we do not implement them.)

Facts confirmed:

* Capability keys: `prompts`, `resources`, `tools`, `logging`, `completions`, `tasks`, `experimental`. `listChanged` applies to prompts, resources and tools. `subscribe` applies to resources only. A server that supports a feature MUST declare its capability object (tools page, resources page, prompts page). `{}` is valid (means supported, no sub-features), e.g. `"resources": {}`.
* `instructions` is optional.
* `serverInfo.name` is required. `version`, `title`, `description` appear in the example. UNCONFIRMED: which of `version` is schema-required in 2025-11-25 (a schema page excerpt returned by the fetch tool said optional, but that excerpt was otherwise unreliable, see Sources note). Always send both `name` and `version`.
* After the response the client sends `{"jsonrpc":"2.0","method":"notifications/initialized"}` (no `id`, no reply). Client SHOULD NOT send requests other than pings before the initialize response. Server SHOULD NOT send requests other than pings and logging before `initialized`.
* `initialize` MUST NOT be cancelled by the client (cancellation page).
* The "answers within 1 s" requirement is our own spec, not an MCP rule. MCP only says implementations SHOULD set timeouts (lifecycle page, Timeouts section), with no numeric value.
* `ping` (legacy only): request `{"jsonrpc":"2.0","id":"123","method":"ping"}`, response `{"jsonrpc":"2.0","id":"123","result":{}}`, receiver MUST respond promptly (https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping, read 2026-09-30). `ping` is removed in 2026-07-28.

## 4. Method shapes (2025-11-25 wire format; 2026-07-28 differences noted)

### tools/list

Source https://modelcontextprotocol.io/specification/2025-11-25/server/tools (read 2026-09-30). Request `params` is optional `{ "cursor": "..." }`. Result:

```json
{ "tools": [ { "name": "get_weather", "title": "Weather Information Provider",
    "description": "Get current weather information for a location",
    "inputSchema": { "type": "object", "properties": { "location": { "type": "string" } }, "required": ["location"] },
    "outputSchema": { "type": "object", "properties": { "temperature": { "type": "number" } }, "required": ["temperature"] },
    "annotations": { "readOnlyHint": true } } ],
  "nextCursor": "next-page-cursor" }
```

Tool fields: `name` (required, unique), `title` (optional), `description`, `icons` (optional), `inputSchema` (required, MUST be a valid JSON Schema object, never null; default dialect JSON Schema 2020-12), `outputSchema` (optional), `annotations` (optional), `execution` (optional, tasks only).

* No-argument tool: `inputSchema` should be `{ "type": "object", "additionalProperties": false }` (recommended) or `{ "type": "object" }`.
* Tool names: SHOULD be 1 to 128 chars, characters A-Z a-z 0-9 underscore hyphen dot, case sensitive, unique.
* `annotations` keys (from the 2025-11-25 schema excerpt, medium confidence): `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. The excerpt gave all four hints a default of `false`. UNCONFIRMED: the exact default values (the MCP docs elsewhere have described `destructiveHint` and `openWorldHint` as defaulting to `true`); do not rely on defaults, set every hint explicitly. Clients MUST treat annotations as untrusted unless the server is trusted.

### tools/call

Request: `{"method":"tools/call","params":{"name":"get_weather","arguments":{"location":"New York"}}}`. Result:

```json
{ "content": [
    { "type": "text", "text": "..." },
    { "type": "image", "data": "<base64>", "mimeType": "image/png" } ],
  "structuredContent": { "temperature": 22.5 },
  "isError": false }
```

* `content` items: `text` (`{type,text}`), `image` (`{type:"image", data: base64, mimeType, annotations?}`), `audio` (same shape with audio mime), `resource_link` (`{type,uri,name,description?,mimeType?}`), embedded `resource` (`{type:"resource", resource:{uri,mimeType,text|blob}}`). All support optional `annotations` (`audience`, `priority` 0.0 to 1.0, `lastModified`).
* The image item shape in the task statement is confirmed exactly: `{type:"image", data: base64, mimeType}`.
* `structuredContent`: a JSON object in 2025-11-25 (any JSON value in 2026-07-28). A tool that returns it SHOULD also return the serialized JSON in a `text` block. If `outputSchema` is set the server MUST return conforming `structuredContent`.
* `isError`: optional boolean, default false.

### resources/list, resources/read

Source https://modelcontextprotocol.io/specification/2025-11-25/server/resources (read 2026-09-30).

```json
// resources/list result
{ "resources": [ { "uri": "file:///project/src/main.rs", "name": "main.rs", "title": "...", "description": "...", "mimeType": "text/x-rust", "size": 123 } ], "nextCursor": "..." }
// resources/read request params: { "uri": "file:///project/src/main.rs" }
// resources/read result, text
{ "contents": [ { "uri": "file:///project/src/main.rs", "mimeType": "text/x-rust", "text": "fn main() {}" } ] }
// binary item
{ "uri": "file:///example.png", "mimeType": "image/png", "blob": "<base64>" }
```

Resource fields: `uri`, `name` (required), `title`, `description`, `icons`, `mimeType`, `size` (optional), plus `annotations`. Templates (`resources/templates/list`, key `resourceTemplates`, field `uriTemplate`) and `resources/subscribe` are optional; not in our required method list.
Not found: 2025-11-25 says `-32002` ("Resource not found", `data: {uri}`). **2026-07-28 changed this to `-32602`** and says implementations of 2026-07-28 MUST NOT emit `-32002`, while clients SHOULD still accept it from older servers (2026-07-28 changelog and basic/index error codes section). For our legacy `initialize` path, `-32002` is the documented code; `-32602` is accepted by every client and is the safe cross-version choice. UNCONFIRMED which is friendlier to the specific client we target.

### prompts/list, prompts/get

Source https://modelcontextprotocol.io/specification/2025-11-25/server/prompts (read 2026-09-30).

```json
// prompts/list result
{ "prompts": [ { "name": "code_review", "title": "Request Code Review", "description": "...",
    "arguments": [ { "name": "code", "description": "The code to review", "required": true } ] } ], "nextCursor": "..." }
// prompts/get request params: { "name": "code_review", "arguments": { "code": "..." } }   (argument values are strings)
// prompts/get result
{ "description": "Code review prompt",
  "messages": [ { "role": "user", "content": { "type": "text", "text": "Please review ..." } } ] }
```

`role` is `"user"` or `"assistant"`. `content` is a single content object: `text`, `image` (`{type,data,mimeType}`), `audio`, or embedded `resource`. Errors: invalid prompt name and missing required arguments both `-32602`; internal `-32603`.

### Pagination

Source https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination (read 2026-09-30). Opaque cursor. Result carries optional `nextCursor`; request `params.cursor`. Page size is server chosen. Missing `nextCursor` means end. Applies to `resources/list`, `resources/templates/list`, `prompts/list`, `tools/list`. Invalid cursor: `-32602`. Returning everything in one page without `nextCursor` is valid.

### 2026-07-28 deltas for the same methods

Source https://modelcontextprotocol.io/specification/2026-07-28/server/tools (read 2026-09-30) and changelog:

* Every result MUST include `"resultType": "complete"` (or `"input_required"` for multi round trip). Clients treat an absent value as `complete`, so adding it to legacy replies is harmless.
* Results of `tools/list`, `prompts/list`, `resources/list`, `resources/read`, `resources/templates/list` MUST carry `ttlMs` (number, ms) and `cacheScope` (`"public"` or `"private"`).
* Servers SHOULD return tools in deterministic order.
* `annotations`, `outputSchema`, `inputSchema` unchanged in kind; schemas may use any 2020-12 keyword; `structuredContent` may be any JSON value.
* Every request has `params._meta` with required `io.modelcontextprotocol/protocolVersion` (string) and `io.modelcontextprotocol/clientCapabilities` (object); optional `clientInfo`. A request missing a required field MUST be rejected with `-32602`.
* Servers SHOULD put `io.modelcontextprotocol/serverInfo` (`{name, version}`) in each result `_meta`.

## 5. stdio transport rules

Sources: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports and https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio (both read 2026-09-30). Identical core rules:

* The client launches the server as a subprocess. Server reads JSON-RPC from `stdin`, writes to `stdout`.
* "Messages are delimited by newlines, and MUST NOT contain embedded newlines." So serialize with `JSON.stringify` (no pretty printing) and end each message with `\n`. `JSON.stringify` escapes newlines inside strings, so this is safe.
* Messages are UTF-8.
* "The server MAY write UTF-8 strings to its standard error (stderr) for any logging purposes." Clients SHOULD NOT treat stderr output as an error.
* "The server MUST NOT write anything to its stdout that is not a valid MCP message." Never `console.log` to stdout.
* Shutdown: client closes the server's stdin, then SIGTERM, then SIGKILL. Server SHOULD exit promptly on stdin EOF (2026-07-28 page states this explicitly).
* Batches: **JSON-RPC batching was removed in 2025-06-18** ("Remove support for JSON-RPC batching", changelog https://modelcontextprotocol.io/specification/2025-06-18/changelog). It was allowed in 2024-11-05 and 2025-03-26. In 2025-11-25 and 2026-07-28 each stdio message is "a single JSON-RPC request, notification, or response". Recommendation: do not implement batching; if a line parses to a JSON array, reply with a single `-32600` Invalid Request error with `id: null`. UNCONFIRMED: no page states an explicit "MUST reject arrays" rule; that behavior is our recommendation.
* 2026-07-28 stdio: the server MUST NOT write JSON-RPC requests to stdout (no server initiated requests). In the legacy era servers may initiate requests only for sampling, roots, elicitation, ping; we implement none.
* Backward compat probe (2026-07-28 stdio page): a dual-era client first sends `server/discover`; if it gets a non-modern error or times out it falls back to `initialize`. A legacy-only server should answer unknown methods with `-32601` promptly (not hang), so the fallback is fast.

## 6. Error codes and `isError`

Sources: https://modelcontextprotocol.io/specification/2026-07-28/basic/index (error codes section) and https://modelcontextprotocol.io/specification/2025-11-25/server/tools (read 2026-09-30).

| Code | Name | Use |
| --- | --- | --- |
| `-32700` | Parse error | Line is not valid JSON. Reply with `id: null`. |
| `-32600` | Invalid Request | Valid JSON but not a valid request object (including a batch array in our implementation). |
| `-32601` | Method not found | Unknown method, or a capability we did not declare. |
| `-32602` | Invalid params | Malformed `params`, unknown tool name, unknown prompt, missing required prompt argument, invalid cursor. Also resource not found in 2026-07-28. |
| `-32603` | Internal error | Unexpected server fault. |

Standard JSON-RPC codes are confirmed as used by MCP ("MCP uses the standard JSON-RPC 2.0 error codes (-32700, -32600 to -32603)"). MCP specific: `-32002` resource not found (2025-11-25 and earlier), `-32042` URL elicitation required (2025-11-25 only), `-32020` HeaderMismatch, `-32021` MissingRequiredClientCapability, `-32022` UnsupportedProtocolVersion (2026-07-28). Range `-32020` to `-32099` is reserved for the MCP spec; do not invent codes there.

Rule for tools (tools page, "Error Handling"):

* JSON-RPC error (protocol error): unknown tool (`-32602`, example message "Unknown tool: invalid_tool_name"), request that fails the CallToolRequest schema (bad `params` shape), and server faults.
* `isError: true` inside a normal result (tool execution error): API failures, input validation errors (bad date, value out of range), business logic errors. Text should be actionable so the model can retry. Clients SHOULD pass these to the model.
* Practical split: if arguments do not match the tool's `inputSchema` semantically (wrong value), the page classes "input validation errors" as `isError: true`; if the request envelope is malformed or the tool does not exist, use `-32602`. UNCONFIRMED: whether an argument missing a schema `required` field should be `-32602` or `isError`. The 2025-11-25 text lists input validation errors under `isError`; SDK behavior varies. Pick one and document it.
* A JSON-RPC error for a request MUST carry the request `id`; use `null` only when the id could not be read. Never reply to notifications (messages without `id`), including unknown notifications: ignore them.

## 7. Cancellation and progress (brief)

Sources: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation and .../progress (read 2026-09-30).

* Cancel: `{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"123","reason":"..."}}`. Receiver SHOULD stop work, free resources, and not send a response for the cancelled request. It MAY ignore unknown or completed ids. Race conditions must be handled gracefully. `initialize` cannot be cancelled. Still present in 2026-07-28 (stdio uses it to cancel; server MUST NOT send further messages for that request).
* Progress: request opts in with `params._meta.progressToken` (string or integer, unique among active requests). Server may then send `{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"abc123","progress":50,"total":100,"message":"..."}}`. `progress` MUST increase on each notification; `total` and `message` optional; may be floats. Must stop after completion. Servers may send none.
* Both are optional for a minimal server: accepting and ignoring `notifications/cancelled` is compliant; sending progress is optional. Because a synchronous handler cannot be interrupted, handling cancel usually means tracking in-flight ids and suppressing the reply.

## 8. Official TypeScript SDK on npm

* Registry read: https://registry.npmjs.org/@modelcontextprotocol/sdk and .../latest (read 2026-09-30). `dist-tags.latest` is **1.31.0** (the `/latest` document reports version 1.31.0, gitHead `4b0051f400219f8d8855f9a5433c6df35f15a639`, unpacked size 4,373,210 bytes). Previous versions listed: 1.30.0, 1.29.0, and so on downward.
* Publish date of 1.31.0: the registry `time` map could not be extracted (the fetch tool returned only a truncated portion). The `_npmOperationalInternal.tmp` value in the `/latest` document is `1790621976208`, which is epoch milliseconds and decodes to **2026-09-28T18:59:36Z** (my own arithmetic from the epoch value). Independent corroboration: the GitHub releases page for the TypeScript SDK (https://github.com/modelcontextprotocol/typescript-sdk/releases, read 2026-09-30) lists 1.31.0 released September 28 at 18:52 (time zone and year not stated on the summary I received; consistent with the decoded timestamp). Best answer: 1.31.0, published 2026-09-28 (about 18:5x to 19:00 UTC). The exact ISO publish `time` value is UNCONFIRMED.
* Important nuance: the same GitHub releases page marks **2.2.0** as "Latest" (released September 28 at 19:24) and lists split packages at 2.2.0: `@modelcontextprotocol/server`, `@modelcontextprotocol/server-legacy`, `@modelcontextprotocol/core`, `@modelcontextprotocol/client`, `@modelcontextprotocol/codemod`. So the 2.x line is published under different package names, while `@modelcontextprotocol/sdk` stays on the 1.x line with `latest` at 1.31.0 (1.30.1 shipped September 23). I did not read those package pages on npm, so npm publication and dist-tags of the 2.x packages are UNCONFIRMED. For our zero dependency server this does not matter (no SDK is used), but the SDK's behavior is a useful reference implementation.

## 9. Recommended implementation plan (derived from the above)

1. Core (required by our spec): newline delimited JSON-RPC on stdio; methods `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`.
2. `initialize`: if `params.protocolVersion` is in `["2025-11-25","2025-06-18","2025-03-26","2024-11-05"]` echo it, else return `"2025-11-25"`. Reply with `capabilities` (`tools`, `resources`, `prompts`, each `{ "listChanged": false }` or `{}`), `serverInfo {name, version}`, optional `instructions`.
3. Reply to unknown methods with `-32601`, unparseable lines with `-32700` (`id: null`), invalid envelopes with `-32600`. Ignore unknown notifications silently. Answer `ping` with `{}`.
4. Tool failures: `isError: true` in the result; unknown tool or malformed params: `-32602`.
5. Optional modern layer (only if we want to talk to 2026-07-28 clients): handle `server/discover` returning `{resultType:"complete", supportedVersions:[...], capabilities:{...}, _meta:{"io.modelcontextprotocol/serverInfo":{name,version}}, instructions, ttlMs, cacheScope}`; when a request carries `_meta["io.modelcontextprotocol/protocolVersion"]` treat it stateless, require that version and `clientCapabilities`, return `-32022` with `data:{supported,requested}` on mismatch, add `resultType:"complete"` to every result and `ttlMs`/`cacheScope` to list results. The `server/discover` request/response shape was read directly (https://modelcontextprotocol.io/specification/2026-07-28/server/discover). UNCONFIRMED: whether Claude Code, Claude Desktop or other target clients already send `server/discover` today (not researched).

## Sources (all accessed 2026-09-30)

* https://modelcontextprotocol.io/llms.txt (version string inventory)
* https://modelcontextprotocol.io/specification/versioning (current version 2026-07-28, negotiation summary)
* https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning (UnsupportedProtocolVersionError, compatibility matrix)
* https://modelcontextprotocol.io/specification/2026-07-28/basic/index (`_meta`, resultType, error code allocation)
* https://modelcontextprotocol.io/specification/2026-07-28/basic/transports (binding overview)
* https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio (stdio rules, shutdown, probe)
* https://modelcontextprotocol.io/specification/2026-07-28/server/discover (server/discover shapes)
* https://modelcontextprotocol.io/specification/2026-07-28/server/tools (modern tools shapes)
* https://modelcontextprotocol.io/specification/2026-07-28/changelog (changes since 2025-11-25)
* https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle (initialize, version negotiation, capabilities)
* https://modelcontextprotocol.io/specification/2025-11-25/basic/transports (stdio rules)
* https://modelcontextprotocol.io/specification/2025-11-25/server/tools
* https://modelcontextprotocol.io/specification/2025-11-25/server/resources
* https://modelcontextprotocol.io/specification/2025-11-25/server/prompts
* https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination
* https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation
* https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress
* https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping
* https://modelcontextprotocol.io/specification/2025-11-25/schema (used only for `ToolAnnotations` field names; the fetch tool summarized it with visible errors, for example it listed URL elicitation as `-32002` although the 2026-07-28 page says `-32042`, and it omitted `instructions` and `structuredContent`, so treat anything sourced only from this excerpt as low confidence)
* https://modelcontextprotocol.io/specification/2025-06-18/changelog (batching removed)
* https://registry.npmjs.org/@modelcontextprotocol/sdk and https://registry.npmjs.org/@modelcontextprotocol/sdk/latest (latest 1.31.0)
* https://github.com/modelcontextprotocol/typescript-sdk/releases (release dates, 2.x split packages)
* https://www.npmjs.com/package/@modelcontextprotocol/sdk (HTTP 403, not readable)

## UNCONFIRMED summary

1. Largest gap: exact ISO publish time of `@modelcontextprotocol/sdk@1.31.0` from the registry `time` map (date 2026-09-28 is corroborated by two indirect signals).
2. Whether target clients already speak 2026-07-28 (`server/discover`) or still send `initialize`.
3. Exact ToolAnnotations default values, and whether `serverInfo.version` is schema-required.
4. Whether a missing schema `required` argument should be `-32602` or `isError: true` (spec text is ambiguous; choose and document).
5. Whether any spec page explicitly mandates rejecting JSON-RPC batch arrays (our reject with `-32600` is a recommendation).
6. npm publication status of the 2.x split packages.

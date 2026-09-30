#!/usr/bin/env node
// Synergy Studio MCP server: stdio, newline delimited JSON-RPC, Node built ins only.
// Standard output carries protocol messages and nothing else; logs go to standard error and <home>/server.log.
import {
  SERVER_NAME,
  SERVER_VERSION,
  INSTRUCTIONS,
  SUPPORTED_PROTOCOLS,
  UserError,
  home,
  projectsRoot,
  tryEnv,
  notSetUpText,
  log,
} from "./context.mjs";
import { TOOLS } from "./tools.mjs";
import { validateArguments } from "./schema.mjs";
import { listResources, readResource, PROMPTS, getPrompt } from "./content.mjs";

// Tests only: SYNERGY_STUDIO_TEST_DROP_TOOL names tools to leave out, to prove the tool list assertion can fail.
const dropped = new Set((process.env.SYNERGY_STUDIO_TEST_DROP_TOOL ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const tools = TOOLS.filter((t) => !dropped.has(t.name));
const toolByName = new Map(tools.map((t) => [t.name, t]));
const inflight = new Map();
const pending = new Set();

const inputSchema = (t) => ({ type: "object", properties: t.properties, required: t.required, additionalProperties: false });
const toolListing = () =>
  tools.map((t) => ({ name: t.name, title: t.title ?? t.name, description: t.description, inputSchema: inputSchema(t), annotations: t.annotations }));

function send(message) {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch (error) {
    log("could not write a reply:", error.message);
  }
}
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const replyError = (id, code, message, data) => send({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });
const rpcError = (message, code) => Object.assign(new Error(message), { rpcCode: code });

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function initialize(params) {
  if (!isObject(params) || typeof params.protocolVersion !== "string") throw rpcError("initialize needs params with a protocolVersion (text).", -32602);
  const info = isObject(params.clientInfo) ? `${params.clientInfo.name ?? "unknown"} ${params.clientInfo.version ?? ""}`.trim() : "unknown client";
  log(`client ${info} requested protocol version ${params.protocolVersion}`);
  const version = SUPPORTED_PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOLS[0];
  if (version !== params.protocolVersion) log(`protocol version ${params.protocolVersion} is not supported; answering ${version}`);
  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, title: "Synergy Studio", version: SERVER_VERSION },
    instructions: INSTRUCTIONS,
  };
}

async function callTool(params, signal) {
  if (!isObject(params) || typeof params.name !== "string") throw rpcError("tools/call needs params with a tool name.", -32602);
  if (params.arguments !== undefined && !isObject(params.arguments)) throw rpcError("arguments must be an object.", -32602);
  const tool = toolByName.get(params.name);
  if (!tool) throw rpcError(`Unknown tool: ${params.name}`, -32602);
  const args = params.arguments ?? {};
  const problem = validateArguments(args, inputSchema(tool));
  if (problem) return { content: [{ type: "text", text: `${problem} Call ${tool.name} again with corrected inputs.` }], isError: true };
  try {
    if (tool.needsHome && !tryEnv()) return { content: [{ type: "text", text: notSetUpText() }], isError: true };
    return await tool.handler(args, { signal });
  } catch (error) {
    if (error instanceof UserError) return { content: [{ type: "text", text: error.message }], isError: true };
    log(`tool ${tool.name} failed:`, error.stack ?? error.message);
    return { content: [{ type: "text", text: `Unexpected error in ${tool.name}: ${error.message}` }], isError: true };
  }
}

async function route(method, params, signal) {
  switch (method) {
    case "initialize":
      return initialize(params);
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolListing() };
    case "tools/call":
      return callTool(params, signal);
    case "resources/list":
      return { resources: listResources() };
    case "resources/read": {
      if (!isObject(params) || typeof params.uri !== "string") throw rpcError("resources/read needs a uri.", -32602);
      return { contents: [readResource(params.uri)] };
    }
    case "prompts/list":
      return { prompts: PROMPTS };
    case "prompts/get": {
      if (!isObject(params) || typeof params.name !== "string") throw rpcError("prompts/get needs a prompt name.", -32602);
      return getPrompt(params.name, params.arguments ?? {});
    }
    default:
      throw rpcError(`Method not found: ${method}`, -32601);
  }
}

function notification(method, params) {
  if (method === "notifications/cancelled") {
    const controller = inflight.get(params?.requestId);
    if (controller) {
      log(`request ${params.requestId} cancelled by the client${params.reason ? `: ${params.reason}` : ""}`);
      controller.abort();
    }
  } else if (method === "notifications/initialized") log("client finished initialize");
}

async function handleRequest(id, method, params) {
  const controller = new AbortController();
  inflight.set(id, controller);
  try {
    const result = await route(method, params, controller.signal);
    if (!controller.signal.aborted) reply(id, result);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error.rpcCode) replyError(id, error.rpcCode, error.message);
    else {
      log(`${method} failed:`, error.stack ?? error.message);
      replyError(id, -32603, `Internal error: ${error.message}`);
    }
  } finally {
    inflight.delete(id);
  }
}

function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    replyError(null, -32700, "Parse error: the line is not valid JSON.");
    return;
  }
  if (Array.isArray(message)) {
    replyError(null, -32600, "Invalid Request: JSON-RPC batches (arrays) are not supported. Send one message per line.");
    return;
  }
  if (!isObject(message) || (message.method !== undefined && typeof message.method !== "string")) {
    replyError(null, -32600, "Invalid Request: expected a JSON-RPC message object.");
    return;
  }
  if (message.method === undefined) return;
  if (!("id" in message)) {
    notification(message.method, message.params);
    return;
  }
  if (typeof message.id !== "string" && typeof message.id !== "number") {
    replyError(null, -32600, "Invalid Request: id must be a string or a number.");
    return;
  }
  const running = handleRequest(message.id, message.method, message.params);
  pending.add(running);
  running.finally(() => pending.delete(running));
}

const SHUTDOWN_GRACE_MS = 3000;

// stdin closed: give requests already running a moment to answer, then stop them and exit.
async function shutdown() {
  log("stdin closed; exiting");
  if (pending.size > 0) await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS))]);
  for (const controller of inflight.values()) controller.abort();
  process.stdout.write("", () => process.exit(0));
}

process.stdout.on("error", () => process.exit(0));
process.on("uncaughtException", (error) => log("uncaught exception:", error.stack ?? error.message));
process.on("unhandledRejection", (error) => log("unhandled rejection:", error?.stack ?? String(error)));

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (line.trim() !== "") handleLine(line);
  }
});
process.stdin.on("end", shutdown);

log(`${SERVER_NAME} started on node ${process.version}; ${tools.length} tools; tool home ${home()}; projects ${projectsRoot()}`);

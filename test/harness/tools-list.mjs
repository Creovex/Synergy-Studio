// writes the server's tools/list answer to the file given (for T0 --tools)
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const c = new Client({ name: "tools-list", version: "1.0.0" });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, "mcp", "server.mjs")], stderr: "ignore" }));
const r = await c.listTools(); fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 1)); console.log(`${r.tools.length} tools written to ${process.argv[2]}`); await c.close();

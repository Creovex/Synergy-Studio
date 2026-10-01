// T14: the MCP server over stdio, driven by the official SDK client.
// Part one runs against an EMPTY tool home (a temporary folder); part two against the installed tool home with a
// temporary projects home. Falsifier: the same tool list assertion fails for a server with one tool removed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "mcp", "server.mjs");
const SKILL = path.join(ROOT, "skills", "synergy-studio");
const FIXTURE = path.join(ROOT, "test", "fixtures", "mcp", "plain-hf");
const REAL_HOME = process.env.SYNERGY_STUDIO_HOME || path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite");
const { INSTRUCTIONS } = await import(path.join(ROOT, "mcp", "context.mjs"));

const EXPECTED_TOOLS = [
  "studio_audio", "studio_beats", "studio_brand_check", "studio_budget", "studio_check", "studio_compose", "studio_cues", "studio_cut", "studio_doctor",
  "studio_example", "studio_export", "studio_file_add", "studio_file_list", "studio_file_read", "studio_file_write", "studio_frames",
  "studio_guide", "studio_hyperframes", "studio_import_hyperframes", "studio_inspect", "studio_job_log", "studio_job_status",
  "studio_look_from", "studio_open", "studio_project_import", "studio_project_list", "studio_project_new",
  "studio_reference", "studio_reference_study", "studio_render", "studio_say", "studio_scenes", "studio_score", "studio_setup_start",
  "studio_silences", "studio_sounds", "studio_stills", "studio_synctest", "studio_transcribe", "studio_voice", "studio_words",
];

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `ss-mcp-${label}-`));
const textOf = (result) => result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

// The assertion the falsifier reuses.
export function assertToolList(names) {
  assert.deepEqual([...names].sort(), [...EXPECTED_TOOLS].sort(), "tools/list does not match the expected tool names");
}

async function connect(envExtra) {
  const started = Date.now();
  const client = new Client({ name: "t14", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, ...envExtra }, stderr: "pipe" });
  await client.connect(transport);
  return { client, connectMs: Date.now() - started };
}

// Raw newline delimited session: send lines, close stdin, return the parsed replies.
function rawSession(lines, envExtra) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...envExtra }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", () => resolve(out.split("\n").filter(Boolean).map((l) => JSON.parse(l))));
    child.stdin.end(`${lines.join("\n")}\n`);
  });
}

async function waitForJob(client, jobId, limitMs = 240000) {
  const end = Date.now() + limitMs;
  for (;;) {
    const result = await client.callTool({ name: "studio_job_status", arguments: { job_id: jobId, wait_sec: 20 } });
    const state = result.structuredContent?.state;
    if (state === "done" || state === "failed") return result;
    if (Date.now() > end) throw new Error(`job ${jobId} did not finish: ${textOf(result)}`);
  }
}

// Width, height and size of a JPEG from base64 data.
function jpegInfo(base64) {
  const buf = Buffer.from(base64, "base64");
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8, "not a JPEG");
  let i = 2;
  while (i < buf.length) {
    assert.equal(buf[i], 0xff);
    const marker = buf[i + 1];
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), bytes: buf.length };
    i += 2 + length;
  }
  throw new Error("no frame header in the JPEG");
}
const images = (result) => result.content.filter((c) => c.type === "image");

const jobId = (result) => {
  const id = result.structuredContent?.job_id ?? /"job_id":"([^"]+)"/.exec(textOf(result))?.[1];
  assert.ok(id, `no job_id in ${textOf(result)}`);
  return id;
};

describe("empty tool home", () => {
  const home = tmp("home");
  const projects = tmp("projects");
  let client;
  let connectMs;

  before(async () => {
    ({ client, connectMs } = await connect({ SYNERGY_STUDIO_HOME: home, SYNERGY_STUDIO_PROJECTS: projects }));
  });
  after(async () => {
    await client?.close();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projects, { recursive: true, force: true });
  });

  test("initialize answers in under one second with the instructions", () => {
    console.log(`initialize round trip incl. process start: ${connectMs} ms`);
    assert.ok(connectMs < 1000, `connect took ${connectMs} ms`);
    assert.equal(client.getInstructions(), INSTRUCTIONS);
    assert.match(INSTRUCTIONS, /Call studio_guide first/);
    assert.equal(client.getServerVersion().name, "synergy-studio");
  });

  test("every tool the instructions name exists", async () => {
    const { tools } = await client.listTools();
    for (const n of INSTRUCTIONS.match(/studio_[a-z_]+/g)) assert.ok(tools.some((t) => t.name === n), n);
  });

  test("lists every tool, with descriptions, schemas and annotations", async () => {
    const { tools } = await client.listTools();
    assertToolList(tools.map((t) => t.name));
    for (const t of tools) {
      assert.ok(t.description.length >= 80, `${t.name} description is ${t.description.length} characters`);
      assert.equal(t.inputSchema.type, "object", t.name);
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) assert.equal(typeof t.annotations?.[hint], "boolean", `${t.name} ${hint}`);
      assert.doesNotMatch(t.description, / [-–—] /, `${t.name} description uses a dash as punctuation`);
    }
  });

  test("lists every resource and prompt", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    assert.ok(uris.includes("synergy://skill"));
    for (const f of fs.readdirSync(path.join(SKILL, "references")).filter((n) => n.endsWith(".md"))) assert.ok(uris.includes(`synergy://references/${f.slice(0, -3)}`), f);
    for (const e of ["hydration-tips", "footage-captions", "three-product"]) {
      assert.ok(uris.includes(`synergy://examples/${e}/project.json`), e);
      assert.ok(uris.includes(`synergy://examples/${e}/index.html`), e);
    }
    const page = await client.readResource({ uri: "synergy://examples/hydration-tips/index.html" });
    assert.equal(page.contents[0].text, fs.readFileSync(path.join(SKILL, "examples", "hydration-tips", "src", "index.html"), "utf8"));
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((p) => p.name).sort(), ["improve-video", "new-video"]);
    const prompt = await client.getPrompt({ name: "improve-video", arguments: { video_path: "/tmp/a.mp4", goal: "add captions" } });
    assert.match(prompt.messages[0].content.text, /studio_guide/);
    await assert.rejects(client.getPrompt({ name: "new-video", arguments: {} }), /idea/);
    const made = await client.getPrompt({ name: "new-video", arguments: { idea: "water before coffee" } });
    assert.equal(made.messages[0].content.text, "Use Synergy Studio to make a video. Call studio_guide first and follow it. The idea: water before coffee");
  });

  test("every listed prompt has a template with each of its arguments (the bundle manifest declares these)", async () => {
    const { PROMPTS, PROMPT_TEXT } = await import(path.join(ROOT, "mcp", "content.mjs"));
    const { prompts } = await client.listPrompts();
    for (const p of prompts) {
      assert.equal(typeof PROMPT_TEXT[p.name], "string", p.name);
      for (const a of p.arguments) assert.ok(PROMPT_TEXT[p.name].includes(`\${arguments.${a.name}}`), `${p.name}: ${a.name}`);
    }
    assert.deepEqual(Object.keys(PROMPT_TEXT).sort(), PROMPTS.map((p) => p.name).sort());
  });

  test("studio_guide equals SKILL.md with the skill folder resolved", async () => {
    const expected = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8").replace(/<this skill folder>|<skill folder>|<skill>/g, SKILL);
    const guide = await client.callTool({ name: "studio_guide", arguments: {} });
    assert.equal(guide.content[0].text, expected);
    assert.match(guide.content[1].text, /studio_setup_start/);
    for (const f of fs.readdirSync(path.join(SKILL, "references")).filter((n) => n.endsWith(".md"))) assert.ok(guide.content[1].text.includes(f.slice(0, -3)), f);
    const resource = await client.readResource({ uri: "synergy://skill" });
    assert.equal(resource.contents[0].text, expected);
    const ref = await client.callTool({ name: "studio_reference", arguments: { name: "review" } });
    assert.match(textOf(ref), /\S/);
  });

  test("studio_example reads only examples and templates", async () => {
    const ok = await client.callTool({ name: "studio_example", arguments: { path: "template/sketch.js" } });
    assert.equal(textOf(ok), fs.readFileSync(path.join(SKILL, "template", "sketch.js"), "utf8"));
    const page = await client.callTool({ name: "studio_example", arguments: { path: "examples/three-product/src/index.html" } });
    assert.notEqual(page.isError, true);
    for (const p of ["SKILL.md", "../SKILL.md", "examples/../SKILL.md", "scripts/studio.mjs", "/etc/hosts", "examples", "template/none.js"]) {
      const r = await client.callTool({ name: "studio_example", arguments: { path: p } });
      assert.equal(r.isError, true, p);
      assert.match(textOf(r), /template\/sketch\.js/, `${p} lists the available files`);
    }
  });

  test("before setup: doctor says not set up, other tools say so plainly", async () => {
    const doctor = await client.callTool({ name: "studio_doctor", arguments: {} });
    assert.match(textOf(doctor), /not set up/i);
    assert.match(textOf(doctor), /studio_setup_start/);
    const render = await client.callTool({ name: "studio_render", arguments: { name: "nothing" } });
    assert.equal(render.isError, true);
    assert.match(textOf(render), /not set up/i);
  });

  test("project names and file paths are checked", async () => {
    const bad = await client.callTool({ name: "studio_project_new", arguments: { name: "Bad Name" } });
    assert.equal(bad.isError, true);
    const long = await client.callTool({ name: "studio_project_new", arguments: { name: "a".repeat(41) } });
    assert.equal(long.isError, true);
    const made = await client.callTool({ name: "studio_project_new", arguments: { name: "paths-check", aspect: "9:16", length: 15 } });
    assert.notEqual(made.isError, true, textOf(made));
    assert.ok(fs.existsSync(path.join(projects, "paths-check", "project.json")));
    assert.match(textOf(made), /Project folder/);

    for (const p of ["../outside.txt", "src/../../outside.txt", "/etc/hosts", "..", "src/../.."]) {
      const read = await client.callTool({ name: "studio_file_read", arguments: { name: "paths-check", path: p } });
      assert.equal(read.isError, true, `read ${p}`);
      assert.match(textOf(read), /outside|Give a path/, p);
      const write = await client.callTool({ name: "studio_file_write", arguments: { name: "paths-check", path: p, content: "x" } });
      assert.equal(write.isError, true, `write ${p}`);
    }
    assert.equal(fs.existsSync(path.join(projects, "outside.txt")), false);

    const notAllowed = await client.callTool({ name: "studio_file_write", arguments: { name: "paths-check", path: "comp/index.html", content: "x" } });
    assert.equal(notAllowed.isError, true);
    assert.match(textOf(notAllowed), /not allowed/);

    const outside = tmp("outside");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, path.join(projects, "paths-check", "src", "link"));
    const viaLink = await client.callTool({ name: "studio_file_read", arguments: { name: "paths-check", path: "src/link/secret.txt" } });
    assert.equal(viaLink.isError, true);
    assert.match(textOf(viaLink), /symbolic link/);
    const writeLink = await client.callTool({ name: "studio_file_write", arguments: { name: "paths-check", path: "src/link/new.txt", content: "x" } });
    assert.equal(writeLink.isError, true);
    assert.equal(fs.existsSync(path.join(outside, "new.txt")), false);
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(path.join(projects, "paths-check", "src", "link"));

    const ok = await client.callTool({ name: "studio_file_write", arguments: { name: "paths-check", path: "src/notes/a.txt", content: "one\ntwo\nthree\n" } });
    assert.notEqual(ok.isError, true, textOf(ok));
    assert.match(textOf(ok), /Wrote 14 bytes/);
    assert.match(textOf(ok), /first line: one/);
    assert.match(textOf(ok), /last line: three/);
    const back = await client.callTool({ name: "studio_file_read", arguments: { name: "paths-check", path: "src/notes/a.txt" } });
    assert.equal(textOf(back), "one\ntwo\nthree\n");
    const list = await client.callTool({ name: "studio_file_list", arguments: { name: "paths-check" } });
    assert.match(textOf(list), /src\/notes\/a\.txt {2}14 bytes/);
  });

  test("job records: done, stale runner, waiting, bad ids, and cancelling a wait", async () => {
    fs.mkdirSync(path.join(home, "jobs"), { recursive: true });
    const now = new Date().toISOString();
    const write = (id, patch, log = "") => {
      fs.writeFileSync(path.join(home, "jobs", `${id}.json`), JSON.stringify({ id, label: "fake", kind: "studio", state: "done", created: now, started: now, ended: now, exit_code: 0, result: null, attach: { files: [], globs: [] }, runner_pid: null, ...patch }));
      fs.writeFileSync(path.join(home, "jobs", `${id}.log`), log);
    };
    write("aaaa-done", { result: { text: "hello from the job", json: null } }, "line one\nline two\n");
    write("bbbb-dead", { state: "running", ended: null, exit_code: null, runner_pid: 999999 }, "half way\n");
    write("cccc-live", { state: "running", ended: null, exit_code: null, runner_pid: process.pid }, "Waiting for render, process 1 to finish\n");

    const done = await client.callTool({ name: "studio_job_status", arguments: { job_id: "aaaa-done", wait_sec: 0 } });
    assert.equal(done.structuredContent.state, "done");
    assert.match(textOf(done), /hello from the job/);
    const dead = await client.callTool({ name: "studio_job_status", arguments: { job_id: "bbbb-dead", wait_sec: 0 } });
    assert.equal(dead.structuredContent.state, "failed");
    assert.match(textOf(dead), /ended before it recorded a result/);
    const live = await client.callTool({ name: "studio_job_status", arguments: { job_id: "cccc-live", wait_sec: 0 } });
    assert.equal(live.structuredContent.state, "running");
    assert.match(textOf(live), /queued, waiting for the heavy lock/);
    const log = await client.callTool({ name: "studio_job_log", arguments: { job_id: "aaaa-done", lines: 1 } });
    assert.equal(textOf(log), "line two");
    for (const bad of ["../aaaa-done", "nothing-here"]) {
      const r = await client.callTool({ name: "studio_job_status", arguments: { job_id: bad, wait_sec: 0 } });
      assert.equal(r.isError, true, bad);
    }
    const tooLong = await client.callTool({ name: "studio_job_status", arguments: { job_id: "aaaa-done", wait_sec: 60 } });
    assert.equal(tooLong.isError, true);

    const started = Date.now();
    const replies = await rawSession(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "studio_job_status", arguments: { job_id: "cccc-live", wait_sec: 25 } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2, reason: "test" } }),
      ],
      { SYNERGY_STUDIO_HOME: home, SYNERGY_STUDIO_PROJECTS: projects },
    );
    assert.ok(Date.now() - started < 6000, "the cancelled wait ended quickly");
    assert.ok(replies.some((r) => r.id === 3), "ping answered");
    assert.equal(replies.some((r) => r.id === 2), false, "no reply for the cancelled request");
  });

  test("protocol edge cases", async () => {
    const env = { SYNERGY_STUDIO_HOME: home, SYNERGY_STUDIO_PROJECTS: projects };
    const init = (id, version) => JSON.stringify({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "raw", version: "0" } } });
    const replies = await rawSession(
      [
        init(1, "2025-06-18"),
        init(2, "2024-11-05"),
        init(3, "1999-01-01"),
        JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" }),
        JSON.stringify({ jsonrpc: "2.0", id: 5, method: "no/such" }),
        JSON.stringify([{ jsonrpc: "2.0", id: 6, method: "ping" }]),
        JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "studio_nothing", arguments: {} } }),
        JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "studio_open", arguments: { name: "paths-check", extra: 1 } } }),
        "not json",
      ],
      env,
    );
    const byId = new Map(replies.map((r) => [r.id, r]));
    assert.equal(byId.get(1).result.protocolVersion, "2025-06-18");
    assert.equal(byId.get(2).result.protocolVersion, "2024-11-05");
    assert.equal(byId.get(3).result.protocolVersion, "2025-11-25");
    assert.deepEqual(byId.get(4).result, {});
    assert.equal(byId.get(5).error.code, -32601);
    assert.equal(byId.get(7).error.code, -32602);
    assert.equal(byId.get(8).error.code, -32602);
    assert.equal(byId.get(9).result.isError, true);
    const nulls = replies.filter((r) => r.id === null).map((r) => r.error.code).sort();
    assert.deepEqual(nulls, [-32700, -32600].sort());
    const log = fs.readFileSync(path.join(home, "server.log"), "utf8");
    assert.match(log, /requested protocol version 1999-01-01/);
  });
});

describe("falsifier: a server with one tool removed", () => {
  test("the tool list assertion fails", async () => {
    const { client } = await connect({ SYNERGY_STUDIO_HOME: tmp("falsifier"), SYNERGY_STUDIO_PROJECTS: tmp("falsifier-p"), SYNERGY_STUDIO_TEST_DROP_TOOL: "studio_frames" });
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, EXPECTED_TOOLS.length - 1);
      assert.throws(() => assertToolList(tools.map((t) => t.name)), /tools\/list does not match/);
    } finally {
      await client.close();
    }
  });
});

const installed = fs.existsSync(path.join(REAL_HOME, "env.json"));
describe("installed tool home, temporary projects home", { skip: installed ? false : "no installed tool home (env.json missing)" }, () => {
  const projects = tmp("real-projects");
  const scratch = tmp("scratch");
  let client;

  before(async () => {
    ({ client } = await connect({ SYNERGY_STUDIO_PROJECTS: projects }));
  });
  after(async () => {
    await client?.close();
    // job records this run left in the installed tool home
    const jobs = path.join(REAL_HOME, "jobs");
    for (const file of fs.existsSync(jobs) ? fs.readdirSync(jobs).filter((f) => f.endsWith(".json")) : []) {
      try {
        if (JSON.parse(fs.readFileSync(path.join(jobs, file), "utf8")).project?.startsWith(projects)) {
          fs.rmSync(path.join(jobs, file), { force: true });
          fs.rmSync(path.join(jobs, file.replace(/\.json$/, ".log")), { force: true });
        }
      } catch {
        // not a job file of this run
      }
    }
    fs.rmSync(projects, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test("studio_import_hyperframes refuses folders that are not HyperFrames projects", async () => {
    const empty = path.join(scratch, "no-index");
    fs.mkdirSync(empty);
    const noIndex = await client.callTool({ name: "studio_import_hyperframes", arguments: { folder: empty, name: "refused-one" } });
    assert.equal(noIndex.isError, true);
    assert.match(textOf(noIndex), /no index\.html/);
    const plain = path.join(scratch, "plain-page");
    fs.mkdirSync(plain);
    fs.writeFileSync(path.join(plain, "index.html"), "<html><body><h1>not a composition</h1></body></html>");
    const noRoot = await client.callTool({ name: "studio_import_hyperframes", arguments: { folder: plain, name: "refused-two" } });
    assert.equal(noRoot.isError, true);
    assert.match(textOf(noRoot), /no HyperFrames root composition/);
    assert.equal(fs.existsSync(path.join(projects, "refused-one")), false);
    assert.equal(fs.existsSync(path.join(projects, "refused-two")), false);
  });

  test("import, refusals, lint, render job and check", { timeout: 420000 }, async () => {
    const imported = await client.callTool({ name: "studio_import_hyperframes", arguments: { folder: FIXTURE, name: "plain-hf" } });
    assert.notEqual(imported.isError, true, textOf(imported));
    const project = JSON.parse(fs.readFileSync(path.join(projects, "plain-hf", "project.json"), "utf8"));
    assert.deepEqual(project, { kind: "hyperframes", name: "plain-hf", mix: "mix.wav" });
    const again = await client.callTool({ name: "studio_import_hyperframes", arguments: { folder: FIXTURE, name: "plain-hf" } });
    assert.equal(again.isError, true);

    for (const command of ["publish", "cloud", "lambda", "cloudrun", "auth", "upgrade", "feedback", "add", "catalog", "preview", "init", "docs"]) {
      const refused = await client.callTool({ name: "studio_hyperframes", arguments: { name: "plain-hf", command, args: [] } });
      assert.equal(refused.isError, true, command);
      assert.match(textOf(refused), /refused|not on the allowed list/, command);
    }
    for (const args of [["-o", "../../escape.mp4"], ["--output", path.join(os.tmpdir(), "escape.mp4")], ["-o=/tmp/escape.mp4"], ["--dir", ".."], ["--variables-file", "../x.json"]]) {
      const refused = await client.callTool({ name: "studio_hyperframes", arguments: { name: "plain-hf", command: "render", args } });
      assert.equal(refused.isError, true, args.join(" "));
      assert.match(textOf(refused), /leaves the project folder/, args.join(" "));
    }
    assert.equal(fs.existsSync(path.join(projects, "..", "escape.mp4")), false);

    const lint = await client.callTool({ name: "studio_hyperframes", arguments: { name: "plain-hf", command: "lint", args: [] } });
    assert.notEqual(lint.isError, true, textOf(lint));
    const lintJson = JSON.parse(textOf(lint));
    assert.equal(lintJson.ok, true);
    assert.equal(lintJson.errorCount, 0);

    const start = await client.callTool({ name: "studio_hyperframes", arguments: { name: "plain-hf", command: "render", args: ["-o", "out/plain-hf.mp4"] } });
    const render = await waitForJob(client, jobId(start));
    assert.equal(render.structuredContent.state, "done", textOf(render));
    assert.ok(fs.existsSync(path.join(projects, "plain-hf", "out", "plain-hf.mp4")));
    const opened = await client.callTool({ name: "studio_open", arguments: { name: "plain-hf" } });
    assert.match(textOf(opened), /plain-hf\.mp4/);
    assert.match(textOf(opened), /file:\/\//);
    assert.doesNotMatch(textOf(opened), /share copy/);
    fs.copyFileSync(path.join(projects, "plain-hf", "out", "plain-hf.mp4"), path.join(projects, "plain-hf", "out", "plain-hf-share.mp4"));
    const withShare = textOf(await client.callTool({ name: "studio_open", arguments: { name: "plain-hf" } }));
    assert.match(withShare, /Full render: .*plain-hf\.mp4\n/);
    assert.match(withShare, /Smaller share copy: .*plain-hf-share\.mp4/);
    const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-save-"));
    const saved1 = textOf(await client.callTool({ name: "studio_open", arguments: { name: "plain-hf", save_to: saveDir } }));
    const saved2 = textOf(await client.callTool({ name: "studio_open", arguments: { name: "plain-hf", save_to: saveDir } }));
    assert.match(saved1, /Saved a copy: .*plain-hf\.mp4/);
    assert.match(saved2, /Saved a copy: .*plain-hf-2\.mp4/);
    assert.equal(fs.statSync(path.join(saveDir, "plain-hf.mp4")).size, fs.statSync(path.join(projects, "plain-hf", "out", "plain-hf.mp4")).size);
    const noFolder = await client.callTool({ name: "studio_open", arguments: { name: "plain-hf", save_to: path.join(saveDir, "missing") } });
    assert.equal(noFolder.isError, true);
    assert.match(textOf(noFolder), /does not exist/);
    fs.rmSync(saveDir, { recursive: true, force: true });

    const check = await waitForJob(client, jobId(await client.callTool({ name: "studio_check", arguments: { name: "plain-hf" } })));
    console.log(textOf(check));
    assert.equal(check.structuredContent.state, "done", textOf(check));
    assert.doesNotMatch(textOf(check), /FAIL/);
    assert.match(textOf(check), /PASS {2}audio against mix/);
    assert.ok(check.content.some((c) => c.type === "image" && c.mimeType === "image/jpeg"), "the final sheet comes back as an image");
    const state = JSON.parse(fs.readFileSync(path.join(REAL_HOME, "jobs", `${jobId(start)}.json`), "utf8"));
    assert.equal(state.state, "done");
    assert.equal(state.exit_code, 0);
  });

  test("images are JPEG, at most 1600 px wide and 1 MB", async () => {
    const frames = await client.callTool({ name: "studio_frames", arguments: { video_path: path.join(projects, "plain-hf", "out", "plain-hf.mp4"), n: 12 } });
    assert.notEqual(frames.isError, true, textOf(frames));
    assert.equal(images(frames).length, 1);
    const info = jpegInfo(images(frames)[0].data);
    console.log(`studio_frames image: ${info.width}x${info.height}, ${info.bytes} bytes`);
    assert.ok(info.width <= 1600 && info.bytes <= 1024 * 1024);
    const missing = await client.callTool({ name: "studio_frames", arguments: { video_path: path.join(scratch, "no-such.mp4") } });
    assert.equal(missing.isError, true);
    const big = path.join(scratch, "big.png");
    const ffmpeg = JSON.parse(fs.readFileSync(path.join(REAL_HOME, "env.json"), "utf8")).ffmpeg;
    await new Promise((resolve, reject) => spawn(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=3200x1800:rate=1", "-frames:v", "1", big]).on("close", (c) => (c === 0 ? resolve() : reject(new Error("ffmpeg")))));
    const made = await client.callTool({ name: "studio_project_new", arguments: { name: "pic-check" } });
    assert.notEqual(made.isError, true, textOf(made));
    const added = await client.callTool({ name: "studio_file_add", arguments: { name: "pic-check", from_path: big } });
    assert.notEqual(added.isError, true, textOf(added));
    assert.ok(fs.existsSync(path.join(projects, "pic-check", "src", "assets", "big.png")));
    const read = await client.callTool({ name: "studio_file_read", arguments: { name: "pic-check", path: "src/assets/big.png" } });
    const shown = jpegInfo(images(read)[0].data);
    assert.ok(shown.width <= 1600 && shown.bytes <= 1024 * 1024, JSON.stringify(shown));
    const say = await client.callTool({ name: "studio_say", arguments: { name: "pic-check", text: "Synergy Studio" } });
    assert.notEqual(say.isError, true, textOf(say));
    assert.ok(fs.existsSync(path.join(projects, "pic-check", "audio", "say.wav")));
    assert.match(textOf(say), /say\.wav/);
    assert.match(textOf(say), /file:\/\/.*say\.wav/);
    assert.ok(textOf(say).includes(path.join(projects, "pic-check", "audio", "say.wav")));
  });

  test("footage tools: import, reference study, silences, scenes, look card", { timeout: 300000 }, async () => {
    const video = path.join(projects, "plain-hf", "out", "plain-hf.mp4");
    const imported = await client.callTool({ name: "studio_project_import", arguments: { name: "footage-check", video_path: video } });
    assert.notEqual(imported.isError, true, textOf(imported));
    assert.equal(images(imported).length, 1, "the source sheet comes back as an image");
    assert.ok(fs.existsSync(path.join(projects, "footage-check", "src", "footage", "plain-hf.mp4")));
    const study = await client.callTool({ name: "studio_reference_study", arguments: { name: "footage-check", video_path: video, every: 1 } });
    assert.notEqual(study.isError, true, textOf(study));
    assert.equal(images(study).length, 1);
    const silences = await client.callTool({ name: "studio_silences", arguments: { name: "footage-check", clip: "src/footage/plain-hf.mp4", db: -32, min: 0.4 } });
    assert.notEqual(silences.isError, true, textOf(silences));
    const scenes = await client.callTool({ name: "studio_scenes", arguments: { name: "footage-check", clip: "src/footage/plain-hf.mp4", threshold: 0.3 } });
    assert.notEqual(scenes.isError, true, textOf(scenes));
    const outside = await client.callTool({ name: "studio_scenes", arguments: { name: "footage-check", clip: "../plain-hf/out/plain-hf.mp4" } });
    assert.equal(outside.isError, true);
    const both = await client.callTool({ name: "studio_look_from", arguments: { name: "footage-check", files: [video], card: "paper" } });
    assert.equal(both.isError, true);
    const look = await waitForJob(client, jobId(await client.callTool({ name: "studio_look_from", arguments: { name: "footage-check", files: [video] } })));
    assert.equal(look.structuredContent.state, "done", textOf(look));
    assert.equal(images(look).length, 1, "the look card comes back as an image");
    const card = await waitForJob(client, jobId(await client.callTool({ name: "studio_look_from", arguments: { name: "footage-check", card: "midnight" } })));
    assert.equal(card.structuredContent.state, "done", textOf(card));
    assert.equal(images(card).length, 1);
  });

  test("a job outlives the server that started it", { timeout: 120000 }, async () => {
    const other = await connect({ SYNERGY_STUDIO_PROJECTS: projects });
    const start = await other.client.callTool({ name: "studio_hyperframes", arguments: { name: "plain-hf", command: "render", args: ["-o", "out/second.mp4"] } });
    const id = jobId(start);
    await other.client.close();
    const { client: later } = await connect({ SYNERGY_STUDIO_PROJECTS: projects });
    try {
      const finished = await waitForJob(later, id);
      assert.equal(finished.structuredContent.state, "done", textOf(finished));
      assert.ok(fs.existsSync(path.join(projects, "plain-hf", "out", "second.mp4")));
    } finally {
      await later.close();
    }
  });

  test("studio_export copies only the five allowed items", async () => {
    const made = await client.callTool({ name: "studio_project_new", arguments: { name: "export-me", look: "midnight" } });
    assert.notEqual(made.isError, true, textOf(made));
    const dir = path.join(projects, "export-me");
    for (const d of ["comp", "stills", "audio", "out", "history/20260101", "src/footage"]) {
      fs.mkdirSync(path.join(dir, d), { recursive: true });
      fs.writeFileSync(path.join(dir, d, "keep-out.txt"), "x");
    }
    fs.writeFileSync(path.join(dir, "durations.json"), "{}");
    fs.writeFileSync(path.join(dir, "src", "assets", "logo.txt"), "logo");
    fs.symlinkSync(os.tmpdir(), path.join(dir, "src", "assets", "link"));
    const dest = path.join(scratch, "exported");
    const ok = await client.callTool({ name: "studio_export", arguments: { name: "export-me", dest } });
    assert.notEqual(ok.isError, true, textOf(ok));
    const top = fs.readdirSync(dest).sort();
    assert.deepEqual(top, ["brief.md", "feedback.md", "project.json", "shots.md", "src"]);
    assert.deepEqual(fs.readdirSync(path.join(dest, "src")).sort(), ["assets", "index.html"]);
    assert.deepEqual(fs.readdirSync(path.join(dest, "src", "assets")), ["logo.txt"]);

    const refused = await client.callTool({ name: "studio_export", arguments: { name: "export-me", dest } });
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), /not empty/);
    const over = await client.callTool({ name: "studio_export", arguments: { name: "export-me", dest, overwrite: true } });
    assert.notEqual(over.isError, true, textOf(over));

    const real = path.join(scratch, "real-target");
    fs.mkdirSync(real);
    const linked = path.join(scratch, "linked-dest");
    fs.symlinkSync(real, linked);
    const viaLink = await client.callTool({ name: "studio_export", arguments: { name: "export-me", dest: linked, overwrite: true } });
    assert.equal(viaLink.isError, true);
    assert.deepEqual(fs.readdirSync(real), []);
    const inside = await client.callTool({ name: "studio_export", arguments: { name: "export-me", dest: path.join(dir, "src", "again") } });
    assert.equal(inside.isError, true);
  });
});

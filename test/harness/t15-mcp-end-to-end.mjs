// T15: a script (not Claude) rebuilds examples/hydration-tips through MCP calls only, in the default homes
// (the installed tool home and ~/Movies/Synergy Studio unless the environment names others).
// Steps: project_new, file writes of project.json and src/index.html (content from the example), voice job,
// audio, stills job (an image comes back), render job, check job. `check` must PASS.
// Usage: node test/harness/t15-mcp-end-to-end.mjs [project-name]      Leaves the project in the projects home.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { projectsHome } from "../../skills/synergy-studio/scripts/lib/paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXAMPLE = path.join(ROOT, "skills", "synergy-studio", "examples", "hydration-tips");
const NAME = process.argv[2] ?? "t15-hydration-tips";
const calls = [];

const client = new Client({ name: "t15", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "mcp", "server.mjs")], env: { ...process.env }, stderr: "inherit" }));

const textOf = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const short = (s, n = 110) => (s.length > n ? `${s.slice(0, n).replace(/\n/g, " ")}...` : s.replace(/\n/g, " "));

async function call(name, args = {}) {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const images = result.content.filter((c) => c.type === "image");
  const line = `${String(calls.length + 1).padStart(2)}. ${name} ${short(JSON.stringify(args), 90)} -> ${result.isError ? "ERROR" : "ok"}, ${Date.now() - started} ms, ${images.length} image(s): ${short(textOf(result))}`;
  calls.push(line);
  console.log(line);
  return result;
}

async function job(name, args) {
  const started = await call(name, args);
  if (started.isError) throw new Error(`${name} failed to start: ${textOf(started)}`);
  const id = started.structuredContent.job_id;
  for (;;) {
    const status = await call("studio_job_status", { job_id: id, wait_sec: 25 });
    if (["done", "failed"].includes(status.structuredContent.state)) return status;
  }
}

function must(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
}

try {
  const template = JSON.parse(fs.readFileSync(path.join(EXAMPLE, "project.json"), "utf8"));
  const guide = await call("studio_guide");
  must(textOf(guide).includes("Synergy Studio"), "studio_guide returned the guide");
  const doctor = await call("studio_doctor");
  must(!/not set up/i.test(textOf(doctor)), "the tool home is set up");

  const made = await call("studio_project_new", { name: NAME, aspect: template.aspect, platform: template.platform, look: "midnight", mode: "narrated" });
  must(!made.isError, `project_new: ${textOf(made)}`);

  const project = await call("studio_file_write", { name: NAME, path: "project.json", content: `${JSON.stringify({ ...template, name: NAME }, null, 2)}\n` });
  must(!project.isError, `writing project.json: ${textOf(project)}`);
  const page = await call("studio_file_write", { name: NAME, path: "src/index.html", content: fs.readFileSync(path.join(EXAMPLE, "src", "index.html"), "utf8") });
  must(!page.isError, `writing src/index.html: ${textOf(page)}`);

  const budget = await call("studio_budget", { name: NAME });
  must(!budget.isError, `budget: ${textOf(budget)}`);
  const voice = await job("studio_voice", { name: NAME });
  must(voice.structuredContent.state === "done", `voice job: ${textOf(voice)}`);
  const audio = await call("studio_audio", { name: NAME });
  must(!audio.isError, `audio: ${textOf(audio)}`);
  const words = await call("studio_words", { name: NAME });
  must(!words.isError, `words: ${textOf(words)}`);
  const audioAgain = await call("studio_audio", { name: NAME });
  must(!audioAgain.isError, `audio (second pass): ${textOf(audioAgain)}`);

  const stills = await job("studio_stills", { name: NAME });
  must(stills.structuredContent.state === "done", `stills job: ${textOf(stills)}`);
  must(stills.content.some((c) => c.type === "image" && c.mimeType === "image/jpeg"), "the stills job returned an image");
  const sheet = await call("studio_file_read", { name: NAME, path: "stills/sheet.jpg" });
  must(sheet.content.some((c) => c.type === "image"), "studio_file_read returns stills/sheet.jpg as an image");

  const render = await job("studio_render", { name: NAME });
  must(render.structuredContent.state === "done", `render job: ${textOf(render)}`);
  const opened = await call("studio_open", { name: NAME });
  must(!opened.isError, `open: ${textOf(opened)}`);

  const check = await job("studio_check", { name: NAME });
  const lines = textOf(check).split("\n").filter((l) => /^(PASS|FAIL) /.test(l));
  console.log("\ncheck lines:\n" + lines.join("\n"));
  must(check.structuredContent.state === "done" && lines.length > 0 && lines.every((l) => l.startsWith("PASS")), "check: every line PASS");
  must(check.content.some((c) => c.type === "image"), "the check job returned the final sheet as an image");
  const listed = await call("studio_project_list");
  must(textOf(listed).includes(NAME) && /mp4: yes/.test(textOf(listed)), "the project list shows the project with an MP4");

  console.log(`\nT15 PASS: ${calls.length} MCP calls; project left at ${path.join(projectsHome(), NAME)}`);
} catch (error) {
  console.error(`\nT15 FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

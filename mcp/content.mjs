// What the server carries from the skill folder: the guide (SKILL.md), the references, the examples, and the
// prompts. Everything is read from disk on demand, so nothing here slows down initialize.
import fs from "node:fs";
import path from "node:path";
import { SKILL_DIR, UserError } from "./context.mjs";

const REF_DIR = path.join(SKILL_DIR, "references");
const EXAMPLES_DIR = path.join(SKILL_DIR, "examples");
const FOLDER_WORDS = /<this skill folder>|<skill folder>|<skill>/g;

// SKILL.md with the skill folder written out as an absolute path wherever the text says <skill>,
// <skill folder> or <this skill folder>.
export function resolvedSkill() {
  return fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8").replace(FOLDER_WORDS, SKILL_DIR);
}

export function referenceNames() {
  try {
    return fs.readdirSync(REF_DIR).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
  } catch {
    return [];
  }
}

export function readReference(name) {
  const clean = String(name ?? "").replace(/\.md$/, "");
  if (!referenceNames().includes(clean)) {
    throw new UserError(`There is no reference named ${JSON.stringify(name)}. Available: ${referenceNames().join(", ")}.`);
  }
  return fs.readFileSync(path.join(REF_DIR, `${clean}.md`), "utf8").replace(FOLDER_WORDS, SKILL_DIR);
}

export function exampleNames() {
  try {
    return fs
      .readdirSync(EXAMPLES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(EXAMPLES_DIR, e.name, "project.json")))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// The second block of studio_guide: how the skill's `studio <command>` words map to tools here.
export function guideAppendix() {
  return [
    "How this guide maps to the tools of this server",
    "",
    "Wherever the guide says `studio <command>`, call the tool of the same name instead of running a command line:",
    "studio setup = studio_setup_start; studio doctor = studio_doctor; studio new = studio_project_new; studio import = studio_project_import;",
    "studio reference = studio_reference_study; studio frames = studio_frames; studio look = studio_look_from; every other command has the tool studio_<command>",
    "(budget, say, voice, audio, words, compose, stills, render, check, cut, transcribe, silences, scenes, beats, synctest). Every option of a command is an input of its tool with the same name.",
    "The project folder is always given as `name` (lower case letters, digits and hyphens, at most 40 characters); the files inside it are read and written with studio_file_list, studio_file_read, studio_file_write and studio_file_add.",
    "Long work (setup, voice, transcribe, look, stills, render, check, synctest) returns a job_id: call studio_job_status with wait_sec 25 until it is done. Pictures (contact sheets, stills, look cards) come back as images in the result: look at them.",
    "Plain HyperFrames folders: studio_import_hyperframes, then studio_hyperframes (lint, render, snapshot and the other allowed commands), then studio_check.",
    "Limits in Claude Desktop: there is no web access, so fonts beyond the bundled Manrope, Inter, Cormorant Garamond and Jost come only from files the user gives (studio_file_add); a video attached in the chat has no file path, so ask the user to type the path of the file on the Mac.",
    "",
    `References (read one with studio_reference name): ${referenceNames().join(", ")}.`,
    `Examples (resources synergy://examples/<name>/project.json and index.html): ${exampleNames().join(", ")}.`,
  ].join("\n");
}

// ---------------------------------------------------------------- resources
export function listResources() {
  const items = [{ uri: "synergy://skill", name: "skill", title: "Synergy Studio guide", description: "SKILL.md: how to make and improve videos with these tools.", mimeType: "text/markdown" }];
  for (const name of referenceNames()) {
    items.push({ uri: `synergy://references/${name}`, name: `reference-${name}`, title: `Reference: ${name}`, description: `The ${name} reference of the skill.`, mimeType: "text/markdown" });
  }
  for (const name of exampleNames()) {
    items.push({ uri: `synergy://examples/${name}/project.json`, name: `example-${name}-project`, title: `Example ${name}: project.json`, description: `project.json of the ${name} example.`, mimeType: "application/json" });
    if (fs.existsSync(path.join(EXAMPLES_DIR, name, "src", "index.html"))) {
      items.push({ uri: `synergy://examples/${name}/index.html`, name: `example-${name}-page`, title: `Example ${name}: index.html`, description: `The page (src/index.html) of the ${name} example.`, mimeType: "text/html" });
    }
  }
  return items;
}

const rpcError = (message, rpcCode) => Object.assign(new Error(message), { rpcCode });

export function readResource(uri) {
  if (typeof uri !== "string") throw rpcError("uri must be a string", -32602);
  const notFound = () => rpcError(`Resource not found: ${uri}`, -32002);
  if (uri === "synergy://skill") return { uri, mimeType: "text/markdown", text: resolvedSkill() };
  let m = /^synergy:\/\/references\/([a-z0-9-]+)$/.exec(uri);
  if (m) {
    if (!referenceNames().includes(m[1])) throw notFound();
    return { uri, mimeType: "text/markdown", text: readReference(m[1]) };
  }
  m = /^synergy:\/\/examples\/([a-z0-9-]+)\/(project\.json|index\.html)$/.exec(uri);
  if (m && exampleNames().includes(m[1])) {
    const isJson = m[2] === "project.json";
    const file = isJson ? path.join(EXAMPLES_DIR, m[1], "project.json") : path.join(EXAMPLES_DIR, m[1], "src", "index.html");
    if (!fs.existsSync(file)) throw notFound();
    return { uri, mimeType: isJson ? "application/json" : "text/html", text: fs.readFileSync(file, "utf8") };
  }
  throw notFound();
}

// ---------------------------------------------------------------- prompts
export const PROMPTS = [
  {
    name: "new-video",
    title: "Make a new video",
    description: "Start a new video from an idea: read the guide, plan it, build it, check it.",
    arguments: [{ name: "idea", description: "What the video is about, who it is for, and any length or platform.", required: true }],
  },
  {
    name: "improve-video",
    title: "Improve an existing video",
    description: "Improve a video file on this computer: captions, cuts, an end card, a new look.",
    arguments: [
      { name: "video_path", description: "The full path of the video file on this computer.", required: true },
      { name: "goal", description: "What to change or add.", required: true },
    ],
  },
];

export function getPrompt(name, args = {}) {
  const need = (key) => {
    const value = args?.[key];
    if (typeof value !== "string" || value.trim() === "") throw rpcError(`The prompt ${name} needs the argument ${key}.`, -32602);
    return value.trim();
  };
  let text;
  if (name === "new-video") {
    text = `Use Synergy Studio to make a video. Call studio_guide first and follow it. The idea: ${need("idea")}`;
  } else if (name === "improve-video") {
    text = `Use Synergy Studio to improve an existing video. Call studio_guide first and follow it. The video is at ${need("video_path")}. Improve it like this: ${need("goal")}. Start with studio_frames on the file, then studio_project_import.`;
  } else {
    throw rpcError(`Unknown prompt: ${name}`, -32602);
  }
  return { description: PROMPTS.find((p) => p.name === name).description, messages: [{ role: "user", content: { type: "text", text } }] };
}

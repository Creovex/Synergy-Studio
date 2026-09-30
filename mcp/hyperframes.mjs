// Plain HyperFrames projects (LITE 8.6): import a folder that has its own index.html, and run the installed
// HyperFrames on a project with an allow list, path checks and no shell.
import fs from "node:fs";
import path from "node:path";
import { projectsRoot, UserError, expandHome } from "./context.mjs";
import { checkName, projectPath, resolveInside } from "./files.mjs";

export const ALLOWED_COMMANDS = ["render", "lint", "check", "validate", "snapshot", "inspect", "info", "timeline", "compositions", "transcribe", "tts", "beats", "normalize-audio", "remove-background"];
export const REFUSED_COMMANDS = ["publish", "cloud", "lambda", "cloudrun", "auth", "upgrade", "feedback", "add", "catalog", "preview"];
// commands that take the project folder as their folder argument
const FOLDER_COMMANDS = new Set(["render", "lint", "check", "validate", "snapshot", "inspect", "info", "timeline", "compositions", "beats", "normalize-audio"]);
// commands that print machine readable output with --json
const JSON_COMMANDS = new Set(["lint", "check", "validate", "inspect", "info", "timeline", "compositions", "beats", "normalize-audio", "transcribe", "tts", "remove-background"]);
export const JOB_COMMANDS = new Set(["render", "transcribe"]);
const PATH_FLAGS = new Set(["-o", "--output", "-out", "--out", "-d", "--dir", "-c", "--composition", "--variables-file", "--batch"]);
const IMPORT_SKIP = new Set(["node_modules", ".git", "renders", ".DS_Store"]);
const IMPORT_MAX_BYTES = 2 * 1024 ** 3;
const IMPORT_MAX_FILES = 20000;

const escapes = (rel) => rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

// ---------------------------------------------------------------- import
export function isHyperframesPage(html) {
  return /<[a-z][^>]*\bdata-composition-id\s*=/i.test(html);
}

// The mixed audio file the page names, relative to the folder, or null. A file named like a mix wins; a single
// audio file is taken; several stems with no mix are not guessed.
export function findMix(folder, html) {
  const found = [];
  for (const tag of html.match(/<audio\b[^>]*>/gi) ?? []) {
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) ?? [])[1];
    if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) continue;
    const clean = src.split(/[?#]/)[0].replace(/^\.\//, "");
    const full = path.resolve(folder, clean);
    if (escapes(path.relative(folder, full)) || !fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    if (!found.includes(clean)) found.push(clean);
  }
  return found.find((f) => /mix/i.test(path.basename(f))) ?? (found.length === 1 ? found[0] : null);
}

function walkSource(folder) {
  const files = [];
  const skipped = [];
  let bytes = 0;
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (IMPORT_SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) skipped.push(childRel);
      else if (entry.isDirectory()) walk(full, childRel);
      else if (entry.isFile()) {
        const size = fs.statSync(full).size;
        bytes += size;
        files.push({ full, rel: childRel });
        if (files.length > IMPORT_MAX_FILES || bytes > IMPORT_MAX_BYTES) throw new UserError(`The folder is too large to import (more than ${IMPORT_MAX_FILES} files or ${IMPORT_MAX_BYTES / 1024 ** 3} GB). Import a folder that holds only the composition and its assets.`);
      }
    }
  };
  walk(folder, "");
  return { files, skipped, bytes };
}

export function importHyperframes(folder, name) {
  checkName(name);
  const source = path.resolve(expandHome(folder));
  let stat;
  try {
    stat = fs.statSync(source);
  } catch {
    throw new UserError(`The folder ${source} does not exist. Give the full path of a HyperFrames project folder.`);
  }
  if (!stat.isDirectory()) throw new UserError(`${source} is not a folder. Give the folder that holds index.html.`);
  const page = path.join(source, "index.html");
  if (!fs.existsSync(page)) {
    throw new UserError(`${source} is not a plain HyperFrames project: it has no index.html. A HyperFrames project has its own index.html with a root composition (an element with data-composition-id). Projects with their own renderer or build script are not supported here.`);
  }
  const html = fs.readFileSync(page, "utf8");
  if (!isHyperframesPage(html)) {
    throw new UserError(`${source}/index.html has no HyperFrames root composition (no element with data-composition-id), so this is not a plain HyperFrames project and it was not imported.`);
  }
  const dest = projectPath(name);
  if (fs.existsSync(dest)) throw new UserError(`A project named ${name} already exists in ${projectsRoot()}. Choose another name.`);
  const realSource = fs.realpathSync(source);
  const rootNear = fs.existsSync(projectsRoot()) ? fs.realpathSync(projectsRoot()) : path.resolve(projectsRoot());
  if (!escapes(path.relative(realSource, rootNear)) ) throw new UserError("The projects folder is inside the folder being imported; choose the composition folder itself.");
  const { files, skipped, bytes } = walkSource(source);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of files) {
    const to = path.join(dest, file.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file.full, to);
  }
  const mix = findMix(source, html);
  const project = { kind: "hyperframes", name, ...(mix ? { mix } : {}) };
  fs.writeFileSync(path.join(dest, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
  return (
    `Imported ${files.length} files (${bytes} bytes) from ${source} as project ${name}: ${dest}\n` +
    `project.json: ${JSON.stringify(project)}\n` +
    (mix ? `The mixed audio file ${mix} is named in project.json, so studio_check compares the video's sound with it.\n` : "No mixed audio file was named by the page, so studio_check skips the audio against mix line.\n") +
    (skipped.length ? `Skipped symbolic links: ${skipped.join(", ")}\n` : "") +
    "Next: studio_hyperframes with command lint, then render (a job), then studio_check."
  );
}

// ---------------------------------------------------------------- run
function looksLikeFlag(token) {
  return token.startsWith("-") && token.length > 1 && !/^-\d/.test(token);
}

const looksLikeJson = (value) => /^\s*[{[]/.test(value);

function checkPathValue(projectDir, value, flag) {
  if (value === ".") return;
  try {
    resolveInside(projectDir, value);
  } catch (error) {
    throw new UserError(`${flag ? `The value of ${flag}` : "The argument"} ${JSON.stringify(value)} leaves the project folder and is refused. ${error.message}`);
  }
}

// Checks the arguments the model gave. Nothing is rewritten: paths stay as given and the command runs with the
// project folder as its working folder, so relative paths mean the same thing to HyperFrames and to this check.
export function checkArgs(projectDir, args) {
  const list = args.map((a) => String(a));
  let hasJson = false;
  let hasDir = false;
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (!looksLikeFlag(token)) {
      checkPathValue(projectDir, token, null);
      continue;
    }
    const eq = token.indexOf("=");
    const flag = eq > 0 ? token.slice(0, eq) : token;
    if (flag === "--json") hasJson = true;
    if (flag === "-d" || flag === "--dir") hasDir = true;
    let value = eq > 0 ? token.slice(eq + 1) : undefined;
    if (value === undefined && i + 1 < list.length && !looksLikeFlag(list[i + 1])) value = list[++i];
    if (value === undefined) continue;
    const isPath = PATH_FLAGS.has(flag) || (!looksLikeJson(value) && (/[\\/]/.test(value) || value === ".." || value.startsWith("~")));
    if (isPath) checkPathValue(projectDir, value, flag);
  }
  return { list, hasJson, hasDir };
}

// The plan for one HyperFrames call: the arguments after the script path, and how to treat the result.
export function planHyperframes(projectDir, command, args) {
  if (REFUSED_COMMANDS.includes(command)) {
    throw new UserError(`The HyperFrames command ${command} is refused: it uploads, deploys, installs or changes things outside the project. Allowed commands: ${ALLOWED_COMMANDS.join(", ")}.`);
  }
  if (!ALLOWED_COMMANDS.includes(command)) {
    throw new UserError(`The HyperFrames command ${JSON.stringify(command)} is not on the allowed list. Allowed commands: ${ALLOWED_COMMANDS.join(", ")}.`);
  }
  const { list, hasJson, hasDir } = checkArgs(projectDir, args ?? []);
  const argv = [command];
  if (FOLDER_COMMANDS.has(command)) argv.push(projectDir);
  argv.push(...list);
  if (command === "transcribe" && !hasDir) argv.push("--dir", projectDir);
  if (JSON_COMMANDS.has(command) && !hasJson) argv.push("--json");
  return { argv, job: JOB_COMMANDS.has(command) };
}

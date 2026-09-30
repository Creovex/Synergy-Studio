// Project names, path safety and the file tools. Node built ins only.
// Rules (LITE 8.2): a project name is lower case letters, digits and hyphens, at most 40 characters; a path is
// resolved inside the project folder and refused when path.relative leaves it or a symbolic link points out;
// writes go only to project.json, brief.md, shots.md, feedback.md, src/** and *.srt or *.vtt files.
import fs from "node:fs";
import path from "node:path";
import { projectsRoot, UserError, expandHome } from "./context.mjs";
import { imageContent } from "./images.mjs";

export const NAME_RE = /^[a-z0-9-]{1,40}$/;
export const MAX_READ_BYTES = 200 * 1024;
export const MAX_WRITE_BYTES = 5 * 1024 * 1024;
const WRITE_ROOT_FILES = new Set(["project.json", "brief.md", "shots.md", "feedback.md"]);
const LIST_LIMIT = 1500;
const EXPORT_ITEMS = ["project.json", "brief.md", "shots.md", "feedback.md"];
const FONT_EXT = new Set([".woff2", ".woff", ".ttf", ".otf"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);

export function checkName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new UserError(`"${name}" is not a valid project name. Use lower case letters, digits and hyphens only, at most 40 characters (for example hydration-tips).`);
  }
  return name;
}

export const projectPath = (name) => path.join(projectsRoot(), checkName(name));

// The project folder of an existing project, or a plain error that says what to do.
export function existingProject(name) {
  const dir = projectPath(name);
  if (!fs.existsSync(path.join(dir, "project.json"))) {
    throw new UserError(`There is no project named ${name} in ${projectsRoot()}. Make it with studio_project_new (or studio_project_import), or see studio_project_list.`);
  }
  return dir;
}

const escapes = (rel) => rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

function nearestExisting(p) {
  let current = p;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

// Resolves rel inside dir. Returns {full, rel} (rel with forward slashes). Throws UserError when it leaves the
// folder, lexically or through a symbolic link.
export function resolveInside(dir, rel) {
  if (typeof rel !== "string" || rel.trim() === "" || rel.includes("\0")) throw new UserError("Give a path inside the project, for example src/index.html.");
  const root = path.resolve(dir);
  const full = path.resolve(root, expandHome(rel));
  const relative = path.relative(root, full);
  if (relative === "" || escapes(relative)) throw new UserError(`The path ${rel} is outside the project folder. Only paths inside the project are allowed.`);
  const realRoot = fs.realpathSync(root);
  const realNear = fs.realpathSync(nearestExisting(full));
  if (escapes(path.relative(realRoot, realNear))) throw new UserError(`The path ${rel} goes through a symbolic link that points outside the project folder, so it is refused.`);
  return { full, rel: relative.split(path.sep).join("/") };
}

export function writable(rel) {
  return WRITE_ROOT_FILES.has(rel) || rel.startsWith("src/") || /\.(srt|vtt)$/i.test(rel);
}

const shorten = (line, max = 200) => (line.length > max ? `${line.slice(0, max)}...` : line);

export function writeProjectFile(name, rel, content) {
  const dir = existingProject(name);
  const { full, rel: clean } = resolveInside(dir, rel);
  if (!writable(clean)) {
    throw new UserError(`Writing ${clean} is not allowed. Files can be written only to project.json, brief.md, shots.md, feedback.md, anything under src/, and .srt or .vtt files. Generated folders (comp, audio, out, stills) are made by the tools.`);
  }
  if (typeof content !== "string") throw new UserError("content must be text.");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) throw new UserError(`The content is ${bytes} bytes; the limit is ${MAX_WRITE_BYTES}. Split it into files (for example a script under src/assets/).`);
  let existing = null;
  try {
    existing = fs.lstatSync(full);
  } catch {
    // a new file
  }
  if (existing?.isSymbolicLink()) throw new UserError(`${clean} is a symbolic link; it is not written through.`);
  if (existing?.isDirectory()) throw new UserError(`${clean} is a folder, not a file.`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (escapes(path.relative(fs.realpathSync(dir), fs.realpathSync(path.dirname(full))))) throw new UserError(`The folder for ${clean} leaves the project, so it is refused.`);
  const part = `${full}.${process.pid}.part`;
  fs.writeFileSync(part, content);
  fs.renameSync(part, full);
  const back = fs.readFileSync(full, "utf8");
  const lines = back.replace(/\n$/, "").split("\n");
  let note = "";
  if (clean === "project.json") {
    try {
      JSON.parse(back);
    } catch (error) {
      note = `\nWARNING: project.json is not valid JSON (${error.message}). Fix it before running any tool.`;
    }
  }
  return `Wrote ${fs.statSync(full).size} bytes to ${clean} (${lines.length} line${lines.length === 1 ? "" : "s"}).\nfirst line: ${shorten(lines[0])}\nlast line: ${shorten(lines.at(-1))}${note}`;
}

export function listProjectFiles(name) {
  const dir = existingProject(name);
  const rows = [];
  let truncated = false;
  const walk = (folder, prefix) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (rows.length >= LIST_LIMIT) {
        truncated = true;
        return;
      }
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) rows.push(`${rel}  (symbolic link)`);
      else if (entry.isDirectory()) {
        rows.push(`${rel}/`);
        walk(full, rel);
      } else rows.push(`${rel}  ${fs.statSync(full).size} bytes`);
    }
  };
  walk(dir, "");
  return `Project ${name} at ${dir}\n${rows.join("\n")}${truncated ? `\n(list cut at ${LIST_LIMIT} entries)` : ""}`;
}

// Returns MCP content: text, or an image for jpg and png.
export async function readProjectFile(name, rel) {
  const dir = existingProject(name);
  const { full, rel: clean } = resolveInside(dir, rel);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    throw new UserError(`${clean} does not exist in project ${name}. Use studio_file_list to see the files.`);
  }
  if (stat.isDirectory()) throw new UserError(`${clean} is a folder. Use studio_file_list to see what is inside.`);
  if (/\.(jpe?g|png)$/i.test(clean)) {
    const image = await imageContent(full);
    if (image) return [image];
    return [{ type: "text", text: `${clean} is a picture (${stat.size} bytes). It cannot be shown before setup finishes, because the picture conversion uses the installed ffmpeg.` }];
  }
  const fd = fs.openSync(full, "r");
  const buffer = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
  try {
    fs.readSync(fd, buffer, 0, buffer.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (buffer.subarray(0, 8192).includes(0)) return [{ type: "text", text: `${clean} is a binary file (${stat.size} bytes), so its content is not shown as text.` }];
  const text = buffer.toString("utf8");
  const note = stat.size > MAX_READ_BYTES ? `\n\n[cut: showing the first ${MAX_READ_BYTES} of ${stat.size} bytes]` : "";
  return [{ type: "text", text: text + note }];
}

// The destination of studio_file_add, chosen from the file type unless `to` says where.
function addTarget(dir, fromPath, to) {
  const base = path.basename(fromPath);
  const ext = path.extname(base).toLowerCase();
  const folders = ["src/assets/fonts", "src/assets", "src/footage"];
  const byType = FONT_EXT.has(ext) ? "src/assets/fonts" : VIDEO_EXT.has(ext) ? "src/footage" : "src/assets";
  let chosen = `${byType}/${base}`;
  if (typeof to === "string" && to.trim() !== "") {
    const cleaned = to.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    const asFolder = cleaned.replace(/\/+$/, "");
    chosen = folders.includes(asFolder) ? `${asFolder}/${base}` : cleaned;
  }
  const { full, rel } = resolveInside(dir, chosen);
  const okFolder = folders.some((folder) => rel.startsWith(`${folder}/`));
  if (!okFolder) throw new UserError(`Files are added only to src/assets/, src/assets/fonts/ or src/footage/ (asked for ${rel}).`);
  return { full, rel };
}

export function addProjectFile(name, fromPath, to) {
  const dir = existingProject(name);
  const source = path.resolve(expandHome(fromPath));
  let stat;
  try {
    stat = fs.statSync(source);
  } catch {
    throw new UserError(`The file ${source} does not exist. Give the full path of a file on this computer.`);
  }
  if (!stat.isFile()) throw new UserError(`${source} is not a file. Add one file at a time.`);
  const { full, rel } = addTarget(dir, source, to);
  let existing = null;
  try {
    existing = fs.lstatSync(full);
  } catch {
    // new
  }
  if (existing?.isSymbolicLink() || existing?.isDirectory()) throw new UserError(`${rel} exists and is not a plain file, so it is not replaced.`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.copyFileSync(source, full);
  return `Copied ${source} to ${rel} (${stat.size} bytes). Refer to it from the page as ${rel.replace(/^src\//, "")}; compose copies src/assets/ to comp/assets/.`;
}

const PROJECT_MP4 = (name) => name.endsWith(".mp4") && !/-share\.mp4$|^render-raw/.test(name);

// The newest finished MP4 of a project (out/, and renders/ for plain HyperFrames projects), or null.
export function latestMp4(dir) {
  let best = null;
  for (const folder of ["out", "renders"]) {
    const full = path.join(dir, folder);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full)) {
      if (!PROJECT_MP4(file)) continue;
      const stat = fs.statSync(path.join(full, file));
      if (!best || stat.mtimeMs > best.mtimeMs) best = { file: path.join(full, file), mtimeMs: stat.mtimeMs, size: stat.size };
    }
  }
  return best;
}

export function listProjects() {
  const root = projectsRoot();
  if (!fs.existsSync(root)) return { root, projects: [] };
  const projects = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const pj = path.join(dir, "project.json");
    if (!fs.existsSync(pj)) continue;
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(pj, "utf8"));
    } catch {
      // unreadable project.json is listed without details
    }
    const times = [fs.statSync(pj).mtimeMs];
    const page = path.join(dir, "src", "index.html");
    if (fs.existsSync(page)) times.push(fs.statSync(page).mtimeMs);
    const mp4 = latestMp4(dir);
    if (mp4) times.push(mp4.mtimeMs);
    projects.push({
      name: entry.name,
      valid_name: NAME_RE.test(entry.name),
      kind: meta.kind ?? meta.mode ?? "narrated",
      aspect: meta.aspect ?? null,
      last_change: new Date(Math.max(...times)).toISOString(),
      has_mp4: Boolean(mp4),
    });
  }
  projects.sort((a, b) => b.last_change.localeCompare(a.last_change));
  return { root, projects };
}

// Copies the sources of a project to dest: project.json, src/ (without src/footage), brief.md, shots.md, feedback.md.
// Never follows a symbolic link (links are skipped), never copies comp, stills, audio, out, history or footage.
export function exportProject(name, dest, overwrite) {
  const dir = existingProject(name);
  const target = path.resolve(expandHome(dest));
  if (!path.isAbsolute(expandHome(dest))) throw new UserError("dest must be an absolute path, for example /Users/you/repo/media/my-video.");
  const realDir = fs.realpathSync(dir);
  const near = nearestExisting(target);
  const realTarget = path.join(fs.realpathSync(near), path.relative(near, target));
  const inside = path.relative(realDir, realTarget);
  if (inside === "" || !escapes(inside)) throw new UserError("dest is inside the project folder itself. Choose a folder outside the project.");
  let stat = null;
  try {
    stat = fs.lstatSync(target);
  } catch {
    // not there yet
  }
  if (stat?.isSymbolicLink()) throw new UserError(`${target} is a symbolic link; export does not follow links. Give a real folder.`);
  if (stat && !stat.isDirectory()) throw new UserError(`${target} exists and is a file. Give a folder path.`);
  if (stat && fs.readdirSync(target).length > 0 && overwrite !== true) {
    throw new UserError(`${target} already exists and is not empty. Choose another dest, or call again with overwrite true to write into it.`);
  }
  fs.mkdirSync(target, { recursive: true });
  const copied = [];
  const skipped = [];
  const copyFile = (from, to, rel) => {
    let old = null;
    try {
      old = fs.lstatSync(to);
    } catch {
      // new
    }
    if (old?.isSymbolicLink()) fs.rmSync(to, { force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied.push(rel);
  };
  const copyTree = (from, to, rel) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) skipped.push(`${childRel} (symbolic link)`);
      else if (entry.isDirectory()) {
        if (childRel === "src/footage") skipped.push("src/footage/ (footage is never exported)");
        else copyTree(path.join(from, entry.name), path.join(to, entry.name), childRel);
      } else if (entry.isFile()) copyFile(path.join(from, entry.name), path.join(to, entry.name), childRel);
    }
  };
  for (const item of EXPORT_ITEMS) {
    const from = path.join(dir, item);
    let s;
    try {
      s = fs.lstatSync(from);
    } catch {
      continue;
    }
    if (s.isSymbolicLink()) skipped.push(`${item} (symbolic link)`);
    else if (s.isFile()) copyFile(from, path.join(target, item), item);
  }
  const src = path.join(dir, "src");
  let srcStat = null;
  try {
    srcStat = fs.lstatSync(src);
  } catch {
    // no src
  }
  if (srcStat?.isDirectory()) copyTree(src, path.join(target, "src"), "src");
  else if (srcStat?.isSymbolicLink()) skipped.push("src (symbolic link)");
  return `Exported ${copied.length} files of ${name} to ${target}.\n${copied.join("\n")}${skipped.length ? `\nSkipped: ${skipped.join(", ")}` : ""}`;
}

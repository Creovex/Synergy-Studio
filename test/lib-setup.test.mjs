// Fast unit tests for the setup helpers: paths, env, run, lock, download, pins. No external network:
// downloads run against a server on 127.0.0.1.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = path.join(ROOT, "skills", "synergy-studio", "scripts");
const lib = (name) => import(pathToFileURL(path.join(SCRIPTS, "lib", name)).href);
const made = [];
const scratch = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio home test "));
  made.push(dir);
  return dir;
};
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

test("tool home uses SYNERGY_STUDIO_HOME when set and non empty", async () => {
  const { toolHome } = await lib("paths.mjs");
  assert.equal(toolHome({ SYNERGY_STUDIO_HOME: "/tmp/some home" }), path.resolve("/tmp/some home"));
  const fallback = toolHome({ SYNERGY_STUDIO_HOME: "  ", XDG_DATA_HOME: "" });
  assert.notEqual(fallback, path.resolve("  "));
  assert.match(fallback, /SynergyStudioLite$|synergy-studio-lite$/);
});

test("default tool home per system", async () => {
  const { toolHome } = await lib("paths.mjs");
  const home = toolHome({});
  if (process.platform === "darwin") assert.equal(home, path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite"));
  if (process.platform === "linux") assert.equal(home, path.join(os.homedir(), ".local", "share", "synergy-studio-lite"));
  if (process.platform === "win32") assert.match(home, /SynergyStudioLite$/);
  if (process.platform === "linux") assert.equal(toolHome({ XDG_DATA_HOME: "/x/data" }), path.join("/x/data", "synergy-studio-lite"));
});

test("projects home", async () => {
  const { projectsHome } = await lib("paths.mjs");
  assert.equal(projectsHome({ SYNERGY_STUDIO_PROJECTS: "/tmp/p q" }), path.resolve("/tmp/p q"));
  const def = projectsHome({});
  assert.equal(path.basename(def), "Synergy Studio");
  assert.equal(path.basename(path.dirname(def)), process.platform === "darwin" ? "Movies" : "Videos");
});

test("layout keeps every path inside the home and uses platform names", async () => {
  const { layout, venvPython, exeName } = await lib("paths.mjs");
  const home = path.join(os.tmpdir(), "a home with spaces");
  const L = layout(home);
  for (const key of ["nodeBin", "npmCli", "uvBin", "python", "hyperframesMjs", "ffmpeg", "ffprobe", "modelFile", "voicesFile", "heavyLock", "envJson", "hfHome"]) {
    assert.ok(L[key].startsWith(home), `${key} is inside the home`);
  }
  assert.equal(L.python, venvPython(home));
  assert.equal(path.basename(L.uvBin), exeName("uv"));
  assert.equal(path.basename(L.ffprobe), exeName("ffprobe"));
  assert.equal(path.basename(L.heavyLock), "heavy.lock");
  assert.equal(path.dirname(L.heavyLock), path.join(home, "locks"));
});

test("free disk is a positive number for an existing folder and for a folder that does not exist yet", async () => {
  const { freeDiskBytes } = await lib("paths.mjs");
  assert.ok(freeDiskBytes(os.tmpdir()) > 0);
  assert.ok(freeDiskBytes(path.join(os.tmpdir(), "does", "not", "exist", "yet")) > 0);
});

test("env: loadEnv says run setup when nothing is installed; save and update round trip", async () => {
  const { loadEnv, saveEnv, updateEnv } = await lib("env.mjs");
  const home = scratch();
  assert.throws(() => loadEnv(home), /not set up yet: run setup/);
  saveEnv({ home, node: "/n", platform: "x" });
  assert.equal(loadEnv(home).node, "/n");
  updateEnv({ synctest: { ok: true } }, home);
  assert.deepEqual(loadEnv(home).synctest, { ok: true });
  assert.equal(loadEnv(home).platform, "x");
  fs.writeFileSync(path.join(home, "env.json"), "{broken");
  assert.throws(() => loadEnv(home), /not set up yet/);
});

test("env: toolEnv puts the home bin and runtime node first and sets the HyperFrames variables", async () => {
  const { toolEnv, hyperframesArgs } = await lib("env.mjs");
  const env = {
    bin: "/h/bin", node: path.join("/h", "runtime", "node", "bin", "node"), hf_home: "/h/node/hf-home",
    ffmpeg: "/h/bin/ffmpeg", ffprobe: "/h/bin/ffprobe", hyperframes: "/h/node/hf.mjs", browser: { path: "/does/not/exist" },
  };
  const vars = toolEnv(env, { EXTRA: "1" });
  const key = Object.keys(vars).find((k) => k.toLowerCase() === "path");
  const parts = vars[key].split(path.delimiter);
  assert.equal(parts[0], "/h/bin");
  assert.equal(parts[1], path.join("/h", "runtime", "node", "bin"));
  assert.equal(vars.HYPERFRAMES_SKIP_SKILLS, "1");
  assert.equal(vars.HYPERFRAMES_NO_TELEMETRY, "1");
  assert.equal(vars.HYPERFRAMES_NO_UPDATE_CHECK, "1");
  assert.equal(vars.HOME, "/h/node/hf-home");
  assert.equal(vars.HYPERFRAMES_BROWSER_PATH, undefined, "a browser path that is gone is not passed on");
  assert.equal(vars.EXTRA, "1");
  assert.deepEqual(hyperframesArgs(env, ["render", "x"]), ["/h/node/hf.mjs", "render", "x"]);
});

test("run: captures output, passes arguments with spaces untouched, never uses a shell", async () => {
  const { run } = await lib("run.mjs");
  const r = await run(process.execPath, ["-e", "console.log(process.argv.slice(1).join('|'))", "a b", "$HOME", "*"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), "a b|$HOME|*");
});

test("run: reports the exit code, a timeout and a command that cannot start", async () => {
  const { run } = await lib("run.mjs");
  assert.equal((await run(process.execPath, ["-e", "process.exit(3)"])).code, 3);
  const slow = await run(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"], { timeoutMs: 300 });
  assert.equal(slow.timedOut, true);
  assert.notEqual(slow.code, 0);
  const missing = await run(path.join(os.tmpdir(), "no such program"), []);
  assert.equal(missing.code, 127);
  assert.match(missing.stderr, /ENOENT/);
});

test("lock: taken, released, and released again after an error", async () => {
  const { withHeavyLock, readHeavyLock } = await lib("lock.mjs");
  const home = scratch();
  const result = await withHeavyLock(home, "test", async () => {
    const held = readHeavyLock(home);
    assert.equal(held.pid, process.pid);
    assert.equal(held.label, "test");
    assert.ok(held.started);
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(readHeavyLock(home), null);
  await assert.rejects(withHeavyLock(home, "boom", async () => { throw new Error("boom"); }), /boom/);
  assert.equal(readHeavyLock(home), null);
});

test("lock: a nested call for the same home runs at once instead of waiting for itself", async () => {
  const { withHeavyLock } = await lib("lock.mjs");
  const home = scratch();
  const order = [];
  await withHeavyLock(home, "outer", async () => {
    await withHeavyLock(home, "inner", async () => order.push("inner"));
    order.push("outer");
  }, { pollMs: 20 });
  assert.deepEqual(order, ["inner", "outer"]);
});

test("lock: a second job waits, says so once, and goes on when the first ends", async () => {
  const { withHeavyLock } = await lib("lock.mjs");
  const home = scratch();
  const messages = [];
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = withHeavyLock(home, "first", async () => { order.push("first start"); await gate; order.push("first end"); });
  await new Promise((r) => setTimeout(r, 50));
  const second = withHeavyLock(home, "second", async () => order.push("second"), { log: (m) => messages.push(m), pollMs: 20 });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Waiting for first/);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first start", "first end", "second"]);
});

test("lock: a lock whose process is gone is taken over and logged", async () => {
  const { withHeavyLock, readHeavyLock, pidIsAlive } = await lib("lock.mjs");
  const { layout } = await lib("paths.mjs");
  const home = scratch();
  const L = layout(home);
  const dead = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(pidIsAlive(dead.pid), false);
  fs.mkdirSync(L.locks, { recursive: true });
  fs.writeFileSync(L.heavyLock, JSON.stringify({ pid: dead.pid, started: "2026-01-01T00:00:00Z", label: "render" }));
  const messages = [];
  await withHeavyLock(home, "setup", async () => {
    assert.equal(readHeavyLock(home).pid, process.pid);
  }, { log: (m) => messages.push(m), pollMs: 20 });
  assert.deepEqual(messages, [], "a dead owner is not waited for");
  assert.match(fs.readFileSync(L.serverLog, "utf8"), /took over a stale heavy lock \(pid \d+, render/);
});

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const payload = crypto.randomBytes(200000);
const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");

function rangeHandler(req, res) {
  const match = /bytes=(\d+)-/.exec(req.headers.range ?? "");
  const start = match ? Number(match[1]) : 0;
  res.writeHead(match ? 206 : 200, { "Content-Length": payload.length - start });
  res.end(payload.subarray(start));
}

test("download: writes the file, checks size and hash, leaves no .part behind, follows a redirect", async () => {
  const { download } = await lib("run.mjs");
  const { server, url } = await serve((req, res) => {
    if (req.url === "/go") { res.writeHead(302, { Location: "/file" }); return res.end(); }
    return rangeHandler(req, res);
  });
  try {
    const dir = scratch();
    const dest = path.join(dir, "sub dir", "f.bin");
    const got = await download(`${url}/go`, dest, { sha256: payloadHash, size: payload.length });
    assert.equal(got.sha256, payloadHash);
    assert.deepEqual(fs.readFileSync(dest), payload);
    assert.equal(fs.existsSync(`${dest}.part`), false);
    const again = await download(`${url}/go`, dest, { sha256: payloadHash, size: payload.length });
    assert.equal(again.reused, true);
  } finally { server.close(); }
});

test("download: resumes an existing .part with a Range request", async () => {
  const { download } = await lib("run.mjs");
  const seen = [];
  const { server, url } = await serve((req, res) => { seen.push(req.headers.range); rangeHandler(req, res); });
  try {
    const dest = path.join(scratch(), "r.bin");
    fs.writeFileSync(`${dest}.part`, payload.subarray(0, 50000));
    await download(`${url}/f`, dest, { sha256: payloadHash, size: payload.length });
    assert.deepEqual(seen, ["bytes=50000-"]);
    assert.deepEqual(fs.readFileSync(dest), payload);
  } finally { server.close(); }
});

test("download: a stalled connection is aborted and resumed, not waited for", async () => {
  const { download } = await lib("run.mjs");
  let calls = 0;
  const { server, url } = await serve((req, res) => {
    calls += 1;
    if (calls === 1) {
      res.writeHead(200, { "Content-Length": payload.length });
      res.write(payload.subarray(0, 60000));
      return; // never ends: a stalled socket
    }
    return rangeHandler(req, res);
  });
  try {
    const dest = path.join(scratch(), "s.bin");
    const started = Date.now();
    const logs = [];
    await download(`${url}/f`, dest, { sha256: payloadHash, size: payload.length, stallMs: 400, log: (m) => logs.push(m) });
    assert.ok(Date.now() - started < 8000);
    assert.equal(calls, 2);
    assert.match(logs[0], /stalled/);
    assert.deepEqual(fs.readFileSync(dest), payload);
  } finally { server.closeAllConnections(); server.close(); }
});

test("download: a server that never answers is given up on after the stall time", async () => {
  const { download } = await lib("run.mjs");
  const { server, url } = await serve(() => {});
  try {
    const started = Date.now();
    await assert.rejects(download(`${url}/f`, path.join(scratch(), "n.bin"), { stallMs: 200, attempts: 2, log: () => {} }), /download failed after 2 tries/);
    assert.ok(Date.now() - started < 6000);
  } finally { server.closeAllConnections(); server.close(); }
});

test("download: a wrong hash is refused and nothing is left at the destination", async () => {
  const { download } = await lib("run.mjs");
  const { server, url } = await serve(rangeHandler);
  try {
    const dest = path.join(scratch(), "h.bin");
    await assert.rejects(download(`${url}/f`, dest, { sha256: "0".repeat(64), attempts: 2, log: () => {} }), /checksum/);
    assert.equal(fs.existsSync(dest), false);
  } finally { server.close(); }
});

test("download: a 404 fails at once with a plain message", async () => {
  const { download } = await lib("run.mjs");
  const { server, url } = await serve((req, res) => { res.writeHead(404); res.end(); });
  try {
    await assert.rejects(download(`${url}/f`, path.join(scratch(), "x.bin"), { log: () => {} }), /HTTP 404/);
  } finally { server.close(); }
});

test("pins: every platform has a 64 hex checksum, models have sizes, the lock holds the pinned packages", async () => {
  const setup = await lib("setup.mjs");
  for (const table of [setup.NODE_ARCHIVES, setup.UV_ARCHIVES]) {
    for (const [platform, entry] of Object.entries(table)) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/, platform);
    }
  }
  assert.deepEqual(Object.keys(setup.NODE_ARCHIVES).sort(), Object.keys(setup.UV_ARCHIVES).sort());
  assert.equal(setup.NODE_ARCHIVES["darwin-arm64"].sha256, "23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53");
  assert.equal(setup.PINS.node, "v22.23.3");
  assert.equal(setup.PINS.uv, "0.12.21");
  assert.equal(Object.keys(setup.NPM_PACKAGES).length, 8);
  for (const [name, version] of Object.entries(setup.NPM_PACKAGES)) assert.match(version, /^\d+\.\d+\.\d+$/, name);
  assert.deepEqual(setup.MODELS.map((m) => m.size), [92361271, 28214398]);
  for (const m of setup.MODELS) assert.match(m.sha256, /^[0-9a-f]{64}$/, m.name);
  const lock = fs.readFileSync(path.join(SCRIPTS, "requirements.lock"), "utf8");
  for (const pin of ["kokoro-onnx==0.6.1", "soundfile==0.14.0", "imageio-ffmpeg==0.6.0", "pillow==12.3.0"]) assert.ok(lock.includes(pin), pin);
});

test("binaryArch accepts the running node and rejects a text file", { skip: process.platform === "win32" }, async () => {
  const { binaryArch } = await lib("setup.mjs");
  assert.equal((await binaryArch(process.execPath)).ok, true);
  const text = path.join(scratch(), "t.txt");
  fs.writeFileSync(text, "not a program");
  assert.equal((await binaryArch(text)).ok, false);
});

test("doctor on an empty home says it is not set up and exits 1", async () => {
  const { runDoctor } = await lib("doctor.mjs");
  const lines = [];
  const code = await runDoctor({ home: scratch(), full: false, log: (l) => lines.push(l) });
  assert.equal(code, 1);
  assert.match(lines.join("\n"), /not set up/);
});

function fakeEnv(home) {
  const gone = (name) => path.join(home, "missing", name);
  return {
    home, platform: process.platform, arch: "arm64", node: gone("node"), npm_cli: gone("npm"), uv: gone("uv"),
    python: gone("python"), node_modules: gone("node_modules"), hyperframes: gone("hf.mjs"), hf_home: gone("hf-home"),
    bin: gone("bin"), ffmpeg: gone("ffmpeg"), ffprobe: gone("ffprobe"), kokoro_model: gone("m.onnx"), kokoro_voices: gone("v.bin"),
  };
}

test("env: an env.json written for another home is refused (a copied home)", async () => {
  const { loadEnv, saveEnv } = await lib("env.mjs");
  const original = scratch();
  const copy = scratch();
  saveEnv(fakeEnv(original));
  fs.copyFileSync(path.join(original, "env.json"), path.join(copy, "env.json"));
  assert.equal(loadEnv(original).home, original);
  assert.throws(() => loadEnv(copy), (error) => error.code === "FOREIGN_HOME" && error.otherHome === original && /another home/.test(error.message));
});

test("doctor on a copied home says env.json belongs to another home and exits 1", async () => {
  const { runDoctor } = await lib("doctor.mjs");
  const { saveEnv } = await lib("env.mjs");
  const original = scratch();
  const copy = scratch();
  saveEnv(fakeEnv(original));
  fs.copyFileSync(path.join(original, "env.json"), path.join(copy, "env.json"));
  const lines = [];
  const code = await runDoctor({ home: copy, full: false, log: (l) => lines.push(l) });
  assert.equal(code, 1);
  assert.equal(lines.join("\n"), `FAIL setup: env.json belongs to another home (${original}). Fix: run setup`);
});

test("doctor exits 2 when a check fails, and every FAIL line says what to do", async () => {
  const { runDoctor } = await lib("doctor.mjs");
  const { saveEnv } = await lib("env.mjs");
  const home = scratch();
  saveEnv(fakeEnv(home));
  const lines = [];
  const code = await runDoctor({ home, full: false, log: (l) => lines.push(l) });
  assert.equal(code, 2);
  const fails = lines.filter((l) => l.startsWith("FAIL"));
  assert.ok(fails.length >= 5);
  for (const line of fails) assert.match(line, /\. Fix: /);
});

test("toolEnv always names the whisper program so HyperFrames never searches or installs one", async () => {
  const { toolEnv } = await lib("env.mjs");
  const base = { home: "/h", bin: "/h/bin", node: "/h/runtime/node/bin/node", hf_home: "/h/node/hf-home", ffmpeg: "/f", ffprobe: "/p" };
  assert.equal(toolEnv({ ...base, whisper: { available: true, path: "/h/w/whisper-cli" } }).HYPERFRAMES_WHISPER_PATH, "/h/w/whisper-cli");
  assert.ok(toolEnv({ ...base, whisper: { available: false, reason: "x" } }).HYPERFRAMES_WHISPER_PATH.startsWith(path.join("/h", "runtime", "whisper")));
});

test("whisper pin: tag, tarball address and the cmake pin are in the lock", async () => {
  const setup = await lib("setup.mjs");
  assert.match(setup.WHISPER.tag, /^v\d+\.\d+\.\d+$/);
  assert.equal(setup.WHISPER.url, `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${setup.WHISPER.tag}.tar.gz`);
  assert.match(setup.WHISPER.sha256, /^[0-9a-f]{64}$/);
  const lock = fs.readFileSync(path.join(SCRIPTS, "requirements.lock"), "utf8");
  assert.ok(lock.includes(`cmake==${setup.CMAKE_VERSION}`));
});

test("whisper model pin and cache path", async () => {
  const { WHISPER_MODEL } = await lib("setup.mjs");
  const { layout } = await import(pathToFileURL(path.join(SCRIPTS, "lib", "paths.mjs")).href);
  assert.equal(WHISPER_MODEL.size, 487614201);
  assert.match(WHISPER_MODEL.sha256, /^[0-9a-f]{64}$/);
  assert.match(WHISPER_MODEL.url, /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\/ggml-small\.en\.bin$/);
  assert.equal(layout("/h").whisperModel, path.join("/h", "node", "hf-home", ".cache", "hyperframes", "whisper", "models", "ggml-small.en.bin"));
});

test("--whisper-model refuses a file that is not the pinned model and copies nothing", async () => {
  const { installWhisperModel } = await lib("setup.mjs");
  const dir = scratch();
  const bad = path.join(dir, "bad.bin");
  fs.writeFileSync(bad, "not a model");
  const dest = path.join(dir, "cache", "ggml-small.en.bin");
  await assert.rejects(() => installWhisperModel(bad, dest), /not ggml-small\.en\.bin/);
  await assert.rejects(() => installWhisperModel(path.join(dir, "missing.bin"), dest), /not found/);
  assert.equal(fs.existsSync(dest), false);
});

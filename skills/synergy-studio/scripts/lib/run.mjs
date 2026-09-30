// Running child processes and downloading files. Node built ins only; children never run through a shell.
//
// Exports
//   run(cmd, args, {cwd, env, capture=true, echo=false, timeoutMs, input})
//        spawns cmd with an argument array. capture true collects stdout and stderr; echo true also copies them
//        to this process as they arrive; capture false hands the child our terminal. Resolves (never rejects)
//        to {code, stdout, stderr, timedOut}. A command that cannot start gives code 127 and the reason in stderr.
//   runHyperframes(env, args, opts)   runs HyperFrames with the home's own node and environment (toolEnv)
//   runPython(env, args, opts)        runs the venv Python with toolEnv
//   sha256File(file)                  hex SHA-256 of a file, streamed
//   download(url, dest, {sha256, size, onProgress, stallMs=30000, attempts=6, log})
//        writes dest.part, resumes it with an HTTP Range request, follows redirects, honours HTTPS_PROXY and
//        NO_PROXY, aborts and retries a stalled socket (no bytes for stallMs), checks size and SHA-256, then
//        renames to dest. Resolves to {sha256, bytes, reused}. A dest that already passes the checks is kept.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { toolEnv, hyperframesArgs } from "./env.mjs";

export function run(cmd, args = [], opts = {}) {
  const { cwd, env, capture = true, echo = false, timeoutMs, input } = opts;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: capture ? [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] : "inherit",
      });
    } catch (error) {
      resolve({ code: 127, stdout, stderr: String(error.message), timedOut });
      return;
    }
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs)
      : null;
    if (capture) {
      child.stdout.on("data", (d) => {
        stdout += d;
        if (echo) process.stdout.write(d);
      });
      child.stderr.on("data", (d) => {
        stderr += d;
        if (echo) process.stderr.write(d);
      });
      if (input !== undefined) child.stdin.end(input);
    }
    child.on("error", (error) => finish({ code: 127, stdout, stderr: stderr + String(error.message), timedOut }));
    child.on("close", (code, signal) => finish({ code: code ?? (signal ? 128 : 1), stdout, stderr, timedOut }));
  });
}

export function runHyperframes(env, args, opts = {}) {
  return run(env.node, hyperframesArgs(env, args), { ...opts, env: opts.env ?? toolEnv(env) });
}

export function runPython(env, args, opts = {}) {
  return run(env.python, args, { ...opts, env: opts.env ?? toolEnv(env) });
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function proxyFor(url) {
  const raw = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!raw || url.protocol !== "https:") return null;
  const skip = (process.env.NO_PROXY ?? process.env.no_proxy ?? "").split(",").map((s) => s.trim().replace(/^\./, "")).filter(Boolean);
  const host = url.hostname;
  if (skip.some((s) => s === "*" || host === s || host.endsWith(`.${s}`))) return null;
  return new URL(raw);
}

// One GET. Resolves with the response once its headers arrive; rejects when nothing arrives within stallMs.
function requestOnce(urlText, headers, stallMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const mod = url.protocol === "https:" ? https : http;
    const port = url.port || (url.protocol === "https:" ? 443 : 80);
    const options = { method: "GET", headers, hostname: url.hostname, port, path: `${url.pathname}${url.search}` };
    const parts = [];
    const timer = setTimeout(() => fail(new Error(`no answer from ${url.hostname} for ${stallMs / 1000} s`)), stallMs);
    let done = false;
    function fail(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      parts.forEach((p) => p.destroy());
      reject(error);
    }
    const send = (extra = {}) => {
      const req = mod.request({ ...options, ...extra }, (res) => {
        if (done) return res.destroy();
        done = true;
        clearTimeout(timer);
        resolve(res);
      });
      parts.push(req);
      req.on("error", fail);
      req.end();
    };
    const proxy = proxyFor(url);
    if (!proxy) return send();
    const connect = (proxy.protocol === "https:" ? https : http).request({
      host: proxy.hostname,
      port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: `${url.hostname}:${port}`,
      headers: proxy.username
        ? { "Proxy-Authorization": `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}` }
        : {},
    });
    parts.push(connect);
    connect.on("error", fail);
    connect.on("connect", (res, socket) => {
      parts.push(socket);
      if (res.statusCode !== 200) return fail(new Error(`the proxy refused the connection (${res.statusCode})`));
      send({ agent: false, createConnection: () => tls.connect({ socket, servername: url.hostname }) });
    });
    connect.end();
  });
}

function httpError(status, url) {
  const error = new Error(`HTTP ${status} from ${new URL(url).hostname}`);
  error.fatal = status >= 400 && status < 500 && status !== 408 && status !== 429;
  return error;
}

// One pass over the redirects and the body. Leaves the bytes received so far in `part`.
async function fetchInto(url, part, { stallMs, size, onProgress }) {
  let current = url;
  for (let hop = 0; hop < 10; hop += 1) {
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const headers = { "User-Agent": "synergy-studio-lite", "Accept-Encoding": "identity" };
    if (have > 0) headers.Range = `bytes=${have}-`;
    const res = await requestOnce(current, headers, stallMs);
    const status = res.statusCode;
    if (REDIRECTS.has(status) && res.headers.location) {
      res.resume();
      current = new URL(res.headers.location, current).href;
      continue;
    }
    if (status === 416) {
      res.resume();
      if (size && have === size) return;
      fs.rmSync(part, { force: true });
      continue;
    }
    if (status !== 200 && status !== 206) {
      res.resume();
      throw httpError(status, current);
    }
    const resumed = status === 206 && have > 0;
    if (status === 200 && have > 0) fs.rmSync(part, { force: true });
    const start = resumed ? have : 0;
    const total = Number(res.headers["content-length"] ?? 0) + start;
    let received = start;
    let timer;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const error = new Error(`stalled: no data for ${stallMs / 1000} s`);
        res.destroy(error);
        res.socket?.destroy();
      }, stallMs);
    };
    bump();
    res.on("data", (chunk) => {
      received += chunk.length;
      bump();
      if (onProgress) onProgress(received, total);
    });
    try {
      await pipeline(res, fs.createWriteStream(part, { flags: resumed ? "a" : "w" }));
    } finally {
      clearTimeout(timer);
    }
    return;
  }
  throw new Error("too many redirects");
}

async function passesChecks(file, { sha256, size }) {
  if (!fs.existsSync(file)) return false;
  if (size && fs.statSync(file).size !== size) return false;
  if (sha256 && (await sha256File(file)) !== sha256) return false;
  return true;
}

export async function download(url, dest, opts = {}) {
  const { sha256, size, onProgress, stallMs = 30000, attempts = 6, log = () => {} } = opts;
  if (await passesChecks(dest, { sha256, size })) {
    return { sha256: await sha256File(dest), bytes: fs.statSync(dest).size, reused: true };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let lastMessage = "unknown error";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fetchInto(url, part, { stallMs, size, onProgress });
      const bytes = fs.existsSync(part) ? fs.statSync(part).size : 0;
      if (size && bytes < size) throw new Error(`incomplete: ${bytes} of ${size} bytes`);
      if (size && bytes > size) {
        fs.rmSync(part, { force: true });
        throw new Error(`too large: ${bytes} bytes, expected ${size}`);
      }
      const actual = await sha256File(part);
      if (sha256 && actual !== sha256) {
        fs.rmSync(part, { force: true });
        throw new Error("the downloaded file does not match its checksum");
      }
      fs.renameSync(part, dest);
      return { sha256: actual, bytes, reused: false };
    } catch (error) {
      if (error.fatal) throw new Error(`download failed: ${error.message} (${url})`);
      lastMessage = error.message;
      log(`download attempt ${attempt} of ${attempts} failed: ${lastMessage}${attempt < attempts ? "; trying again" : ""}`);
      if (attempt < attempts) await sleep(Math.min(2000 * attempt, 10000));
    }
  }
  throw new Error(`download failed after ${attempts} tries: ${lastMessage} (${url}). Check the network and run setup again; it continues where it stopped.`);
}

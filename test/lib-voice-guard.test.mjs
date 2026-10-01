// studio voice survives the voice engine crashing while Python shuts down, and only then (voice.py, lib/voice.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STUDIO = path.join(ROOT, "skills", "synergy-studio", "scripts", "studio.mjs");
const HOME = process.env.SYNERGY_STUDIO_HOME || path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite");
const ready = fs.existsSync(path.join(HOME, "env.json"));

function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ss-voice-guard-"));
  fs.writeFileSync(path.join(d, "project.json"), JSON.stringify({ name: "guard", scenes: [{ id: "s1", say: "Open at 7 a.m. Then coffee." }] }));
  return d;
}
const voice = (d, extra) => spawnSync(process.execPath, [STUDIO, "voice", d, "--no-listen"], { encoding: "utf8", env: { ...process.env, ...extra } });

test("a crash after every file is written is accepted with a note", { skip: !ready && "tool home not set up" }, () => {
  const d = project();
  const r = voice(d, { SS_TEST_ABORT_AFTER_DONE: "1" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /crashed while closing .* after every file of this run was written/);
  assert.ok(fs.existsSync(path.join(d, "audio", "vo", "s1.wav")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, "audio", "voice-report.json"), "utf8")).s1.spoken, "Open at 7 AM. Then coffee.");
  fs.rmSync(d, { recursive: true, force: true });
});

test("a crash before the run finished fails, even when an older run left its marker", { skip: !ready && "tool home not set up" }, () => {
  const d = project();
  assert.equal(voice(d, {}).status, 0);                                   // leaves a marker of an earlier run
  const r = voice(d, { SS_TEST_ABORT_BEFORE_DONE: "1" });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /voice\.py stopped/);
  fs.rmSync(d, { recursive: true, force: true });
});

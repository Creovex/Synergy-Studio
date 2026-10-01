// lib/listen.mjs: what Whisper heard compared with what the voice was given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareHeard, numberWords } from "../skills/synergy-studio/scripts/lib/listen.mjs";

const heard = (s) => s.split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.2 }));

test("numbers become words", () => {
  assert.equal(numberWords(2), "two");
  assert.equal(numberWords(1500), "one thousand five hundred");
  assert.equal(numberWords(31000), "thirty one thousand");
});

for (const [name, expected, got] of [
  ["time read cleanly", "Still house hunting at 2 AM?", "Still house hunting at 2 a.m."],
  ["brand heard with a space", "Ask Orbit on AllSpace. Link in bio.", "Ask orbit on all space. Link in bio."],
  ["digits against words", "Over 1,500 homes.", "Over one thousand five hundred homes."],
  ["spelling variant", "We organise your search.", "We organize your search."],
  ["brand heard in pieces", "LSPedia checks every box.", "LSP Dia checks every box."],
  ["symbols Whisper writes for words", "Over 90 percent water and more.", "Over 90% water & more."],
  ["short forms Whisper writes for words the voice said in full", "Ask Doctor Lee at Saint Mary Street, for example today.", "Ask Dr. Lee at St. Mary Street, e.g. today."],
]) test(`no problem: ${name}`, () => assert.deepEqual(compareHeard(expected, heard(got)), []));

test("a word broken by a pause (the 2 a.m. case) is found, with its time", () => {
  assert.deepEqual(compareHeard("Still house hunting at 2 AM?", heard("Still house hunting at 2A, M.")), [{ expected: "am", heard: "2A, M.", at: 1.2, broken: true }]);
});

test("a wrong word is found alone, not hidden in a longer run", () => {
  assert.deepEqual(compareHeard("Ask Orbit on AllSpace. Link in bio.", heard("Ask orbit on all space. Lick in bio.")), [{ expected: "link", heard: "Lick", at: 1.5, broken: false }]);
});

test("a missing word and a garbled brand are found", () => {
  assert.deepEqual(compareHeard("It finds the right place fast.", heard("It finds the place fast.")).map((p) => p.expected), ["right"]);
  assert.deepEqual(compareHeard("OneScan by LSPedia.", heard("One skin by Elsa Pedia.")).map((p) => p.heard), ["One skin", "Elsa Pedia."]);
});

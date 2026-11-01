import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, looksRepetitive } from "./ollama.mjs";

test("looksRepetitive catches a short unit repeated through the whole window", () => {
  assert.equal(looksRepetitive("{\"tests\": [" + "0,".repeat(1800)), true);
  assert.equal(looksRepetitive("x".repeat(300) + " ".repeat(3000)), true);
  assert.equal(looksRepetitive("prefix " + '{"a": 1}, '.repeat(400)), true);
});

test("looksRepetitive leaves short and varied output alone", () => {
  assert.equal(looksRepetitive("0,".repeat(1400)), false, "shorter than the window");
  const varied = Array.from({ length: 1200 }, (_, i) => `[${i}, ${i * 7 % 13}]`).join(", ");
  assert.equal(looksRepetitive(varied), false);
  assert.equal(looksRepetitive("0,".repeat(1800) + "1"), false, "the tail breaks the unit");
  const grid = "[" + Array.from({ length: 12 }, () => "[" + '".",'.repeat(20).slice(0, -1) + "]").join(",") + "]";
  assert.equal(looksRepetitive('{"tests": [' + grid), false, "a 240-cell grid is data, not a runaway");
});

test("extractJson reads the first object, with or without a fence", () => {
  assert.deepEqual(extractJson('```json\n{"a": [1, 2]}\n```'), { a: [1, 2] });
  assert.deepEqual(extractJson('noise {"a": 1} noise'), { a: 1 });
  assert.throws(() => extractJson('{"a": [1, 2}'), /near:/);
  assert.throws(() => extractJson('no object here'), /JSON 객체를 찾을 수 없음/);
});

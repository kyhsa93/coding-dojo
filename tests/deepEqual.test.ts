import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { deepEqual, formatValue, previewValue, toJson } from "../src/lib/deepEqual.ts";
// The comparison used before this policy was written down; problems must be judged the same way by both.
import { deepEqual as previousDeepEqual, loadSolution, runCase } from "../scripts/lib/problem-utils.mjs";

describe("deepEqual policy", () => {
  it("compares integers exactly", () => {
    assert.equal(deepEqual(3, 3), true);
    assert.equal(deepEqual(3, 4), false);
    assert.equal(deepEqual(2 ** 52, 2 ** 52 + 1), false);
  });

  it("allows 1e-6 between non-integers by default, or the problem's tolerance", () => {
    assert.equal(deepEqual(0.1 + 0.2, 0.3), true);
    assert.equal(deepEqual(0.038, 0.0380004), true);
    assert.equal(deepEqual(0.038, 0.039), false);
    assert.equal(deepEqual(2.9999999999, 3), true, "a float result for an integer answer");
    assert.equal(deepEqual(0.5, 0.505, { tolerance: 0.01 }), true);
    assert.equal(deepEqual(0.1 + 0.2, 0.3, { tolerance: 0 }), false);
  });

  it("scales the tolerance for large floats", () => {
    assert.equal(deepEqual(1e12 + 0.001, 1e12 + 0.002), true);
    assert.equal(deepEqual(1e12 + 0.001, 1e12), false, "not against an integer answer");
    assert.equal(deepEqual(1e12 + 500.5, 1e12), false);
  });

  it("only lets NaN and Infinity equal themselves", () => {
    assert.equal(deepEqual(NaN, NaN), true);
    assert.equal(deepEqual(NaN, 0), false);
    assert.equal(deepEqual(Infinity, Infinity), true);
    assert.equal(deepEqual(Infinity, 1e308), false);
    assert.equal(deepEqual(Infinity, "Infinity"), false);
  });

  it("compares bigint exactly inside the safe range and at double precision beyond it", () => {
    assert.equal(deepEqual(10n ** 18n, 1e18), true);
    assert.equal(deepEqual(5n, 5), true);
    assert.equal(deepEqual(5n, 6), false);
    assert.equal(deepEqual(5n, 5.5), false);
    assert.equal(deepEqual(2n ** 60n + 1n, 2 ** 60), true, "the JSON expected value cannot hold the extra 1");
    assert.equal(deepEqual(2n ** 60n, 2n ** 60n + 1n), false);
  });

  it("treats null and undefined alike", () => {
    assert.equal(deepEqual(undefined, null), true);
    assert.equal(deepEqual(null, 0), false);
    assert.equal(deepEqual([undefined], [null]), true);
  });

  it("never equates an array with an object", () => {
    // Used to be true: both have keys "0" and "1".
    assert.equal(deepEqual([1, 2], { 0: 1, 1: 2 }), false);
    assert.equal(deepEqual({ 0: 1 }, [1]), false);
  });

  it("compares nested structures by value and object keys regardless of order", () => {
    assert.equal(deepEqual({ a: [1, { b: 2 }], c: null }, { c: null, a: [1, { b: 2 }] }), true);
    assert.equal(deepEqual({ a: 1 }, { a: 1, b: undefined }), false);
    assert.equal(deepEqual([[1], [2]], [[1], [2, 3]]), false);
  });
});

describe("toJson", () => {
  it("normalises runtime values", () => {
    assert.equal(toJson(undefined), null);
    assert.deepEqual(toJson(new Set([3, 1])), [3, 1]);
    assert.deepEqual(toJson(new Map<unknown, unknown>([[1, "a"]])), { 1: "a" });
    assert.deepEqual(toJson(new Int32Array([1, 2])), [1, 2]);
    assert.deepEqual(toJson(new BigInt64Array([1n, 2n ** 60n])), [1, 2n ** 60n]);
    assert.equal(toJson(10n), 10);
    assert.equal(toJson(2n ** 60n), 2n ** 60n);
    assert.ok(Number.isNaN(toJson(NaN)));
  });

  it("throws a readable error on circular references and allows shared ones", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    assert.throws(() => toJson(o), /순환 참조/);
    const shared = [1];
    assert.deepEqual(toJson([shared, shared]), [[1], [1]]);
  });
});

describe("formatValue", () => {
  it("shows bigint, NaN and Infinity as written", () => {
    assert.equal(formatValue([1n, NaN, -Infinity, "a", { k: null }]), '[1,NaN,-Infinity,"a",{"k":null}]');
    assert.equal(formatValue(undefined), "undefined");
  });
  it("cuts long previews", () => {
    const text = previewValue(Array.from({ length: 2000 }, (_, i) => i), 50);
    assert.ok(text.length < 80);
    assert.match(text, /자 생략/);
  });
});

describe("regression: every problem is judged as before", () => {
  const dir = new URL("../problems/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(file, () => {
      const p = JSON.parse(readFileSync(new URL(file, dir), "utf-8"));
      const fn = loadSolution(p.solution, p.functionName);
      for (const t of [...p.examples, ...p.tests]) {
        const actual = runCase(fn, t.input, 10_000);
        assert.equal(deepEqual(actual, t.expected, { tolerance: p.tolerance }), true, `reference solution passes ${JSON.stringify(t.input).slice(0, 80)}`);
        // Near misses must be judged the same way as well.
        for (const wrong of mutations(t.expected)) {
          assert.equal(deepEqual(wrong, t.expected), previousDeepEqual(wrong, t.expected), `same verdict for ${JSON.stringify(wrong).slice(0, 80)}`);
        }
      }
    });
  }
});

/** Plausible wrong answers: off by one, slightly off, empty, wrong type. */
function mutations(v: unknown): unknown[] {
  if (typeof v === "number") return [v + 1, v - 1, v + 1e-9, v + 1e-3, String(v), null];
  if (Array.isArray(v)) return [[], [...v, 0], v.slice(1), v.map((x) => (typeof x === "number" ? x + 1 : x))];
  if (typeof v === "string") return ["", v + " ", v.toUpperCase() === v ? v.toLowerCase() : v.toUpperCase()];
  if (typeof v === "boolean") return [!v, Number(v)];
  if (v && typeof v === "object") return [{}, { ...v, extra: 1 }];
  return [0, false, ""];
}

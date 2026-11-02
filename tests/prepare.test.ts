import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODULE_PARAMS, moduleArgs, prepareJs } from "../src/judge/prepare.ts";
import type { Language } from "../src/lib/types.ts";

/** Prepares and evaluates like the runner does, returning `f` (or throwing). */
function load(code: string, language: Language = "javascript"): (...a: unknown[]) => unknown {
  const body = `"use strict";\n${prepareJs(code, language)}\n;return f;`;
  return new Function(...MODULE_PARAMS, body)(...moduleArgs()) as (...a: unknown[]) => unknown;
}

describe("prepareJs", () => {
  it("does not let an import without a semicolon swallow the next statement", () => {
    // The old line regex deleted everything up to `const b = 1;`.
    const f = load(`function f(a) {\n  const b = 1;\n  return a + b\n}\nexport { f }`);
    assert.equal(f(1), 2);
    assert.throws(() => load(`import { x } from "y"\nfunction f(a) {\n  const b = 1;\n  return a + b\n}`), /외부 모듈 'y'/);
  });

  it("leaves export/import text inside strings and comments alone", () => {
    const f = load("function f() {\n  return `\nexport const z = 1;\nimport q from 'r';\n` // export default\n}");
    assert.equal(f(), "\nexport const z = 1;\nimport q from 'r';\n");
  });

  it("accepts the export forms", () => {
    assert.equal(load("export default function f() { return 1 }")(), 1);
    assert.equal(load("export default async function f() { return 1 }").constructor.name, "AsyncFunction");
    assert.equal(load("export const f = (a) => a * 2")(2), 4);
    assert.equal(load("function f() { return 3 }\nexport default f;")(), 3);
    assert.equal(load("export {\n  f,\n}\nfunction f() { return 4 }")(), 4);
  });

  it("strips TypeScript types, keeps enums, drops type-only imports", () => {
    const code = `import type { Foo } from "./foo";\nenum Dir { Up, Down }\ninterface P { x: number }\nexport function f(p: P, d: Dir = Dir.Down): number {\n  return p.x + (d as number);\n}`;
    assert.equal(load(code, "typescript")({ x: 1 }), 2);
  });

  it("keeps line numbers so errors point at the editor line", () => {
    const out = prepareJs(`import type { A } from "a";\n\nfunction f(a: A): number {\n  return 1;\n}`, "typescript");
    assert.equal(out.split("\n").findIndex((l) => l.includes("return 1")), 3);
  });

  it("reports syntax errors with a position", () => {
    assert.throws(() => prepareJs("function f(a: number): number {\n  return a +\n}", "typescript"), /\(3:1\)/);
    assert.throws(() => prepareJs("function f( {\n return 1\n}", "javascript"), /\(2:\d+\)/);
  });
});

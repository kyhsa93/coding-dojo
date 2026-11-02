import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunMessage, WorkerMessage } from "../src/judge/protocol.ts";
import { runJs } from "../src/judge/runner.ts";
import type { Language } from "../src/lib/types.ts";

function run(code: string, inputs: unknown[][] = [[1]], language: Language = "javascript"): WorkerMessage[] {
  const out: WorkerMessage[] = [];
  const req = { kind: "run", id: "r", language, code, functionName: "f", inputs } as RunMessage;
  runJs(req, (m) => out.push(m));
  return out;
}

function failure(msgs: WorkerMessage[]) {
  const m = msgs.find((x) => x.kind === "failed");
  return m && m.kind === "failed" ? m.failure : undefined;
}

describe("runJs", () => {
  it("returns raw values for the main thread to grade", () => {
    const msgs = run("function f(a) { return [a, a * 2] }", [[1], [2]]);
    const outcomes = msgs.flatMap((m) => (m.kind === "test" ? [m.outcome] : []));
    assert.deepEqual(
      outcomes.map((o) => (o.ok ? o.actual : o.error)),
      [
        [1, 2],
        [2, 4],
      ],
    );
    assert.equal(msgs.at(-1)?.kind, "done");
  });

  it("separates syntax errors from top-level runtime errors", () => {
    assert.equal(failure(run("function f( {"))?.kind, "syntax");
    assert.match(failure(run("function f( {\n}"))!.message, /줄 2, 열/);
    const top = failure(run("const x = 1;\nnull.y;\nfunction f() {}"));
    assert.equal(top?.kind, "toplevel");
    assert.match(top!.message, /TypeError.*\(줄 2\)/);
    assert.match(failure(run("function g() {}"))!.message, /함수 f/);
  });

  it("reports runtime errors per test with the editor line", () => {
    const msgs = run("function f(a) {\n  if (a > 1) throw new RangeError('big');\n  return a;\n}", [[1], [2]]);
    const outcomes = msgs.flatMap((m) => (m.kind === "test" ? [m.outcome] : []));
    assert.equal(outcomes[0].ok, true);
    assert.equal(outcomes[1].ok, false);
    assert.equal(!outcomes[1].ok && outcomes[1].error, "RangeError: big (줄 2)");
  });

  it("points TypeScript errors at the original line", () => {
    const msgs = run("type N = number;\n\nfunction f(a: N): N {\n  return (a as any).x.y;\n}", [[1]], "typescript");
    const o = msgs.find((m) => m.kind === "test");
    assert.ok(o?.kind === "test" && !o.outcome.ok && o.outcome.error.endsWith("(줄 4)"));
  });

  it("gives each test its own copy of the input", () => {
    const msgs = run("function f(a) { a.push(9); return a.length }", [[[1]], [[1]]]);
    const values = msgs.flatMap((m) => (m.kind === "test" && m.outcome.ok ? [m.outcome.actual] : []));
    assert.deepEqual(values, [2, 2]);
  });

  it("captures console output and caps it", () => {
    const msgs = run("function f(a) { console.log('a', {x: a}, [1n]); return a }");
    const done = msgs.at(-1);
    assert.ok(done?.kind === "done");
    assert.equal(done.stdout, 'a {"x":1} [1]\n');
    const flood = run("function f() { for (let i = 0; i < 1e5; i++) console.log('x'.repeat(10)); }").at(-1);
    assert.ok(flood?.kind === "done" && flood.stdout.length === 20_000);
  });

  it("reports an unconvertible return value as an error, not a crash", () => {
    const msgs = run("function f() { const o = {}; o.o = o; return o }");
    const o = msgs.find((m) => m.kind === "test");
    assert.ok(o?.kind === "test" && !o.outcome.ok && /순환 참조/.test(o.outcome.error));
  });
});

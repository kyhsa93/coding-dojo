import { formatValue, toJson } from "../lib/deepEqual.ts";
import type { JsonValue, JudgeValue } from "../lib/types";
import { MODULE_PARAMS, moduleArgs, prepareJs } from "./prepare.ts";
import type { Post, RunMessage, TestOutcome } from "./protocol";

const MAX_STDOUT = 20_000;

/** Collects console / print output for one run, capped so a print in a hot loop cannot flood the page. */
export class Output {
  private text = "";
  append(chunk: string) {
    if (this.text.length < MAX_STDOUT) this.text += chunk.slice(0, MAX_STDOUT - this.text.length);
  }
  toString() {
    return this.text;
  }
}

export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

export function missingFunction(name: string): string {
  return `함수 ${name} 을(를) 찾을 수 없습니다. 함수 이름을 바꾸지 마세요.`;
}

/** Calls the submission once per input and reports what it returned; the caller compares. */
export function judgeEach(id: string, inputs: JsonValue[][], post: Post, invoke: (args: JsonValue[]) => unknown, describe: (e: unknown) => string) {
  for (let index = 0; index < inputs.length; index++) {
    const started = performance.now();
    let outcome: TestOutcome;
    try {
      const actual: JudgeValue = toJson(invoke(structuredClone(inputs[index])));
      outcome = { index, ok: true, actual, durationMs: performance.now() - started };
    } catch (e) {
      outcome = { index, ok: false, error: describe(e), durationMs: performance.now() - started };
    }
    post({ id, kind: "test", outcome });
  }
}

const SOURCE_URL = "solution.js";

/**
 * Lines that `new Function` puts before the body (`function anonymous(a, b\n) {\n` in V8), measured once with a
 * probe because engines differ. Used to turn stack positions into the line the user sees in the editor.
 */
let headerLines: number | undefined;
function functionHeaderLines(): number {
  if (headerLines === undefined) {
    headerLines = 0;
    try {
      const stack = new Function(...MODULE_PARAMS, "console", "return new Error().stack;\n//# sourceURL=dojo-probe.js")() as string | undefined;
      const m = /dojo-probe\.js:(\d+):/.exec(stack ?? "");
      if (m) headerLines = Number(m[1]) - 1;
    } catch {
      /* keep 0: messages lose their line number, nothing else */
    }
  }
  return headerLines;
}

/** `name: message (줄 N)` where N is the submission's own line when the stack points into it. */
function describeJsError(e: unknown): string {
  const text = describeError(e);
  if (!(e instanceof Error) || typeof e.stack !== "string") return text;
  const m = new RegExp(`${SOURCE_URL.replace(".", "\\.")}:(\\d+):(\\d+)`).exec(e.stack);
  if (!m) return text;
  // One extra line: the body starts with "use strict".
  const line = Number(m[1]) - functionHeaderLines() - 1;
  return line >= 1 ? `${text} (줄 ${line})` : text;
}

/** Runs a JavaScript or TypeScript submission against every input. */
export function runJs(req: RunMessage, post: Post) {
  const out = new Output();
  const print = (...args: unknown[]) => out.append(args.map(show).join(" ") + "\n");
  const fakeConsole = { log: print, error: print, warn: print, info: print, debug: print };

  let src: string;
  try {
    src = prepareJs(req.code, req.language);
  } catch (e) {
    // Sucrase reports positions as "(line:column)".
    const message = describeError(e).replace(/\((\d+):(\d+)\)$/, "(줄 $1, 열 $2)");
    post({ id: req.id, kind: "failed", failure: { kind: "syntax", message }, stdout: "" });
    return;
  }
  let factory: (...args: unknown[]) => unknown;
  try {
    const body = `"use strict";\n${src}\n;return typeof ${req.functionName} === "function" ? ${req.functionName} : undefined;\n//# sourceURL=${SOURCE_URL}`;
    factory = new Function(...MODULE_PARAMS, "console", body) as typeof factory;
  } catch (e) {
    post({ id: req.id, kind: "failed", failure: { kind: "syntax", message: describeError(e) }, stdout: "" });
    return;
  }
  let fn: unknown;
  try {
    fn = factory(...moduleArgs(), fakeConsole);
  } catch (e) {
    post({ id: req.id, kind: "failed", failure: { kind: "toplevel", message: describeJsError(e) }, stdout: out.toString() });
    return;
  }
  if (typeof fn !== "function") {
    post({ id: req.id, kind: "failed", failure: { kind: "toplevel", message: missingFunction(req.functionName) }, stdout: out.toString() });
    return;
  }
  const call = fn as (...a: unknown[]) => unknown;
  judgeEach(req.id, req.inputs, post, (args) => call(...args), describeJsError);
  post({ id: req.id, kind: "done", stdout: out.toString() });
}

function show(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return formatValue(toJson(v));
  } catch {
    return String(v);
  }
}

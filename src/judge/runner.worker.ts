/// <reference lib="webworker" />
import { deepEqual, toJson } from "../lib/deepEqual";
import type { JsonValue, RunRequest, TestCase, TestResult } from "../lib/types";
import { prepareJs } from "./prepare";

type Progress = { kind: "test"; result: TestResult } | { kind: "done"; stdout: string } | { kind: "compileError"; message: string; stdout: string };

const post = (msg: Progress) => (self as unknown as Worker).postMessage(msg);

let stdout = "";
const MAX_STDOUT = 20_000;
function appendStdout(text: string) {
  if (stdout.length < MAX_STDOUT) stdout += text.slice(0, MAX_STDOUT - stdout.length);
}

function judge(index: number, test: TestCase, invoke: (args: JsonValue[]) => unknown): TestResult {
  const started = performance.now();
  try {
    const raw = invoke(structuredClone(test.input));
    const actual = toJson(raw);
    const status = deepEqual(actual, test.expected) ? "pass" : "fail";
    return { index, status, expected: test.expected, actual, durationMs: performance.now() - started };
  } catch (e) {
    return { index, status: "error", expected: test.expected, error: describeError(e), durationMs: performance.now() - started };
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

function runJs(req: RunRequest) {
  const fakeConsole = {
    log: (...args: unknown[]) => appendStdout(args.map(stringify).join(" ") + "\n"),
    error: (...args: unknown[]) => appendStdout(args.map(stringify).join(" ") + "\n"),
    warn: (...args: unknown[]) => appendStdout(args.map(stringify).join(" ") + "\n"),
    info: (...args: unknown[]) => appendStdout(args.map(stringify).join(" ") + "\n"),
  };
  let fn: unknown;
  try {
    const src = prepareJs(req.code, req.language);
    const factory = new Function("console", `"use strict";\n${src}\n;return typeof ${req.functionName} === "function" ? ${req.functionName} : undefined;`);
    fn = factory(fakeConsole);
  } catch (e) {
    post({ kind: "compileError", message: describeError(e), stdout });
    return;
  }
  if (typeof fn !== "function") {
    post({ kind: "compileError", message: `함수 ${req.functionName} 을(를) 찾을 수 없습니다. 함수 이름을 바꾸지 마세요.`, stdout });
    return;
  }
  for (let i = 0; i < req.tests.length; i++) {
    post({ kind: "test", result: judge(i, req.tests[i], (args) => (fn as (...a: unknown[]) => unknown)(...args)) });
  }
  post({ kind: "done", stdout });
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(toJson(v));
  } catch {
    return String(v);
  }
}

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs";

interface PyProxy {
  toJs(opts?: { dict_converter?: (entries: Iterable<[unknown, unknown]>) => unknown }): unknown;
  destroy?(): void;
  callKwargs?(...args: unknown[]): unknown;
}
interface Pyodide {
  runPython(code: string, opts?: { globals?: unknown }): unknown;
  globals: { get(name: string): unknown; set(name: string, value: unknown): void };
  toPy(value: unknown): unknown;
  setStdout(opts: { batched: (text: string) => void }): void;
  setStderr(opts: { batched: (text: string) => void }): void;
}

let pyodidePromise: Promise<Pyodide> | null = null;
function loadPyodideOnce(): Promise<Pyodide> {
  if (!pyodidePromise) {
    pyodidePromise = import(/* @vite-ignore */ PYODIDE_URL).then((mod: { loadPyodide: (o: { indexURL: string }) => Promise<Pyodide> }) =>
      mod.loadPyodide({ indexURL: PYODIDE_URL.replace(/pyodide\.mjs$/, "") }),
    );
  }
  return pyodidePromise;
}

function fromPy(value: unknown): unknown {
  if (value && typeof value === "object" && typeof (value as PyProxy).toJs === "function") {
    const proxy = value as PyProxy;
    const js = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy?.();
    return js;
  }
  return value;
}

async function runPython(req: RunRequest) {
  let py: Pyodide;
  try {
    py = await loadPyodideOnce();
  } catch (e) {
    post({ kind: "compileError", message: `Python 런타임을 불러오지 못했습니다: ${describeError(e)}`, stdout });
    return;
  }
  py.setStdout({ batched: (t) => appendStdout(t + "\n") });
  py.setStderr({ batched: (t) => appendStdout(t + "\n") });
  let fn: unknown;
  try {
    py.runPython(req.code);
    fn = py.globals.get(req.functionName);
  } catch (e) {
    post({ kind: "compileError", message: describeError(e), stdout });
    return;
  }
  if (typeof fn !== "function") {
    post({ kind: "compileError", message: `함수 ${req.functionName} 을(를) 찾을 수 없습니다. 함수 이름을 바꾸지 마세요.`, stdout });
    return;
  }
  for (let i = 0; i < req.tests.length; i++) {
    post({
      kind: "test",
      result: judge(i, req.tests[i], (args) => {
        const pyArgs = args.map((a) => py.toPy(a));
        return fromPy((fn as (...a: unknown[]) => unknown)(...pyArgs));
      }),
    });
  }
  post({ kind: "done", stdout });
}

self.onmessage = async (ev: MessageEvent<RunRequest>) => {
  const req = ev.data;
  if (req.kind !== "run") return;
  stdout = "";
  if (req.language === "python") await runPython(req);
  else runJs(req);
};

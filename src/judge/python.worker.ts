/// <reference lib="webworker" />
import { lockDown } from "./lockdown.ts";
import type { Post, RunMessage } from "./protocol";
import { describeError, judgeEach, missingFunction, Output } from "./runner.ts";

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs";

interface PyProxy {
  (...args: unknown[]): unknown;
  toJs(opts?: { dict_converter?: (entries: Iterable<[unknown, unknown]>) => unknown; create_pyproxies?: boolean }): unknown;
  destroy(): void;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  clear(): void;
}
interface Pyodide {
  runPython(code: string, opts?: { globals?: PyProxy }): unknown;
  globals: PyProxy;
  toPy(value: unknown): unknown;
  ffi: { PyProxy: abstract new (...args: never[]) => PyProxy };
  setStdout(opts: { batched: (text: string) => void }): void;
  setStderr(opts: { batched: (text: string) => void }): void;
}

const post: Post = self.postMessage.bind(self);
let py: Pyodide | undefined;

// The worker downloads Pyodide as soon as it starts and takes runs only after reporting ready, so a run that is
// cancelled while waiting never reaches it. A failed download leaves the worker for the main thread to replace:
// a fresh worker retries from scratch instead of reusing a cached rejection or a half-initialised runtime.
async function boot() {
  post({ kind: "runtime", state: "loading" });
  try {
    const mod = (await import(/* @vite-ignore */ PYODIDE_URL)) as { loadPyodide(o: { indexURL: string }): Promise<Pyodide> };
    py = await mod.loadPyodide({ indexURL: PYODIDE_URL.replace(/pyodide\.mjs$/, "") });
  } catch (e) {
    post({ kind: "runtime", state: "failed", error: `Python 런타임을 불러오지 못했습니다: ${describeError(e)}` });
    return;
  }
  lockDown();
  post({ kind: "runtime", state: "ready" });
}

self.addEventListener("message", (ev: MessageEvent<RunMessage>) => {
  if (ev.data?.kind === "run" && py) runPython(py, ev.data);
});
void boot();

function isProxy(py: Pyodide, value: unknown): value is PyProxy {
  return value instanceof py.ffi.PyProxy;
}

/** Keeps the traceback from the submission's first frame on, dropping Pyodide's own frames. */
function pythonError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const lines = text.trimEnd().split("\n");
  const start = lines.findIndex((l) => l.includes('File "<exec>"'));
  if (start >= 0) return lines.slice(start).join("\n");
  return lines.at(-1) ?? text;
}

function isSyntaxError(e: unknown): boolean {
  const type = (e as { type?: string } | null)?.type;
  return type === "SyntaxError" || type === "IndentationError" || type === "TabError";
}

function runPython(py: Pyodide, req: RunMessage) {
  const out = new Output();
  py.setStdout({ batched: (t) => out.append(t + "\n") });
  py.setStderr({ batched: (t) => out.append(t + "\n") });
  // A fresh namespace per run: definitions from an earlier submission (or another problem) cannot leak in.
  const ns = (py.globals.get("dict") as PyProxy)() as PyProxy;
  ns.set("__name__", "__main__");
  let fn: unknown;
  const stdout = () => {
    // print(..., end="") stays in Pyodide's line buffer until flushed and would otherwise surface in the next run.
    try {
      py.runPython("import sys\nsys.stdout.flush()\nsys.stderr.flush()");
    } catch {
      /* nothing to flush */
    }
    return out.toString();
  };
  try {
    try {
      py.runPython(req.code, { globals: ns });
    } catch (e) {
      post({ id: req.id, kind: "failed", failure: { kind: isSyntaxError(e) ? "syntax" : "toplevel", message: pythonError(e) }, stdout: stdout() });
      return;
    }
    fn = ns.get(req.functionName);
    if (typeof fn !== "function") {
      post({ id: req.id, kind: "failed", failure: { kind: "toplevel", message: missingFunction(req.functionName) }, stdout: stdout() });
      return;
    }
    const call = fn as PyProxy;
    judgeEach(req.id, req.inputs, post, (args) => callPython(py, call, args), pythonError);
    post({ id: req.id, kind: "done", stdout: stdout() });
  } finally {
    if (isProxy(py, fn)) fn.destroy();
    try {
      ns.clear();
    } catch {
      /* the runtime is broken; checked below */
    }
    ns.destroy();
    checkAlive(py);
  }
}

/** Converts arguments in and the result out, destroying every proxy it made so repeated runs do not leak. */
function callPython(py: Pyodide, fn: PyProxy, args: unknown[]): unknown {
  const pyArgs = args.map((a) => py.toPy(a));
  try {
    const result = fn(...pyArgs);
    if (!isProxy(py, result)) return result;
    try {
      // create_pyproxies: false turns an unconvertible result (a custom object) into an error for this test
      // instead of a proxy that postMessage cannot clone.
      return result.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false });
    } finally {
      result.destroy();
    }
  } finally {
    for (const a of pyArgs) if (isProxy(py, a)) a.destroy();
  }
}

/** After a fatal error (e.g. a JS stack overflow inside Pyodide) every later call fails; hand the worker back. */
function checkAlive(py: Pyodide) {
  try {
    py.runPython("1");
  } catch (e) {
    post({ kind: "runtime", state: "failed", error: `Python 런타임이 손상되어 다시 시작합니다: ${describeError(e)}` });
  }
}

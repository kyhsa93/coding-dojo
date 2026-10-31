import type { Language, RunRequest, RunResponse, TestResult } from "../lib/types";

type Progress = { kind: "test"; result: TestResult } | { kind: "done"; stdout: string } | { kind: "compileError"; message: string; stdout: string };

const workers = new Map<Language, Worker>();

function getWorker(language: Language): Worker {
  let w = workers.get(language);
  if (!w) {
    w = new Worker(new URL("./runner.worker.ts", import.meta.url), { type: "module" });
    workers.set(language, w);
  }
  return w;
}

function discardWorker(language: Language) {
  workers.get(language)?.terminate();
  workers.delete(language);
}

/** Pre-loads the Python runtime so the first run does not stall. */
export function warmUp(language: Language) {
  getWorker(language);
}

export function runTests(req: Omit<RunRequest, "kind">, onProgress?: (r: TestResult) => void): Promise<RunResponse> {
  const language = req.language;
  // Python's first run has to download the runtime (~10 MB); give it room.
  const firstTestBudget = language === "python" ? 90_000 : req.timeoutMs;
  return new Promise((resolve) => {
    const worker = getWorker(language);
    const results: TestResult[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (resp: RunResponse) => {
      if (timer) clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      resolve(resp);
    };

    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        discardWorker(language);
        const next = results.length;
        const expected = req.tests[next]?.expected ?? null;
        results.push({ index: next, status: "timeout", expected, error: `${req.timeoutMs}ms 안에 끝나지 않았습니다`, durationMs: ms });
        for (let i = next + 1; i < req.tests.length; i++) {
          results.push({ index: i, status: "timeout", expected: req.tests[i].expected, error: "이전 테스트 시간 초과로 건너뜀", durationMs: 0 });
        }
        finish({ kind: "result", results, stdout: "" });
      }, ms);
    };

    worker.onmessage = (ev: MessageEvent<Progress>) => {
      const msg = ev.data;
      if (msg.kind === "test") {
        results.push(msg.result);
        onProgress?.(msg.result);
        arm(req.timeoutMs);
      } else if (msg.kind === "done") {
        finish({ kind: "result", results, stdout: msg.stdout });
      } else if (msg.kind === "compileError") {
        finish({ kind: "result", results: [], stdout: msg.stdout, compileError: msg.message });
      }
    };
    worker.onerror = (e) => {
      discardWorker(language);
      finish({ kind: "result", results, stdout: "", compileError: e.message || "worker error" });
    };

    arm(firstTestBudget);
    worker.postMessage({ kind: "run", ...req } satisfies RunRequest);
  });
}

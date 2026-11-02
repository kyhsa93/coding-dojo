import type { Language } from "../lib/types";
import jsWorkerUrl from "./js.worker.ts?worker&url";
import pythonWorkerUrl from "./python.worker.ts?worker&url";
import { createJudge, type WorkerLike } from "./session.ts";

export type { JudgeRequest, RunEvent, RunOptions } from "./session.ts";

/** Python may need to download about 10 MB on its first run; JavaScript only has to start a worker. */
export const LOAD_TIMEOUT_MS: Record<Language, number> = { javascript: 15_000, typescript: 15_000, python: 120_000 };

/**
 * In the production build a worker starts from a one-line blob module that imports the real script. Workers
 * started from blob URLs inherit the page's Content-Security-Policy (the meta tag vite.config.ts adds), which is
 * the only way to put one on them: GitHub Pages cannot send a CSP header with the worker script.
 */
const blobUrls = new Map<string, string>();
function workerUrl(src: string): string {
  const absolute = new URL(src, location.href).href;
  if (import.meta.env.DEV) return absolute;
  let url = blobUrls.get(absolute);
  if (!url) {
    url = URL.createObjectURL(new Blob([`import ${JSON.stringify(absolute)};\n`], { type: "text/javascript" }));
    blobUrls.set(absolute, url);
  }
  return url;
}

function spawn(language: Language): WorkerLike {
  const worker = new Worker(workerUrl(language === "python" ? pythonWorkerUrl : jsWorkerUrl), { type: "module", name: `judge-${language}` });
  return {
    post: (msg) => worker.postMessage(msg),
    terminate: () => worker.terminate(),
    listen(onMessage, onError) {
      worker.onmessage = (ev) => onMessage(ev.data);
      worker.onerror = (ev) => {
        ev.preventDefault();
        onError(ev.message || "워커 스크립트를 불러오지 못했습니다. 새 버전이 배포되었을 수 있으니 페이지를 새로 고쳐 주세요.");
      };
    },
  };
}

const judge = createJudge({ spawn, loadTimeoutMs: (language) => LOAD_TIMEOUT_MS[language] });

export const runTests = judge.run;
export const warmUp = judge.warmUp;

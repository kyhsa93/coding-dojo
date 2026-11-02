import { useEffect, useState } from "react";
import { previewValue } from "../lib/deepEqual";
import type { Language, RunFailure, RunResponse, TestCase, TestResult, TestStatus } from "../lib/types";

/** A run in progress: `starting` before the worker answers, `loading` while Python downloads, then `running`. */
export interface LiveRun {
  phase: "starting" | "loading" | "running";
  total: number;
  /** When the current phase began (performance.now()). */
  startedAt: number;
}

interface Props {
  response: RunResponse | null;
  partial: TestResult[];
  tests: TestCase[];
  live: LiveRun | null;
  mode: "examples" | "submit";
  language: Language;
  onShowSolution: () => void;
}

const FAILURE_TITLES: Record<RunFailure["kind"], string> = {
  syntax: "문법 오류",
  toplevel: "실행 오류 (함수 바깥 코드)",
  load: "실행 환경 오류",
};

export default function Results({ response, partial, tests, live, mode, language, onShowSolution }: Props) {
  if (!response && !live) {
    return <p className="muted">예제 실행 또는 제출을 눌러 결과를 확인하세요.</p>;
  }
  const label = mode === "submit" ? "채점" : "예제";
  if (live) {
    return (
      <div aria-busy="true">
        <p className="status">
          {/* The clock stays outside the live region: it changes ten times a second and would be read out. */}
          <span role="status">{live.phase === "loading" ? "Python 런타임을 내려받는 중… (처음 한 번, 약 10MB)" : `${label} 실행 중… ${partial.length} / ${live.total}`}</span> ·{" "}
          <Elapsed since={live.startedAt} />
        </p>
        <ResultList results={partial} tests={tests} hidden={mode === "submit"} />
      </div>
    );
  }
  const res = response!;
  if (res.failure) {
    return (
      <div>
        <p className="status fail" role="status">
          {FAILURE_TITLES[res.failure.kind]}
        </p>
        <pre className="error">{res.failure.message}</pre>
        {res.failure.kind === "load" && language === "python" && <p className="muted small">다시 실행하면 런타임을 처음부터 다시 내려받습니다.</p>}
        {res.stdout && <Stdout text={res.stdout} />}
      </div>
    );
  }
  const passed = res.results.filter((r) => r.status === "pass").length;
  const total = tests.length;
  const all = passed === total && total > 0;
  return (
    <div>
      <p className={`status ${all ? "pass" : "fail"}`} role="status">
        {res.cancelled ? `${label} 중단됨` : `${label} 결과`}: {passed} / {total} 통과
        {all && mode === "submit" && " 🎉"}
      </p>
      <p className="muted small timing">{timing(res)}</p>
      {all && mode === "submit" && (
        <p>
          <button className="ghost" onClick={onShowSolution}>
            참고 풀이 보기
          </button>
        </p>
      )}
      <ResultList results={res.results} tests={tests} hidden={mode === "submit"} />
      {res.stdout && <Stdout text={res.stdout} />}
    </div>
  );
}

function ResultList({ results, tests, hidden }: { results: TestResult[]; tests: TestCase[]; hidden: boolean }) {
  if (results.length === 0) return null;
  return (
    <ul className="results">
      {results.map((r) => {
        const t = tests[r.index];
        return (
          <li key={r.index} className={`result ${r.status}`}>
            <div className="result-head">
              <span>
                #{r.index + 1} {statusLabel(r.status)}
              </span>
              {r.status !== "skipped" && <span className="muted">{r.durationMs.toFixed(1)} ms</span>}
            </div>
            {(!hidden || r.status !== "pass") && t && r.status !== "skipped" && (
              <dl>
                <dt>입력</dt>
                <dd>{hidden ? <span className="muted">표시하지 않음</span> : <code>{t.input.map((v) => previewValue(v)).join(", ")}</code>}</dd>
                <dt>기대</dt>
                <dd>
                  <code>{previewValue(r.expected)}</code>
                </dd>
                {r.status === "fail" && (
                  <>
                    <dt>실제</dt>
                    <dd>
                      <code>{previewValue(r.actual)}</code>
                    </dd>
                  </>
                )}
                {r.error && (
                  <>
                    <dt>오류</dt>
                    <dd>
                      <pre className="inline-error">{r.error}</pre>
                    </dd>
                  </>
                )}
              </dl>
            )}
            {r.status === "skipped" && r.error && <p className="muted small">{r.error}</p>}
          </li>
        );
      })}
    </ul>
  );
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  return <>{elapsed(since)}</>;
}

function elapsed(since: number) {
  return `${((performance.now() - since) / 1000).toFixed(1)}초`;
}

function timing(res: RunResponse) {
  const parts: string[] = [];
  if (res.runMs !== undefined) parts.push(`실행 ${formatMs(res.runMs)}`);
  // Only worth mentioning when it was a real wait (Python's first run), not a worker start.
  if (res.loadMs !== undefined && res.loadMs >= 500) parts.push(`런타임 준비 ${formatMs(res.loadMs)}(채점 시간에 포함 안 됨)`);
  return parts.join(" · ");
}

function formatMs(ms: number) {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}초`;
}

function Stdout({ text }: { text: string }) {
  return (
    <details open>
      <summary>표준 출력</summary>
      <pre className="stdout">{text}</pre>
    </details>
  );
}

function statusLabel(s: TestStatus) {
  return { pass: "통과", fail: "실패", error: "오류", timeout: "시간 초과", skipped: "실행 안 함" }[s];
}

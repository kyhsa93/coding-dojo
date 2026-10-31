import { formatValue } from "../lib/deepEqual";
import type { RunResponse, TestCase } from "../lib/types";

interface Props {
  response: RunResponse | null;
  tests: TestCase[];
  running: boolean;
  mode: "examples" | "submit";
}

export default function Results({ response, tests, running, mode }: Props) {
  if (!response && !running) {
    return <p className="muted">예제 실행 또는 제출을 눌러 결과를 확인하세요.</p>;
  }
  if (!response) return <p className="muted">실행 중…</p>;
  if (response.compileError) {
    return (
      <div>
        <p className="status fail">컴파일/로드 오류</p>
        <pre className="error">{response.compileError}</pre>
        {response.stdout && <Stdout text={response.stdout} />}
      </div>
    );
  }
  const passed = response.results.filter((r) => r.status === "pass").length;
  const total = response.results.length;
  const all = passed === total && total > 0;
  return (
    <div>
      <p className={`status ${all ? "pass" : "fail"}`}>
        {mode === "submit" ? "채점 결과" : "예제 결과"}: {passed} / {total} 통과
        {all && mode === "submit" && " 🎉"}
      </p>
      <ul className="results">
        {response.results.map((r) => {
          const t = tests[r.index];
          const hidden = mode === "submit";
          return (
            <li key={r.index} className={`result ${r.status}`}>
              <div className="result-head">
                <span>
                  #{r.index + 1} {statusLabel(r.status)}
                </span>
                <span className="muted">{r.durationMs.toFixed(1)} ms</span>
              </div>
              {(!hidden || r.status !== "pass") && t && (
                <dl>
                  {!hidden && (
                    <>
                      <dt>입력</dt>
                      <dd>
                        <code>{t.input.map(formatValue).join(", ")}</code>
                      </dd>
                    </>
                  )}
                  <dt>기대</dt>
                  <dd>
                    <code>{formatValue(r.expected)}</code>
                  </dd>
                  {r.status === "fail" && (
                    <>
                      <dt>실제</dt>
                      <dd>
                        <code>{formatValue(r.actual)}</code>
                      </dd>
                    </>
                  )}
                  {r.error && (
                    <>
                      <dt>오류</dt>
                      <dd>
                        <code>{r.error}</code>
                      </dd>
                    </>
                  )}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      {response.stdout && <Stdout text={response.stdout} />}
    </div>
  );
}

function Stdout({ text }: { text: string }) {
  return (
    <details open>
      <summary>표준 출력</summary>
      <pre className="stdout">{text}</pre>
    </details>
  );
}

function statusLabel(s: string) {
  return s === "pass" ? "통과" : s === "fail" ? "실패" : s === "timeout" ? "시간 초과" : "오류";
}

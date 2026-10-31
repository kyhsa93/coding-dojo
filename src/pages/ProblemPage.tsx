import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useParams } from "react-router-dom";
import Editor from "../components/Editor";
import Results from "../components/Results";
import { runTests, warmUp } from "../judge/client";
import { formatValue } from "../lib/deepEqual";
import { labelOf } from "../lib/labels";
import { findProblem } from "../lib/problems";
import { loadDraft, loadLanguage, markSolved, saveDraft, saveLanguage } from "../lib/storage";
import { LANGUAGES, type Language, type Problem, type RunResponse } from "../lib/types";

const TIMEOUT_MS = 3000;

export default function ProblemPage() {
  const { id = "" } = useParams();
  const problem = findProblem(id);
  const [language, setLanguage] = useState<Language>(() => loadLanguage());

  if (!problem) {
    return (
      <main className="page">
        <p>문제를 찾을 수 없습니다.</p>
        <Link to="/">목록으로</Link>
      </main>
    );
  }

  const changeLanguage = (l: Language) => {
    setLanguage(l);
    saveLanguage(l);
  };

  return (
    <main className="problem">
      <Statement problem={problem} />
      <Workspace key={`${problem.id}:${language}`} problem={problem} language={language} onLanguageChange={changeLanguage} />
    </main>
  );
}

function Statement({ problem }: { problem: Problem }) {
  return (
    <section className="statement">
      <p className="crumbs">
        <Link to="/">문제 목록</Link> / {problem.id}
      </p>
      <h1>{problem.title}</h1>
      <p className="meta">
        <span className={`badge ${problem.difficulty}`}>{labelOf(problem.difficulty)}</span>
        {problem.tags.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </p>
      <div className="markdown">
        <ReactMarkdown>{problem.statement}</ReactMarkdown>
      </div>
      <h2>함수 시그니처</h2>
      <pre className="signature">
        {problem.functionName}({problem.params.map((p) => `${p.name}: ${p.type}`).join(", ")}) → {problem.returnType}
      </pre>
      <h2>예제</h2>
      {problem.examples.map((e, i) => (
        <div key={i} className="example">
          <dl>
            <dt>입력</dt>
            <dd>
              <code>{e.input.map(formatValue).join(", ")}</code>
            </dd>
            <dt>출력</dt>
            <dd>
              <code>{formatValue(e.expected)}</code>
            </dd>
          </dl>
          {e.explanation && <p className="muted">{e.explanation}</p>}
        </div>
      ))}
      {problem.hints && problem.hints.length > 0 && (
        <details>
          <summary>힌트 {problem.hints.length}개</summary>
          <ol>
            {problem.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        </details>
      )}
      <details>
        <summary>참고 풀이 (JavaScript)</summary>
        <pre className="solution">{problem.solution}</pre>
      </details>
      <p className="muted small">
        숨은 테스트 {problem.tests.length}개 · 테스트당 제한 {TIMEOUT_MS / 1000}초 · 출처: {problem.source ?? "수동 작성"}
      </p>
    </section>
  );
}

interface WorkspaceProps {
  problem: Problem;
  language: Language;
  onLanguageChange: (l: Language) => void;
}

function Workspace({ problem, language, onLanguageChange }: WorkspaceProps) {
  const [code, setCode] = useState(() => loadDraft(problem.id, language) ?? problem.starterCode[language]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"examples" | "submit">("examples");
  const [response, setResponse] = useState<RunResponse | null>(null);

  useEffect(() => {
    warmUp(language);
  }, [language]);

  const onChange = useCallback(
    (v: string) => {
      setCode(v);
      saveDraft(problem.id, language, v);
    },
    [problem.id, language],
  );

  const exampleTests = problem.examples.map((e) => ({ input: e.input, expected: e.expected }));

  const execute = async (which: "examples" | "submit") => {
    setRunning(true);
    setMode(which);
    setResponse(null);
    const tests = which === "examples" ? exampleTests : problem.tests;
    const res = await runTests({ language, code, functionName: problem.functionName, tests, timeoutMs: TIMEOUT_MS });
    setResponse(res);
    setRunning(false);
    if (which === "submit" && !res.compileError && res.results.length === tests.length && res.results.every((r) => r.status === "pass")) {
      markSolved(problem.id);
    }
  };

  const reset = () => {
    if (!confirm("작성한 코드를 초기 코드로 되돌릴까요?")) return;
    onChange(problem.starterCode[language]);
  };

  return (
    <section className="workspace">
      <div className="toolbar">
        <select value={language} onChange={(e) => onLanguageChange(e.target.value as Language)} disabled={running}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button onClick={reset} disabled={running} className="ghost">
          초기화
        </button>
        <span className="spacer" />
        <button onClick={() => execute("examples")} disabled={running}>
          예제 실행
        </button>
        <button onClick={() => execute("submit")} disabled={running} className="primary">
          제출
        </button>
      </div>
      <div className="editor-wrap">
        <Editor language={language} value={code} onChange={onChange} />
      </div>
      <div className="results-wrap">
        <Results response={response} tests={mode === "examples" ? exampleTests : problem.tests} running={running} mode={mode} />
      </div>
      {language === "python" && (
        <p className="muted small">Python은 브라우저 안에서 Pyodide로 실행됩니다. 첫 실행 때 런타임(약 10MB)을 내려받습니다.</p>
      )}
    </section>
  );
}

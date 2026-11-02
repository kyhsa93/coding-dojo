import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useLocation, useParams } from "react-router-dom";
import Editor from "../components/Editor";
import Results, { type LiveRun } from "../components/Results";
import { runTests, warmUp } from "../judge/client";
import { formatValue } from "../lib/deepEqual";
import { labelOf } from "../lib/labels";
import { findProblem } from "../lib/problems";
import { loadDraft, loadLanguage, loadSolved, markSolved, saveDraft, saveLanguage } from "../lib/storage";
import { LANGUAGES, type Language, type Problem, type RunResponse, type TestResult } from "../lib/types";

const TIMEOUT_MS = 3000;
const TOTAL_TIMEOUT_MS = 30_000;

export default function ProblemPage() {
  const { id = "" } = useParams();
  const problem = findProblem(id);
  if (!problem) {
    return (
      <main className="page">
        <p>문제를 찾을 수 없습니다.</p>
        <Link to="/">목록으로</Link>
      </main>
    );
  }
  // Keyed so that moving to another problem starts with fresh hint, solution and run state.
  return <ProblemView key={problem.id} problem={problem} />;
}

function ProblemView({ problem }: { problem: Problem }) {
  const [language, setLanguage] = useState<Language>(() => loadLanguage());
  const [solvedAt, setSolvedAt] = useState<string | undefined>(() => loadSolved()[problem.id]);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const solutionRef = useRef<HTMLDetailsElement>(null);

  const changeLanguage = (l: Language) => {
    setLanguage(l);
    saveLanguage(l);
  };

  const showSolution = () => {
    setSolutionOpen(true);
    requestAnimationFrame(() => solutionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <main className="problem">
      <Statement problem={problem} solvedAt={solvedAt} solutionOpen={solutionOpen} onSolutionOpenChange={setSolutionOpen} solutionRef={solutionRef} />
      <Workspace
        key={language}
        problem={problem}
        language={language}
        onLanguageChange={changeLanguage}
        onSolved={setSolvedAt}
        onShowSolution={showSolution}
      />
    </main>
  );
}

interface StatementProps {
  problem: Problem;
  solvedAt?: string;
  solutionOpen: boolean;
  onSolutionOpenChange: (open: boolean) => void;
  solutionRef: React.RefObject<HTMLDetailsElement | null>;
}

function Statement({ problem, solvedAt, solutionOpen, onSolutionOpenChange, solutionRef }: StatementProps) {
  const location = useLocation();
  const listSearch = (location.state as { listSearch?: string } | null)?.listSearch ?? "";
  const hints = problem.hints ?? [];
  const [hintsShown, setHintsShown] = useState(0);

  const toggleSolution = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!solutionOpen && !solvedAt && !confirm("아직 해결하지 않은 문제입니다. 참고 풀이를 볼까요?")) return;
    onSolutionOpenChange(!solutionOpen);
  };

  return (
    <section className="statement" aria-labelledby="problem-title">
      <p className="crumbs">
        <Link to={`/${listSearch}`}>문제 목록</Link> / {problem.id}
      </p>
      <h1 id="problem-title">{problem.title}</h1>
      <p className="meta">
        <span className={`badge ${problem.difficulty}`}>{labelOf(problem.difficulty)}</span>
        {solvedAt && (
          <span className="badge solved" title={`해결: ${new Date(solvedAt).toLocaleString()}`}>
            해결함
          </span>
        )}
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
      {hints.length > 0 && (
        <section className="hints" aria-label="힌트">
          {hintsShown > 0 && (
            <ol>
              {hints.slice(0, hintsShown).map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
          )}
          {hintsShown < hints.length && (
            <button className="ghost" onClick={() => setHintsShown(hintsShown + 1)}>
              {hints.length === 1 ? "힌트 보기" : `다음 힌트 (${hintsShown + 1}/${hints.length})`}
            </button>
          )}
        </section>
      )}
      <details ref={solutionRef} open={solutionOpen}>
        <summary onClick={toggleSolution}>참고 풀이 (JavaScript)</summary>
        <pre className="solution">{problem.solution}</pre>
      </details>
      <p className="muted small">
        채점 테스트 {problem.tests.length}개(입력은 표시하지 않음) · 테스트당 제한 {TIMEOUT_MS / 1000}초 · 전체 제한 {TOTAL_TIMEOUT_MS / 1000}초 · 출처:{" "}
        {problem.source ?? "수동 작성"}
      </p>
    </section>
  );
}

interface WorkspaceProps {
  problem: Problem;
  language: Language;
  onLanguageChange: (l: Language) => void;
  onSolved: (at: string) => void;
  onShowSolution: () => void;
}

type SaveState = { ok: boolean } | null;

function Workspace({ problem, language, onLanguageChange, onSolved, onShowSolution }: WorkspaceProps) {
  const [code, setCode] = useState(() => loadDraft(problem.id, language) ?? problem.starterCode[language]);
  const [mode, setMode] = useState<"examples" | "submit">("examples");
  const [live, setLive] = useState<LiveRun | null>(null);
  const [partial, setPartial] = useState<TestResult[]>([]);
  const [response, setResponse] = useState<RunResponse | null>(null);
  const [saved, setSaved] = useState<SaveState>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const running = live !== null;

  useEffect(() => {
    warmUp(language);
  }, [language]);

  // Leaving the problem (or switching language) stops a run in progress; its result would land on a page that is gone.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  const save = useCallback(
    (v: string) => {
      setCode(v);
      setSaved({ ok: saveDraft(problem.id, language, v) });
    },
    [problem.id, language],
  );

  const onEdit = useCallback(
    (v: string) => {
      save(v);
      setUndo(null);
    },
    [save],
  );

  const exampleTests = problem.examples.map((e) => ({ input: e.input, expected: e.expected }));
  const tests = mode === "examples" ? exampleTests : problem.tests;

  const execute = async (which: "examples" | "submit") => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const runTestsFor = which === "examples" ? exampleTests : problem.tests;
    setMode(which);
    setResponse(null);
    setPartial([]);
    setLive({ phase: "starting", total: runTestsFor.length, startedAt: performance.now() });
    const res = await runTests(
      { language, code, functionName: problem.functionName, tests: runTestsFor, timeoutMs: TIMEOUT_MS, totalTimeoutMs: TOTAL_TIMEOUT_MS, tolerance: problem.tolerance },
      {
        signal: controller.signal,
        onEvent: (e) => {
          if (e.kind === "loading") setLive((r) => r && { ...r, phase: "loading" });
          else if (e.kind === "running") setLive((r) => r && { ...r, phase: "running", startedAt: performance.now() });
          else setPartial((p) => [...p, e.result]);
        },
      },
    );
    // Unmounted meanwhile: nothing to show.
    if (controllerRef.current !== controller) return;
    controllerRef.current = null;
    setLive(null);
    setResponse(res);
    if (which === "submit" && !res.failure && !res.cancelled && res.results.length === runTestsFor.length && res.results.every((r) => r.status === "pass")) {
      onSolved(markSolved(problem.id));
    }
  };

  const cancel = () => controllerRef.current?.abort();

  const reset = () => {
    if (!confirm("작성한 코드를 초기 코드로 되돌릴까요? 다른 내용을 입력하기 전까지 '되돌리기'로 복구할 수 있습니다.")) return;
    setUndo(code);
    save(problem.starterCode[language]);
  };

  const restore = () => {
    if (undo === null) return;
    save(undo);
    setUndo(null);
  };

  // Ctrl/Cmd+Enter runs the examples, with Shift it submits. Capture phase, so the editor does not insert a line first.
  const executeRef = useRef(execute);
  useEffect(() => {
    executeRef.current = execute;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      e.preventDefault();
      void executeRef.current(e.shiftKey ? "submit" : "examples");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <section className="workspace" aria-label="코드 작성과 채점">
      <div className="toolbar">
        <select aria-label="언어" value={language} onChange={(e) => onLanguageChange(e.target.value as Language)} disabled={running}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        {undo === null ? (
          <button onClick={reset} disabled={running} className="ghost">
            초기화
          </button>
        ) : (
          <button onClick={restore} disabled={running} className="ghost">
            되돌리기
          </button>
        )}
        <span className={`save-state small ${saved && !saved.ok ? "error" : "muted"}`} aria-live="polite">
          {saved === null ? "" : saved.ok ? "자동 저장됨" : "저장 실패: 브라우저 저장소를 쓸 수 없습니다"}
        </span>
        <span className="spacer" />
        {running ? (
          <button onClick={cancel}>중단</button>
        ) : (
          <>
            <button onClick={() => execute("examples")} title="Ctrl/⌘ + Enter">
              예제 실행
            </button>
            <button onClick={() => execute("submit")} className="primary" title="Ctrl/⌘ + Shift + Enter">
              제출
            </button>
          </>
        )}
      </div>
      <div className="editor-wrap">
        <Editor language={language} value={code} onChange={onEdit} />
      </div>
      <div className="results-wrap">
        <Results response={response} partial={partial} tests={tests} live={live} mode={mode} language={language} onShowSolution={onShowSolution} />
      </div>
      <p className="muted small shortcuts">
        Ctrl/⌘+Enter 예제 실행 · Ctrl/⌘+Shift+Enter 제출 · 편집기에서 빠져나가려면 Esc 다음 Tab
        {language === "python" && " · Python은 브라우저 안에서 Pyodide로 실행되며 첫 실행 때 런타임(약 10MB)을 내려받습니다."}
      </p>
    </section>
  );
}

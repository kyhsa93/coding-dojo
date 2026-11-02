export type Language = "javascript" | "typescript" | "python";

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
];

export type Difficulty = "easy" | "medium" | "hard";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** What a submission can return after normalisation: JSON plus bigint (Python ints past 2^53) and non-finite numbers. */
export type JudgeValue = string | number | bigint | boolean | null | JudgeValue[] | { [k: string]: JudgeValue };

export interface TestCase {
  input: JsonValue[];
  expected: JsonValue;
}

export interface Example {
  input: JsonValue[];
  expected: JsonValue;
  explanation?: string;
}

export interface Problem {
  id: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  /** Markdown */
  statement: string;
  functionName: string;
  params: { name: string; type: string }[];
  returnType: string;
  starterCode: Record<Language, string>;
  examples: Example[];
  tests: TestCase[];
  hints?: string[];
  /**
   * Allowed absolute error for non-integer numbers (default 1e-6, 0 = exact). Integers always compare exactly.
   * See `deepEqual` for the full policy.
   */
  tolerance?: number;
  /** Reference solution in JavaScript. Used to validate tests, not shown to users by default. */
  solution: string;
  createdAt: string;
  source?: string;
  /** Second model pass that graded the real difficulty. Present on generated problems. */
  judge?: {
    difficulty: Difficulty;
    algorithm: string;
    reason: string;
    crossChecked?: boolean;
    /** Hard problems only: the archetype key the problem was built from and the judge's technique check. */
    archetype?: string;
    usesTechnique?: boolean;
    /** The judge's own difficulty opinion when the measured label (hard) overrode it. */
    opinion?: Difficulty;
    /** Performance gate evidence: the solution is fast and the brute force is slow on the large input. */
    performance?: {
      solutionMs: number | null;
      bruteForce: string | null;
      largeInputArgs: string[] | null;
      includedAsTest: boolean;
      largeInput: string;
    };
  };
}

/** `skipped`: never ran because an earlier test timed out or the run was cancelled. */
export type TestStatus = "pass" | "fail" | "error" | "timeout" | "skipped";

export interface TestResult {
  index: number;
  status: TestStatus;
  expected: JsonValue;
  actual?: JudgeValue;
  error?: string;
  durationMs: number;
}

/**
 * Why a run produced no per-test results:
 * - `syntax`: the code does not parse
 * - `toplevel`: it parsed, but code outside the function threw, or the function is missing
 * - `load`: the runtime (worker, Pyodide) could not start; nothing about the submission
 */
export interface RunFailure {
  kind: "syntax" | "toplevel" | "load";
  message: string;
}

export interface RunResponse {
  kind: "result";
  results: TestResult[];
  stdout: string;
  failure?: RunFailure;
  /** The run was cancelled (button, page change, or a newer run); `results` holds what finished before that. */
  cancelled?: boolean;
  /** Time spent starting the runtime before the first test, kept apart from the judged time. */
  loadMs?: number;
  /** Wall time from runtime ready to the last result. */
  runMs?: number;
}

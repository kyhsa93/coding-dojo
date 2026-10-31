export type Language = "javascript" | "typescript" | "python";

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
];

export type Difficulty = "easy" | "medium" | "hard";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

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
  /** Reference solution in JavaScript. Used to validate tests, not shown to users by default. */
  solution: string;
  createdAt: string;
  source?: string;
  /** Second model pass that graded the real difficulty. Present on generated problems. */
  judge?: { difficulty: Difficulty; algorithm: string; reason: string };
}

export type TestStatus = "pass" | "fail" | "error" | "timeout";

export interface TestResult {
  index: number;
  status: TestStatus;
  expected: JsonValue;
  actual?: JsonValue;
  error?: string;
  durationMs: number;
}

export interface RunRequest {
  kind: "run";
  language: Language;
  code: string;
  functionName: string;
  tests: TestCase[];
  timeoutMs: number;
}

export interface RunResponse {
  kind: "result";
  results: TestResult[];
  stdout: string;
  compileError?: string;
}

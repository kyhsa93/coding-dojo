import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPrBody, selectCandidates } from "./collect.mjs";

const problem = (id, title, algorithm, extra = {}) => ({ id, title, difficulty: "hard", tests: new Array(9), judge: algorithm ? { algorithm, archetype: "dp-digit", opinion: "medium" } : undefined, ...extra });
const existing = [problem("two-sum", "두 수의 합", "해시맵 한 번 순회")];

test("keeps the first of duplicate ids, titles and algorithms", () => {
  const { accepted, dropped } = selectCandidates([
    { slot: "1", problem: problem("a", "A 문제", "디지트 DP") },
    { slot: "2", problem: problem("a", "다른 제목", "뭔가") },
    { slot: "3", problem: problem("b", "a 문제", "다른 것") },
    { slot: "4", problem: problem("c", "C", "디지트 dp") },
    { slot: "5", problem: problem("two-sum-2", "두 수의 합", null) },
    { slot: "6", problem: problem("d", "D", "구간 DP") },
  ], existing);
  assert.deepEqual(accepted.map((c) => c.problem.id), ["a", "d"]);
  assert.deepEqual(dropped.map((d) => [d.id, d.reason.split(":")[0].split(" (")[0]]), [
    ["a", "같은 id 가 이미 있음"], ["b", "같은 제목"], ["c", "같은 핵심 알고리즘"], ["two-sum-2", "같은 제목"],
  ]);
});

test("a modified existing problem (rejudge) is always taken", () => {
  const { accepted, dropped } = selectCandidates([{ slot: "rejudge", problem: problem("two-sum", "두 수의 합", "해시맵 한 번 순회"), modified: true }], existing);
  assert.equal(accepted.length, 1);
  assert.equal(dropped.length, 0);
});

test("the PR body lists problems, dropped candidates and the reports", () => {
  const body = renderPrBody({
    accepted: [{ slot: "1", problem: problem("a", "A 문제", "디지트 DP"), report: "### a — 지문 명확" }],
    dropped: [{ slot: "2", id: "b", reason: "같은 제목: a" }],
    runUrl: "https://example/run/1",
  });
  assert.match(body, /\| 1 \| a \| A 문제 \| hard \| dp-digit \| medium \| 9 \|/);
  assert.match(body, /- 슬롯 2 `b`: 같은 제목: a/);
  assert.match(body, /## 지문 검수\n\n### a — 지문 명확/);
  assert.match(body, /실행: https:\/\/example\/run\/1/);
});

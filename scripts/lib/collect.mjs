/**
 * Merges the candidates that parallel slots produced. Two slots can land on the same problem (same id,
 * same title, or the same core algorithm as judged), and a slot cannot know what the others made, so the
 * collector keeps the first of each and drops the rest with a reason. Modified files (rejudge mode) are
 * always taken.
 */

const norm = (s) => String(s ?? "").toLowerCase().replace(/[\s_\-:.,()[\]]/g, "");

/**
 * candidates: [{slot, problem, report}] in slot order. existing: [{id, title, judge?}] already in problems/.
 * Returns {accepted: [{slot, problem, report}], dropped: [{slot, id, reason}]}.
 */
export function selectCandidates(candidates, existing) {
  const ids = new Set(existing.map((p) => p.id));
  const titles = new Map(existing.map((p) => [norm(p.title), p.id]));
  const algorithms = new Map(existing.filter((p) => p.judge?.algorithm).map((p) => [norm(p.judge.algorithm), p.id]));
  const accepted = [];
  const dropped = [];
  for (const c of candidates) {
    const p = c.problem;
    const modified = ids.has(p.id) && c.modified;
    let reason = null;
    if (!modified) {
      if (ids.has(p.id)) reason = `같은 id 가 이미 있음 (${p.id})`;
      else if (titles.has(norm(p.title))) reason = `같은 제목: ${titles.get(norm(p.title))}`;
      else if (p.judge?.algorithm && algorithms.has(norm(p.judge.algorithm))) reason = `같은 핵심 알고리즘: ${algorithms.get(norm(p.judge.algorithm))}`;
    }
    if (reason) {
      dropped.push({ slot: c.slot, id: p.id, reason });
      continue;
    }
    accepted.push(c);
    ids.add(p.id);
    titles.set(norm(p.title), p.id);
    if (p.judge?.algorithm) algorithms.set(norm(p.judge.algorithm), p.id);
  }
  return { accepted, dropped };
}

/** Pull request body: one table of problems, the audit reports, and what was dropped. */
export function renderPrBody({ accepted, dropped, runUrl }) {
  const lines = ["## 문제", "", "| 슬롯 | id | 제목 | 난이도 | 아키타입 | 판정 의견 | 테스트 |", "|---|---|---|---|---|---|---|"];
  for (const { slot, problem: p, modified } of accepted) {
    const j = p.judge ?? {};
    lines.push(`| ${slot} | ${p.id}${modified ? " (재판정)" : ""} | ${p.title} | ${p.difficulty} | ${j.archetype ?? "-"} | ${j.opinion ?? j.difficulty ?? "-"} | ${p.tests.length} |`);
  }
  if (dropped.length) {
    lines.push("", "제외된 후보:", "");
    for (const d of dropped) lines.push(`- 슬롯 ${d.slot} \`${d.id}\`: ${d.reason}`);
  }
  const reports = accepted.map((c) => c.report).filter(Boolean);
  if (reports.length) lines.push("", "## 지문 검수", "", reports.join("\n\n"));
  if (runUrl) lines.push("", `실행: ${runUrl}`);
  lines.push("", "자동 생성 PR 이라 CI 워크플로우는 돌지 않는다. 검증(npm test)은 슬롯과 수집 단계에서 통과했다. 병합하면 Pages 배포가 이어서 돈다.");
  return lines.join("\n");
}

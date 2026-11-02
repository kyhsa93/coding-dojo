import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { allTags, problems } from "../lib/problems";
import { loadSolved } from "../lib/storage";
import type { Difficulty } from "../lib/types";
import { labelOf } from "../lib/labels";

const DIFFICULTIES: { id: Difficulty | "all"; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "easy", label: "쉬움" },
  { id: "medium", label: "보통" },
  { id: "hard", label: "어려움" },
];

export default function ProblemList() {
  // Filters live in the URL (#/?q=..&d=..&tag=..) so they survive a visit to a problem, a reload and a shared link.
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const tag = params.get("tag") ?? "";
  const d = params.get("d");
  const difficulty: Difficulty | "all" = d === "easy" || d === "medium" || d === "hard" ? d : "all";
  const solved = useMemo(() => loadSolved(), []);
  const listSearch = params.toString() ? `?${params.toString()}` : "";

  const setFilter = (key: "q" | "d" | "tag", value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value && value !== "all") next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const filtered = problems.filter((p) => {
    if (difficulty !== "all" && p.difficulty !== difficulty) return false;
    if (tag && !p.tags.includes(tag)) return false;
    if (query && !p.title.toLowerCase().includes(query.toLowerCase()) && !p.id.includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <main className="page">
      <div className="list-header">
        <h1>문제 목록</h1>
        <p className="muted">
          {problems.length}문제 · 푼 문제 {Object.keys(solved).length}개
        </p>
      </div>
      <div className="filters">
        <input type="search" aria-label="제목 검색" placeholder="제목 검색" value={query} onChange={(e) => setFilter("q", e.target.value)} />
        <select aria-label="난이도" value={difficulty} onChange={(e) => setFilter("d", e.target.value)}>
          {DIFFICULTIES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <select aria-label="태그" value={tag} onChange={(e) => setFilter("tag", e.target.value)}>
          <option value="">모든 태그</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <table className="problem-table">
        <thead>
          <tr>
            <th style={{ width: "3rem" }}>
              <span className="sr-only">해결 여부</span>
            </th>
            <th>제목</th>
            <th>난이도</th>
            <th>태그</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id}>
              <td className="center">
                {solved[p.id] && (
                  <span role="img" aria-label="해결함" title="해결함">
                    ✅
                  </span>
                )}
              </td>
              <td>
                <Link to={`/p/${p.id}`} state={{ listSearch }}>
                  {p.title}
                </Link>
              </td>
              <td>
                <span className={`badge ${p.difficulty}`}>{labelOf(p.difficulty)}</span>
              </td>
              <td className="tags">
                {p.tags.map((t) => (
                  <button key={t} className="tag" aria-pressed={tag === t} aria-label={`태그 ${t}로 거르기`} onClick={() => setFilter("tag", t)}>
                    {t}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={4} className="center muted">
                조건에 맞는 문제가 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}


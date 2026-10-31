import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  const [difficulty, setDifficulty] = useState<Difficulty | "all">("all");
  const [tag, setTag] = useState<string>("");
  const [query, setQuery] = useState("");
  const solved = useMemo(() => loadSolved(), []);

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
        <input placeholder="제목 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | "all")}>
          {DIFFICULTIES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
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
            <th style={{ width: "3rem" }}></th>
            <th>제목</th>
            <th>난이도</th>
            <th>태그</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id}>
              <td className="center">{solved[p.id] ? "✅" : ""}</td>
              <td>
                <Link to={`/p/${p.id}`}>{p.title}</Link>
              </td>
              <td>
                <span className={`badge ${p.difficulty}`}>{labelOf(p.difficulty)}</span>
              </td>
              <td className="tags">
                {p.tags.map((t) => (
                  <button key={t} className="tag" onClick={() => setTag(t)}>
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


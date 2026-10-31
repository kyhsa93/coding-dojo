import type { Problem } from "./types";

const modules = import.meta.glob<{ default: Problem }>("../../problems/*.json", { eager: true });

export const problems: Problem[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id.localeCompare(b.id)));

export function findProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}

export const allTags: string[] = Array.from(new Set(problems.flatMap((p) => p.tags))).sort();

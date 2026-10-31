import type { Language } from "./types";

const PREFIX = "coding-dojo:";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function loadDraft(problemId: string, language: Language): string | null {
  return read<string | null>(`draft:${problemId}:${language}`, null);
}

export function saveDraft(problemId: string, language: Language, code: string) {
  write(`draft:${problemId}:${language}`, code);
}

export function loadLanguage(): Language {
  return read<Language>("language", "typescript");
}

export function saveLanguage(language: Language) {
  write("language", language);
}

export function loadSolved(): Record<string, string> {
  return read<Record<string, string>>("solved", {});
}

export function markSolved(problemId: string) {
  const solved = loadSolved();
  solved[problemId] = new Date().toISOString();
  write("solved", solved);
}

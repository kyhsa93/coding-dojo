import type { Difficulty } from "./types";

export function labelOf(d: Difficulty) {
  return d === "easy" ? "쉬움" : d === "medium" ? "보통" : "어려움";
}

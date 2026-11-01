/** Prints the matrix for the workflow's generate job as one JSON line: {"include": [slot, ...]}. */
import { planSlots } from "./lib/slots.mjs";

const slots = planSlots(process.env);
console.error(slots.map((s) => `slot ${s.slot}: ${s.mode}${s.topic ? ` topic=${s.topic}` : ""}${s.difficulty ? ` difficulty=${s.difficulty}` : ""}${s.archetype ? ` archetype=${s.archetype}` : ""}`).join("\n"));
console.log(JSON.stringify({ include: slots }));

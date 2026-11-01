/**
 * Plans the parallel slots of one workflow run. Each slot becomes a matrix job that generates at most
 * one problem (or runs the rejudge / audit mode once), so the wall-clock time of a run is one slot,
 * not the sum of them.
 *
 * Parallel jobs cannot see each other's rejected candidates, so hard slots are told which archetype to
 * start with (`archetype`) and which ones belong to sibling slots (`exclude`): a slot that gives up on
 * its archetype moves to one no sibling is working on.
 */
import { HARD_ARCHETYPES, archetypesForTopic, findArchetype } from "./archetypes.mjs";

export const MAX_SLOTS = 8;

function shuffle(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** env: COUNT, TOPIC, DIFFICULTY, ARCHETYPE, REJUDGE, AUDIT (all strings, as the workflow passes them). */
export function planSlots(env, random = Math.random) {
  const get = (k) => String(env[k] ?? "").trim();
  if (get("AUDIT")) return [{ slot: "audit", mode: "audit", topic: "", difficulty: "", archetype: "", exclude: "" }];
  if (get("REJUDGE")) return [{ slot: "rejudge", mode: "rejudge", topic: "", difficulty: "", archetype: "", exclude: "" }];

  const count = Math.min(MAX_SLOTS, Math.max(1, Number(get("COUNT") || 1) || 1));
  const topic = get("TOPIC");
  const pinned = get("ARCHETYPE");
  if (pinned && !findArchetype(pinned)) throw new Error(`unknown ARCHETYPE ${pinned}`);
  const difficulty = pinned ? "hard" : get("DIFFICULTY");

  const slots = [];
  // Distinct archetypes for hard slots: those serving the topic first, then any; cycle only if there are
  // more slots than archetypes.
  let archetypes = [];
  if (difficulty === "hard" && !pinned) {
    const forTopic = topic ? shuffle(archetypesForTopic(topic), random) : [];
    const rest = shuffle(HARD_ARCHETYPES.filter((a) => !forTopic.includes(a)), random);
    archetypes = [...forTopic, ...rest];
  }
  for (let i = 0; i < count; i++) {
    const a = pinned ? findArchetype(pinned) : archetypes.length ? archetypes[i % archetypes.length] : null;
    slots.push({
      slot: String(i + 1),
      mode: "generate",
      // A slot whose archetype does not serve the requested topic generates in the archetype's own topic.
      topic: a && topic && !a.topics.includes(topic.split(/[\s(]/)[0].toLowerCase()) ? a.topics[0] : topic,
      difficulty,
      archetype: pinned ? "" : (a?.key ?? ""),
      exclude: "",
    });
  }
  for (const s of slots) {
    s.exclude = slots.filter((o) => o !== s && o.archetype && o.archetype !== s.archetype).map((o) => o.archetype).join(",");
  }
  return slots;
}

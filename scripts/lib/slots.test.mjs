import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SLOTS, planSlots } from "./slots.mjs";
import { archetypesForTopic, findArchetype } from "./archetypes.mjs";

const seq = () => {
  let i = 0;
  return () => ((i += 0.37) % 1);
};

test("audit and rejudge modes are a single slot", () => {
  assert.deepEqual(planSlots({ AUDIT: "two-sum", COUNT: "4" }).map((s) => s.mode), ["audit"]);
  assert.deepEqual(planSlots({ REJUDGE: "all", COUNT: "4" }).map((s) => s.mode), ["rejudge"]);
});

test("hard slots get distinct archetypes serving the topic and exclude their siblings", () => {
  const slots = planSlots({ COUNT: "3", TOPIC: "dynamic-programming", DIFFICULTY: "hard" }, seq());
  assert.equal(slots.length, 3);
  const keys = slots.map((s) => s.archetype);
  assert.equal(new Set(keys).size, 3);
  const dp = archetypesForTopic("dynamic-programming");
  assert.ok(dp.length >= 3);
  for (const s of slots) {
    assert.ok(dp.some((a) => a.key === s.archetype), s.archetype);
    assert.equal(s.topic, "dynamic-programming");
    assert.deepEqual(s.exclude.split(",").sort(), keys.filter((k) => k !== s.archetype).sort());
  }
});

test("more hard slots than topic archetypes spill over into other topics with their own topic", () => {
  const slots = planSlots({ COUNT: "8", TOPIC: "topological-sort", DIFFICULTY: "hard" }, seq());
  const topo = archetypesForTopic("topological-sort").map((a) => a.key);
  const spilled = slots.filter((s) => !topo.includes(s.archetype));
  assert.ok(spilled.length > 0);
  for (const s of spilled) assert.equal(s.topic, findArchetype(s.archetype).topics[0]);
  assert.equal(new Set(slots.map((s) => s.archetype)).size, 8);
});

test("a pinned archetype is left to the generator and no exclusions are set", () => {
  const slots = planSlots({ COUNT: "2", ARCHETYPE: "dp-digit" });
  assert.deepEqual(slots.map((s) => [s.difficulty, s.archetype, s.exclude]), [["hard", "", ""], ["hard", "", ""]]);
  assert.throws(() => planSlots({ ARCHETYPE: "nope" }), /unknown ARCHETYPE/);
});

test("non-hard slots carry the inputs through and the count is capped", () => {
  const slots = planSlots({ COUNT: "20", TOPIC: "graph-bfs", DIFFICULTY: "medium" });
  assert.equal(slots.length, MAX_SLOTS);
  assert.deepEqual(slots[0], { slot: "1", mode: "generate", topic: "graph-bfs", difficulty: "medium", archetype: "", exclude: "" });
  assert.equal(planSlots({ COUNT: "abc" }).length, 1);
});

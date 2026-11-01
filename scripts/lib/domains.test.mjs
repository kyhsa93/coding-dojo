import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMAINS, DOMAIN_SHARE, domainBlock, pickDomain } from "./domains.mjs";

test("every domain has a key, a tag, a label and scenarios", () => {
  for (const d of DOMAINS) {
    assert.match(d.key, /^[a-z]+$/);
    assert.match(d.tag, /^[a-z-]+$/);
    assert.ok(d.label.length > 5 && d.scenarios.length > 40, d.key);
  }
  assert.ok(DOMAINS.some((d) => d.key === "aws") && DOMAINS.some((d) => d.key === "containers") && DOMAINS.some((d) => d.key === "backend"));
});

test("pickDomain honors a pinned key, none, and the random share", () => {
  assert.equal(pickDomain({ DOMAIN: "aws" }).key, "aws");
  assert.equal(pickDomain({ DOMAIN: " AWS " }).key, "aws");
  assert.equal(pickDomain({ DOMAIN: "none" }), null);
  assert.throws(() => pickDomain({ DOMAIN: "mainframe" }), /unknown DOMAIN mainframe/);
  const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
  assert.equal(pickDomain({}, seq([DOMAIN_SHARE])), null);
  assert.equal(pickDomain({}, seq([0, 0])).key, DOMAINS[0].key);
  assert.equal(pickDomain({}, seq([0.1, 0.999])).key, DOMAINS.at(-1).key);
});

test("domainBlock tells the model the setting, its vocabulary and the tag", () => {
  assert.equal(domainBlock(null), "");
  const b = domainBlock(pickDomain({ DOMAIN: "containers" }));
  assert.match(b, /Setting: containers and orchestration/);
  assert.match(b, /maxSurge/);
  assert.match(b, /Include "containers" in "tags"/);
  assert.match(b, /no real APIs, clocks or network/);
  assert.match(b, /never as an array of objects/);
});

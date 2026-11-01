/**
 * Settings a problem can be told in. The topic (and for hard problems the archetype) fixes the
 * technique; the setting fixes the story: a backend service, a container scheduler, an AWS account.
 * The model otherwise writes textbook puzzles (arrays of numbers, strings of letters), and a practice
 * site for backend interviews should also ask about the systems those interviews are about.
 */
export const DOMAINS = [
  {
    key: "backend",
    tag: "backend",
    label: "a backend service",
    scenarios: "HTTP request logs, rate limiting (token bucket, sliding window), idempotency keys, retries with exponential backoff, job queues and workers, cache eviction (LRU, LFU, TTL), session expiry, cursor pagination, webhook delivery order",
  },
  {
    key: "containers",
    tag: "containers",
    label: "containers and orchestration (Docker, Kubernetes)",
    scenarios: "image layers and build cache reuse, scheduling pods onto nodes under CPU and memory limits, rolling deployments with maxSurge and maxUnavailable, liveness and readiness probes, restart backoff, resource quotas and bin packing, container log streams",
  },
  {
    key: "aws",
    tag: "aws",
    label: "AWS cloud infrastructure",
    scenarios: "S3 lifecycle rules and storage classes, IAM policy evaluation (an explicit deny beats any allow), VPC CIDR and subnet allocation, Auto Scaling Group capacity, SQS visibility timeouts and dead-letter queues, Lambda concurrency and cold starts, cost allocation by tags, CloudWatch alarm evaluation, Route 53 weighted routing",
  },
  {
    key: "database",
    tag: "database",
    label: "databases and storage engines",
    scenarios: "query planning with indexes, transactions and lock waits, replication lag and read-your-writes, shard keys and rebalancing, LSM compaction, write-ahead log replay, B-tree page splits",
  },
  {
    key: "networking",
    tag: "networking",
    label: "networking and traffic management",
    scenarios: "load balancer routing (round robin, least connections, consistent hashing), DNS resolution with TTL caches, TCP windows and retransmissions, API gateway throttling, CDN cache hits and purges",
  },
  {
    key: "cicd",
    tag: "ci-cd",
    label: "CI/CD and build systems",
    scenarios: "pipeline stage dependency graphs, build caching by content hash, parallel runners with a concurrency limit, flaky test retries, deployment windows and rollbacks, semantic version resolution",
  },
];

/** Share of generations that get a setting when none is pinned; the rest stay plain algorithm puzzles. */
export const DOMAIN_SHARE = 0.6;

export const findDomain = (key) => DOMAINS.find((d) => d.key === key) ?? null;

/**
 * env.DOMAIN: a key pins that setting, "none" disables settings, empty picks one at random for
 * DOMAIN_SHARE of the attempts. Returns a domain or null.
 */
export function pickDomain(env, random = Math.random) {
  const want = String(env.DOMAIN ?? "").trim().toLowerCase();
  if (want === "none") return null;
  if (want) {
    const d = findDomain(want);
    if (!d) throw new Error(`unknown DOMAIN ${want} (one of ${DOMAINS.map((d) => d.key).join(", ")}, none)`);
    return d;
  }
  if (random() >= DOMAIN_SHARE) return null;
  return DOMAINS[Math.floor(random() * DOMAINS.length)];
}

/** Prompt lines that tell the model to set the problem in the domain. Empty when there is none. */
export function domainBlock(domain) {
  if (!domain) return "";
  return `- Setting: ${domain.label}. Tell the problem as a concrete, realistic scenario from this setting (for example: ${domain.scenarios}). Name the system and its resources, use the setting's real vocabulary, and make the function compute something an engineer there actually needs: a schedule, a count, a cost, a verdict, the final state. The computation stays self-contained: no real APIs, clocks or network. The parameters must still use the allowed types above, so encode records as parallel arrays (ids: string[], cpu: number[], memory: number[]), as rows (number[][]), or as one string per record ("n1 10 20"), never as an array of objects. Include "${domain.tag}" in "tags".
`;
}

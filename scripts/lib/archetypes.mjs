/**
 * Hard-problem archetypes: the hand-written list of techniques a "hard" problem must be built on.
 *
 * The model is bad at inventing difficulty (asked for "hard" it converges on the easiest problem in the
 * topic) but good at implementing a named technique. So for hard problems the generator picks one
 * archetype, tells the model the solution MUST implement that technique, and the judge checks that it
 * does. The archetype also says what the large input and the brute force look like so the performance
 * gate (scripts/lib/perf-gate.mjs) can confirm the problem really needs the technique.
 *
 * Fields:
 *  key        stable id, usable as the ARCHETYPE env / workflow input
 *  topics     TOPICS entries (first word) this archetype serves; one archetype can serve several
 *  technique  what the reference solution must implement (shown to the model and to the judge)
 *  large      how to build the input at the upper constraint, with sizes
 *  brute      what the obviously-correct slow approach is; it must NOT finish the large input in time
 */
export const HARD_ARCHETYPES = [
  // ----- dynamic programming -----
  {
    key: "dp-interval",
    topics: ["dynamic-programming", "recursion"],
    technique: "interval DP: dp[i][j] over subarrays/substrings, filled by increasing length with a split point (O(n^3) or O(n^2))",
    large: "one array or string of length 300..400 built from a seeded generator",
    brute: "plain recursion over every split without memoization (exponential)",
  },
  {
    key: "dp-bitmask",
    topics: ["dynamic-programming", "bit-manipulation", "recursion"],
    technique: "bitmask DP over subsets: dp[mask] or dp[mask][last] with n <= 16 items",
    large: "n = 15 or 16 items (a cost matrix or item list) from a seeded generator",
    brute: "enumerate every permutation or every subset order without memoization",
  },
  {
    key: "dp-lis-nlogn",
    topics: ["dynamic-programming", "binary-search", "array"],
    technique: "longest increasing subsequence in O(n log n) with the patience/tails array and binary search (a variant: strictly/non-strictly increasing, pairs sorted by one key, or counting with it)",
    large: "one array of 100000 integers from a seeded generator",
    brute: "the classic O(n^2) LIS DP",
  },
  {
    key: "dp-two-strings",
    topics: ["dynamic-programming", "string"],
    technique: "2-D DP over two strings (edit distance family, LCS with reconstruction, interleaving, regex/wildcard matching with '*')",
    large: "two strings of length 1500..2000 from a seeded generator over a small alphabet",
    brute: "plain recursion over both strings without memoization (exponential)",
  },
  {
    key: "dp-digit",
    topics: ["dynamic-programming", "math"],
    technique: "digit DP: count numbers in [0, N] with a digit property using dp[pos][tight][state]",
    large: "N around 10^12 (a JSON number, below 2^53)",
    brute: "iterate every number from 0 to N and test the property",
  },
  {
    key: "dp-tree",
    topics: ["dynamic-programming", "graph-dfs", "recursion"],
    technique: "tree DP: a post-order DFS computing dp[node][state] from the children (max independent set, min vertex cover, longest path through a node)",
    large: "a tree with 50000..100000 nodes given as a parent array or edge list from a seeded generator; make it shallow (random parent among the previous 50 nodes) so recursion depth stays small",
    brute: "enumerate every subset/assignment of nodes and check it (exponential)",
  },
  {
    key: "dp-knapsack-2d",
    topics: ["dynamic-programming", "greedy"],
    technique: "knapsack with two constraints (weight and count, or two capacities): dp[a][b] filled in reverse",
    large: "150..200 items with capacities around 400 each, from a seeded generator",
    brute: "enumerate every subset of items (exponential)",
  },
  {
    key: "dp-palindrome-partition",
    topics: ["dynamic-programming", "string", "string-compression"],
    technique: "palindrome table dp[i][j] (is s[i..j] a palindrome) combined with a cut/partition DP over positions, O(n^2)",
    large: "one string of length 1500..2000 over a 2..3 letter alphabet from a seeded generator",
    brute: "enumerate every partition recursively without memoization (exponential)",
  },
  {
    key: "string-compression-dp",
    topics: ["string-compression", "dynamic-programming"],
    technique: "optimal compression by DP over positions and run lengths (minimum encoded length after deleting at most k characters, or best split into runs), O(n^2 * k)",
    large: "one string of length 100..120 over a 3 letter alphabet and k around 20, from a seeded generator",
    brute: "enumerate every way to delete/split without memoization (exponential)",
  },
  // ----- graphs -----
  {
    key: "graph-dijkstra-state",
    topics: ["graph-bfs", "heap", "graph-dfs"],
    technique: "Dijkstra with an extra state dimension (at most k stops, fuel left, parity, key set) using a binary heap implemented in the solution",
    large: "a connected weighted graph with 10000 nodes and 40000..50000 edges from a seeded generator, k around 10",
    brute: "DFS enumerating every simple path from source to target (exponential)",
  },
  {
    key: "graph-01-bfs-grid",
    topics: ["graph-bfs", "matrix", "queue"],
    technique: "0-1 BFS with a deque on a grid where moves cost 0 or 1 (minimum obstacles to remove, minimum direction changes)",
    large: "a 400x400 grid from a seeded generator with ~30% obstacles",
    brute: "DFS enumerating every path without pruning (exponential)",
  },
  {
    key: "graph-bfs-bitmask-keys",
    topics: ["graph-bfs", "bit-manipulation", "matrix"],
    technique: "BFS over (row, col, bitmask) states: shortest path that must collect all keys/items before reaching the exit",
    large: "a 60x60 grid with 6 keys and ~25% walls from a seeded generator",
    brute: "DFS enumerating every path without a visited set over states (exponential)",
  },
  {
    key: "graph-bridges-tarjan",
    topics: ["graph-dfs", "union-find"],
    technique: "Tarjan's low-link DFS to find bridges or articulation points in O(n + m), iterative or with bounded recursion depth",
    large: "a connected graph with 50000 nodes and 100000 edges from a seeded generator (build a chain of small cycles so recursion depth stays small, or write the DFS iteratively)",
    brute: "for every edge, remove it and run BFS to test connectivity (O(m * (n + m)))",
  },
  {
    key: "topo-dag-dp",
    topics: ["topological-sort", "dynamic-programming", "graph-dfs"],
    technique: "topological order (Kahn) followed by DP along the order (longest path, number of paths modulo 10^9+7, earliest finish with durations)",
    large: "a DAG with 100000 nodes and 200000 edges from a seeded generator (edges only from lower to higher index)",
    brute: "DFS enumerating every path from each source (exponential)",
  },
  {
    key: "topo-lexicographic-heap",
    topics: ["topological-sort", "heap", "sorting"],
    technique: "lexicographically smallest topological order with a min-heap (Kahn's algorithm with a priority queue), detecting cycles",
    large: "a DAG with 100000 nodes and 200000 edges from a seeded generator",
    brute: "enumerate permutations and test them (exponential), or repeatedly scan all nodes for the smallest zero-indegree node (O(n^2))",
  },
  {
    key: "union-find-offline",
    topics: ["union-find", "sorting", "graph-bfs"],
    technique: "offline processing: sort edges and queries by threshold and answer with a union-find (path compression + union by size)",
    large: "100000 nodes, 200000 weighted edges and 100000 queries from a seeded generator",
    brute: "for each query, BFS over the edges below the threshold (O(q * (n + m)))",
  },
  {
    key: "union-find-parity",
    topics: ["union-find", "graph-bfs"],
    technique: "union-find with parity/relation to the root (bipartiteness or consistency of 'same/different' constraints answered online)",
    large: "100000 nodes and 200000 constraints from a seeded generator",
    brute: "for each constraint, BFS over the constraints so far to check consistency (O(m * (n + m)))",
  },
  // ----- binary search / two pointers / sliding window / prefix sums -----
  {
    key: "binary-search-answer",
    topics: ["binary-search", "greedy", "array"],
    technique: "binary search on the answer with a greedy O(n) feasibility check (minimize the maximum, maximize the minimum, k-th value)",
    large: "an array of 100000 integers up to 10^9 and a k, from a seeded generator",
    brute: "try every candidate answer in increasing order with the same check (O(answer range * n)), or an O(n^2) scan",
  },
  {
    key: "binary-search-kth-pair",
    topics: ["binary-search", "two-pointers", "sorting"],
    technique: "k-th smallest pairwise value (distance, sum, product) via binary search over the value with a two-pointer count",
    large: "an array of 100000 integers from a seeded generator and k near n*(n-1)/4",
    brute: "enumerate every pair, sort, take the k-th (O(n^2 log n))",
  },
  {
    key: "window-monotonic-deque",
    topics: ["sliding-window", "queue", "prefix-sum"],
    technique: "monotonic deque over prefix sums or window values (shortest subarray with sum >= k allowing negatives, sliding window maximum combined with another constraint)",
    large: "an array of 200000 integers in [-1000, 1000] from a seeded generator",
    brute: "check every subarray (O(n^2))",
  },
  {
    key: "window-exactly-k-distinct",
    topics: ["sliding-window", "hash-map", "two-pointers"],
    technique: "count subarrays with exactly k distinct values (or exactly k of a property) as atMost(k) - atMost(k-1) with a sliding window and a count map",
    large: "an array of 200000 integers over 1..1000 and k around 100, from a seeded generator",
    brute: "for every start, extend the end while tracking a set (O(n^2))",
  },
  {
    key: "prefix-2d-submatrix-target",
    topics: ["prefix-sum", "matrix", "hash-map"],
    technique: "fix a pair of rows, collapse the columns into a 1-D array of column sums and count/maximize with a hash map or Kadane (O(rows^2 * cols))",
    large: "a 250x250 matrix of integers in [-5, 5] from a seeded generator",
    brute: "enumerate every submatrix with four nested loops and sum it (O(rows^2 * cols^2 * cols) or at best O(rows^2 * cols^2))",
  },
  // ----- stack / heap / intervals / greedy / sorting -----
  {
    key: "stack-monotonic-contribution",
    topics: ["stack", "array"],
    technique: "monotonic stack to find previous/next smaller element for every index, then a contribution sum or the largest rectangle (O(n))",
    large: "an array of 200000 integers up to 10^9 from a seeded generator",
    brute: "for every pair (i, j) scan the range for its minimum (O(n^2) or O(n^3))",
  },
  {
    key: "heap-two-heaps-lazy",
    topics: ["heap", "sliding-window"],
    technique: "two heaps (max-heap for the lower half, min-heap for the upper half) with lazy deletion to maintain a running or windowed median/k-th value",
    large: "an array of 100000 integers and a window size around 500 from a seeded generator",
    brute: "sort each window separately (O(n * k log k))",
  },
  {
    key: "heap-k-way-smallest-range",
    topics: ["heap", "sorting", "two-pointers"],
    technique: "k-way merge with a min-heap tracking the current maximum to find the smallest range/window covering one element from every list",
    large: "k = 100 sorted lists with 1000 elements each from a seeded generator",
    brute: "merge everything, then for every start scan forward until every list is covered (O(N^2))",
  },
  {
    key: "intervals-sweep-line",
    topics: ["intervals", "sorting", "heap"],
    technique: "sweep line over interval endpoints (sorted events with +/- weight) combined with a heap or running structure to answer a global optimum",
    large: "200000 weighted intervals with endpoints up to 10^9 from a seeded generator",
    brute: "for every interval endpoint, scan all intervals that cover it (O(n^2))",
  },
  {
    key: "greedy-deadline-heap",
    topics: ["greedy", "heap", "intervals"],
    technique: "exchange-argument greedy: sort by deadline/time and keep a heap of chosen items, popping the worst when the schedule becomes infeasible",
    large: "100000 jobs with deadlines and profits/durations from a seeded generator",
    brute: "enumerate every subset or every order of jobs (exponential)",
  },
  {
    key: "sorting-merge-count",
    topics: ["sorting", "array", "recursion"],
    technique: "merge-sort style divide and conquer that counts cross pairs (inversions, reverse pairs, range sums in [lo, hi]) in O(n log n)",
    large: "an array of 200000 integers in [-10^6, 10^6] from a seeded generator",
    brute: "check every pair (O(n^2))",
  },
  {
    key: "fenwick-order-statistics",
    topics: ["array", "sorting", "bit-manipulation"],
    technique: "coordinate compression + Fenwick tree (binary indexed tree) answering count-of-smaller/greater or prefix queries online in O(n log n)",
    large: "an array of 200000 integers in [-10^9, 10^9] from a seeded generator",
    brute: "for every element, scan the elements after it (O(n^2))",
  },
  // ----- strings / parsing -----
  {
    key: "string-kmp-z",
    topics: ["string", "string-compression"],
    technique: "KMP failure function or Z-function (shortest palindrome by prefix matching, smallest period, count occurrences with overlaps) in O(n)",
    large: "one string of length 200000 over a 2 letter alphabet from a seeded generator (highly repetitive so naive matching is slow)",
    brute: "naive O(n^2) comparison for every candidate position",
  },
  {
    key: "string-regex-dp",
    topics: ["string", "dynamic-programming", "parsing"],
    technique: "regular-expression or wildcard matching with '.' and '*' (or '?' and '*') via dp[i][j] over the text and pattern",
    large: "a text of 1500 'a's and a pattern of 300 'a*' pairs followed by one 'b' (no match, exponential backtracking); the statement's constraints must allow these lengths",
    brute: "recursive backtracking without memoization (exponential)",
  },
  {
    key: "hash-pair-sums",
    topics: ["hash-map", "array", "math"],
    technique: "meet in the middle on pairs: hash map of pairwise sums so a 4-element condition is answered in O(n^2)",
    large: "four arrays (or one array) of 1500..2000 integers in [-10^4, 10^4] from a seeded generator",
    brute: "enumerate three indices and look up the fourth, or all four (O(n^3) or O(n^4))",
  },
  // ----- matrix / math / bits / recursion / backend -----
  {
    key: "matrix-histogram-rectangle",
    topics: ["matrix", "stack", "dynamic-programming"],
    technique: "per-row histogram heights + monotonic stack to find the largest rectangle/count of all-ones rectangles in O(rows * cols)",
    large: "a 1000x1000 0/1 matrix with ~80% ones from a seeded generator",
    brute: "for every top-left and bottom-right corner, check the rectangle (O(rows^2 * cols^2) or worse)",
  },
  {
    key: "matrix-trapping-heap",
    topics: ["matrix", "heap", "graph-bfs"],
    technique: "best-first search from the border with a min-heap (2-D trapping rain water / minimum effort path): pop the lowest boundary cell and push neighbours",
    large: "a 500x500 height map with values up to 10^5 from a seeded generator",
    brute: "for every cell, BFS to find the lowest barrier around it (O((rows*cols)^2))",
  },
  {
    key: "math-sieve-counting",
    topics: ["math", "prefix-sum"],
    technique: "sieve (smallest prime factor or divisor counts up to N) combined with inclusion-exclusion or a divisor sweep to count pairs/values in O(N log N); avoid any product above 2^53",
    large: "N = 10^6 (a JSON number) and, if needed, an array of 200000 values <= N from a seeded generator",
    brute: "check every pair with gcd (O(n^2 log n))",
  },
  {
    key: "bits-xor-trie",
    topics: ["bit-manipulation", "array", "hash-map"],
    technique: "binary trie over 30-bit integers to answer maximum XOR / count pairs with XOR below a bound in O(n * 30)",
    large: "an array of 100000 integers below 2^30 from a seeded generator",
    brute: "check every pair (O(n^2))",
  },
  {
    key: "bits-sos-dp",
    topics: ["bit-manipulation", "dynamic-programming"],
    technique: "sum-over-subsets (SOS) DP over 16-bit masks to count pairs/elements whose AND is zero or whose mask is a subset of another, in O(2^16 * 16)",
    large: "an array of 100000 integers below 2^16 from a seeded generator",
    brute: "check every pair (O(n^2))",
  },
  {
    key: "recursion-meet-in-middle",
    topics: ["recursion", "bit-manipulation", "binary-search"],
    technique: "meet in the middle: enumerate subsets of each half (2^(n/2)), sort one side and combine with binary search or two pointers",
    large: "n = 34..36 integers up to 10^9 and a bound, from a seeded generator",
    brute: "enumerate all 2^n subsets",
  },
  {
    key: "backend-lfu-cache",
    topics: ["backend-simulation", "hash-map", "linked-structure-simulation"],
    technique: "LFU (or LRU with TTL) cache with O(1) get/put using hash maps plus frequency buckets or doubly linked lists; the function replays an operation list and returns the outputs",
    large: "200000 operations over a capacity of 5000 keys from a seeded generator",
    brute: "scan every stored key on each eviction (O(ops * capacity))",
  },
  {
    key: "backend-scheduler-heap",
    topics: ["backend-simulation", "heap", "greedy"],
    technique: "event simulation with a min-heap of (time, id) and tie-breaking rules (single-threaded CPU scheduling, rate-limited job queue with retries), O(n log n)",
    large: "100000 jobs with arrival times and durations from a seeded generator",
    brute: "at every step scan all pending jobs for the next one (O(n^2))",
  },
];

const topicKey = (topic) => String(topic ?? "").trim().split(/[\s(]/)[0].toLowerCase();

export function servesTopic(archetype, topic) {
  return archetype.topics.includes(topicKey(topic));
}

export function findArchetype(key) {
  return HARD_ARCHETYPES.find((a) => a.key === key) ?? null;
}

/** Archetypes that serve a topic (first word of the TOPICS entry). */
export function archetypesForTopic(topic) {
  const t = topicKey(topic);
  return HARD_ARCHETYPES.filter((a) => a.topics.includes(t));
}

/**
 * Picks an archetype for a hard problem. Prefers one that serves the topic and has not been used yet
 * (`exclude` holds keys of rejected attempts); falls back to any archetype when the topic has none.
 */
export function pickArchetype(topic, exclude = [], random = Math.random) {
  const unused = (list) => list.filter((a) => !exclude.includes(a.key));
  let pool = unused(archetypesForTopic(topic));
  if (pool.length === 0) pool = archetypesForTopic(topic);
  if (pool.length === 0) pool = unused(HARD_ARCHETYPES);
  if (pool.length === 0) pool = HARD_ARCHETYPES;
  return pool[Math.floor(random() * pool.length)];
}

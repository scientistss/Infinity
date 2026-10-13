# Published fleet/Save attribution, 2026-10-13

This independent diagnostic does not change or release game code. It targets
`7ab569045996a1a6ad8ce1aee477092144dfad74` (0.6.27-alpha.1, save 9/r14).

## Input and execution identity

- Rebuild the exact target with Node 22 and its committed lockfile.
- Require the published release SHA-256
  `c9411d7c952c217feb5c796d8c0653877ae650caa67fdc17941cfa2ce6c92e6f`
  and all 62 asset hashes, including native HTTP and executed V8 JavaScript.
- Reproduce the anonymous extreme workload using the archived
  `4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b` factory and the target's actual
  strict migration adapter. The complete fixture must equal SHA-256
  `51175269239ac45ac76b1ea8fc1f1bb3d6e9f42da58709b9ecdf6a171e680a98`,
  as used in candidate CI 38327276107. This is a synthetic capacity scenario,
  not a player save or a natural progression claim.
- A separate hidden-source-map build is used only for offline interpretation.
  Its execution bytes must equal the production build. Source contents must
  bind to exact Git blobs or the two specifically allowed locked dependencies.
  The actual production `dist` is the only served application.

## Nine fresh browser contexts

Three repetitions each run:

1. A visible fleet steady window after the same overview/orders/fleet navigation
   and warm-up. Native clock, RAF and storage remain in use. A 1 ms CPU sampler
   and bounded native timeline retain original stacks, script, layout and GC
   events. These instrumented windows establish attribution only.
2. A trusted manual Save with CPU Profiler and Tracing never enabled, and
   Debugger disabled before input. DOMStorage observation is never enabled in
   these contexts, avoiding protocol copies of the complete save during the
   write. Capture/bubble listeners record timestamps and minimal event identity
   only. Storage reads, JSON and full-state evidence are outside the timed span.
3. A separately sampled manual Save for stack attribution. Its timing is not
   pooled with the unprofiled observations.

All contexts use the same pinned Playwright version, the runner's official
Chrome binary, 1440 × 1100 viewport and headless mode matching the existing
performance suite. Exact binary/version, source identities and raw artifacts
are recorded. The body is bounded at 180 seconds with bounded cleanup; the
workflow has a separate 205-second hard watchdog.

The Save interval is document capture through post-application document bubble.
It includes synchronous Save handling/render and timestamp-observer overhead;
Runtime/Performance inspection and native browser input remain attached. It is
not an inspector-free user baseline, exclusive serialization time or
input-to-paint latency. Original before/after storage bytes, the single trusted
input and save status are checked after the interval. Separately sampled Save
contexts retain full native DOMStorage events and their protocol overhead.
After the browser closes, all 27 saved originals must pass the target's strict
reader and whole-envelope read/export comparison, without ignored fields.

## Interpretation and limits

Sample weights are estimates, not exact function durations. Inclusive stacks
overlap and must not be summed as independent costs. Native timeline categories
can also overlap. Unrecognized JavaScript frames invalidate attribution; the
diagnostic observer has its own exact script identity and remains separately
accounted. A failed window retains originals and cannot be counted as success.

The existing complete performance run establishes an extreme fleet limitation,
including substantial script and layout work. It does not identify individual
hot functions. This diagnostic must finish before selecting an optimization.
Any later improvement claim requires matched unprofiled input/environment
comparisons and unchanged economic, timing, queue, persistence and authority
contracts. No optimization result is claimed by this preparation checkpoint.

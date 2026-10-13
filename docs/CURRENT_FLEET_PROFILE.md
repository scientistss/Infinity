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

The first diagnostic, `c2776bff182f992ece17420400053cd806cf30cb`, run
38332131237, failed its original strict time-weight check in the first fleet
window. Its immutable artifact 11783142126 is SHA-256
`a33a1f4d11322e0741183475ab5636a682ae7d74be8f434487293108559ede21`.
The native profile contains 1,526 records and 48 negative adjacent time deltas
(minimum −1,054 microseconds). It has no missing node IDs or unbound script
frames. This result remains failed; its remaining eight windows did not run.

For subsequent fixed nine-window diagnostics, capture completeness and weighted
attribution completeness are separate, explicit results. Original finite
signed deltas and sample order are retained. If deltas cannot form the strict
nonnegative weights, all weighted function-time fields/rankings are unavailable,
not zero, and no complete weighted comparison is claimed. A separate histogram
counts every entry in the original `samples` array, including native/program,
idle, GC and diagnostic frames. Its percentages mean share of recorded samples,
not CPU-time share, calls, rate, or duration. `hitCount` remains separate: in the
first original its sum is 1,435, unlike the 1,526 raw sample records.

This deliberately does not import the complete
[DevTools CPUProfileDataModel](https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/cpu_profile/CPUProfileDataModel.ts),
which reconstructs/sorts timestamps and can replace isolated program samples.
The [V8 inspector serializer](https://raw.githubusercontent.com/v8/v8/main/src/inspector/v8-profiler-agent-impl.cc)
exports adjacent timestamp differences directly. These primary sources explain
representation and possible interpretation; they do not establish why this
particular capture contains nonmonotonic timestamps. No raw sample is sorted,
clamped, discarded or replaced here. The exact DevTools revision accompanying
the recorded Chrome binary has not been established.

All nine predetermined contexts are attempted within the same original total
deadline. Unknown sources, invalid sample structure, failed native actions,
trace capture or cleanup remain accumulated hard failures and a nonzero final
exit, even if later windows succeed. No failed window is rerun or selected out.
Successful capture of all windows with some unavailable weighted metrics is
reported explicitly, rather than presented as complete time attribution.

The existing complete performance run establishes an extreme fleet limitation,
including substantial script and layout work. It does not identify individual
hot functions. Qualified individual windows may motivate an independent prototype, but a
failed diagnostic remains failed. Any improvement claim requires complete
matched unprofiled input/environment comparisons and unchanged economic, timing, queue, persistence and authority
contracts. No optimization result is claimed by this preparation checkpoint.

## Exact automation-source qualification

The second diagnostic, `ec8527baff9069b44414a443ae9cbc0138b73f3b`, run
38333296574, attempted all nine predetermined contexts. Eight qualified; the
first sampled Save failed because one recorded listener was not source-bound.
Its artifact 11784260925 is SHA-256
`82a42e3f54b246c0f94a952552aeaef14e46aedc1c26eac8dc1ee6928384cdc7`.
The failed run did not execute the final whole-save checker and remains failed.

The missing listener's recorded metadata matches the official Playwright 1.57.0
persistent hit-target interceptor: full payload SHA-256
`da5bdf40a12539d0aa73e8db00b6dc8d3f5b00e7b808f1c679a8be72b75e4e14`,
302,153 source units and end position 8028:6. Reconstructing the expected payload
from the verified official wheel is explanatory evidence, not a substitute for
the absent original runtime source.

Subsequent runs retain every prepared script's complete `getScriptSource` bytes
before profiling, keyed by script ID and content hash. The additional qualified
helper must match the complete expected payload, the pinned installed generated
source and wrapper, the exact dependency version, and a live non-default isolated
context belonging to the current frame. Blank URLs alone never qualify a source.
Other helpers, including the separately observed default-world payload, remain
unqualified. Automation records have their own category, separate from game code
and the diagnostic observer. Source capture and decoding occur outside every
measured/profiled interval; JavaScript source is decoded as data, never executed
by the reconstruction step. Unknown sampled code is still a hard failure.

The three independently qualified fleet windows in the second run recorded
341–358 querySelector entries among 1,491–1,506 original sample records
(22.6–24.0%). These are sample frequencies, not CPU-duration percentages. The
three unprofiled Save capture-to-bubble spans were 141.7, 145.7 and 152.9 ms.
They describe this fixed extreme workload and observation method; they neither
prove exclusive serialization time nor establish an optimization result.

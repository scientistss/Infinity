# Fleet row lookup: measured change and 0.6.29 delivery

Status at 2026-10-13 04:13 UTC: **0.6.29-alpha.1 / save v9 r14** is delivered
from exact commit [49303d3740cf223955386ff984b335ca9b110087](https://github.com/scientistss/Infinity/commit/49303d3740cf223955386ff984b335ca9b110087).
[Formal CI 38341533349](https://github.com/scientistss/Infinity/actions/runs/38341533349)
passed all seven required game jobs and the aggregate. The unchanged exact CI
assets were deployed to the existing isolated private playtest. The additional
[development-branch promotion run](https://github.com/scientistss/Infinity/actions/runs/38345113448)
was still running when this record was written; its result is separate from the
successful candidate. This documentation does not change the delivered build.

## Change

A new first-match index is built inside each fleet render, after any row rebuild.
It preserves descendant document order and exact data-flight attribute strings.
A removed cached row falls back to the original selector, including its original
missing-row error. The index never crosses a render or authorizes a control.
Existing text/style writes, control registration, economic rules and save r14
remain unchanged. Actual fleet markup uses native elements; synchronous
custom-element insertion/reordering during a paint is outside this premise.

## Exact prototype evidence

- Baseline: 7ab569045996a1a6ad8ce1aee477092144dfad74, v0.6.27-alpha.1.
- Prototype: 5359676473c3b55e09acce33487ffd5f3ce8925a, same package/save version.
- [Independent experiment CI](https://github.com/scientistss/Infinity/actions/runs/38336133576):
  both equivalence and performance jobs succeeded, with 4,616 unit tests in each.
- The complete single-production-file patch SHA-256 is
  a488d9df9f99bba7ad408936bbbf963c9a5400a1e3eae19daebb0a8fca02e176.
- Equivalence artifact11785421264: 15,909,874 bytes, SHA-256
  942076712fa85fc7ee397db3899915cf821e5ef74e55e0a031c782df480f63c3.
- Performance artifact11785052610: 20,362,198 bytes, SHA-256
  009827f0292f127c7e333c6bd3130800f3b17dc92ab86afd0393f05ad0aa7aff.

Independent review verified all 612 prototype files, 605 baseline files and 286
historical fixture-source files against their exact Git trees, both complete
62-asset manifests and all 20 contexts' HTTP/executed-V8 bindings. Both sides use
the same current-r14 save bytes derived by the actual archived factory and
strict reader; only the two native envelope timestamps are rebased for timing.
This is an anonymous synthetic workload, not a player's save.

Four separate controlled-clock contexts produced 18 byte-identical checkpoint
pairs: complete body DOM, focus path, recorded form properties and all
localStorage bytes. Trusted tab selection, numeric input, repeated actual app
renders and manual Save were retained. The 24 focused row lifecycle unit tests
use a declared DOM double; they are not native-browser lifecycle evidence.
The separate real-DOM boundary check described below also passed before release.

The timing job completed 16 fresh foreground contexts, ABBA twice for each
workload, with three native 1.5-second windows per context. All 48 windows and
four adjacent pairs per workload are retained. No CPU Profiler, Tracing or
DOMStorage observation was enabled. Actual Date, performance, RAF, timers,
storage and selector primitives, focus/visibility, viewport and reduced-motion
settings were checked. Native autosave was not suppressed; any detected write
would reject the complete comparison. No outliers or failed windows are removed.
Both actual unchanged readers checked all 156 retained raw saves across the two
jobs, yielding 312 whole-envelope and canonical-fixed-point references.

## Results on this runner

Chrome154.0.8037.97, Playwright1.57.0, headless Linux6.17.0-1022-azure, Node22.
Numbers are medians of paired context medians, using all three windows each.

| Workload | Script difference | Script ratio | Task difference | Task ratio |
| --- | ---: | ---: | ---: | ---: |
| 2 planets / 1 fleet | -0.84245 ms/s | 0.981687 | -1.50968 ms/s | 0.976470 |
| 100 planets / 1,000 fleets | -74.0503 ms/s | 0.880496 | -83.4084 ms/s | 0.909337 |

All four extreme pairs improved: Script ratios0.878986/0.859281/0.882006/0.883694;
Task ratios0.923588/0.902490/0.916185/0.899410. The moderate second Task pair
regressed by0.38007 ms/s (ratio1.006067); it remains included. This supports a
steady-fleet Script reduction of about11.95% and Task reduction of about9.07%
under these fixed pressure conditions, not a universal speedup estimate.

The extreme candidate is still heavily busy: individual Task windows810–865
ms/s, RAF-gap p95 around50ms, and159 fully-contained long tasks totaling8,658ms
plus one boundary task. Baseline had180 such tasks totaling12,684ms plus eight
boundary tasks. Boundary observations remain separate. RAF gaps are not paint
or input latency. CDP durations overlap and must not be summed or presented as
exclusive lookup CPU costs. No Save-event latency was measured in this experiment.

## Completed formal release acceptance

The earlier recycle-stage source seal correctly rejected the prototype's new
space-panel bytes. The experiment verified the exact new patch, then ran the
unchanged ring/type/bundling/release tools separately; it did not claim ordinary
npm build or release approval. The formal 493 release uses the new cumulative
source contract without rewriting any of the twelve previous seals. Ordinary
npm build, 4,616 unit tests, all seven mandatory game jobs and the aggregate
passed on that exact commit. All 616 tracked source files and modes, all seven
source archives, and every 62-asset distribution were independently checked.
The seven bundles are identical. Prototype performance claims remain bound to
5359676; the entire formal src/public tree is byte-identical to that prototype.

The exact c92912b625d2f4f3d078d8fc5084526e76e4a50b test/docs diagnostic is also
carried forward. Its [complete CI](https://github.com/scientistss/Infinity/actions/runs/38333125369)
passed all seven jobs and aggregate without changing any game asset. The formerly
stalled 320px/job202 boundary completed with two real native RAF callbacks in
25.8ms; all361 waits and1,225 demolition checks passed. This establishes one
successful instrumented replay. It neither explains the earlier timeout nor
proves an intermittent freeze was fixed. No timeout occurred to exercise the
new native failure-capture branch in that run.


## Real-DOM boundary proof

Diagnostic [02249317dff109b77eab2d2d72c09a1337e730bc](https://github.com/scientistss/Infinity/commit/02249317dff109b77eab2d2d72c09a1337e730bc)
passed [CI 38343142336](https://github.com/scientistss/Infinity/actions/runs/38343142336).
Its [artifact 11787807193](https://github.com/scientistss/Infinity/actions/runs/38343142336/artifacts/11787807193)
is 39,142,651 bytes, SHA-256
`a73e21939ff2b8397f9acb5f496687cf2f71d078336a5f998b0b9885b9d72910`.
The four diagnostic additions leave all 612 prototype files unchanged.

Two fixed four-scenario groups completed sixteen fresh contexts and forty exact
checkpoint pairs. Explicit test DOM mutations cover nested and duplicate rows,
raw attribute strings, removal during a text write, missing rows/children,
hidden lists, remounts and retained old handles. The actual application's bound
RAF callback performs all 24 observed paint transitions; no replacement render
helper is invoked. Body DOM, form properties, focus, retained handles and every
localStorage byte are compared without field removal. Exact exception names and
messages match; the six original differing bundle stacks remain in raw evidence.
This controlled-clock, intentionally disturbed DOM is not ordinary player input
or timing evidence. Arbitrary reentrant custom elements remain outside its scope.

All 98 physical full-save occurrences were checked by both original readers and
exporters: 196 actual receipts. The duplicated group origin is byte-checked and
maps these to 97 logical occurrences / 194 logical checks; only four distinct
raw byte values occur, and no occurrence was skipped or memoized. Each fixed
49-envelope reader group retains a 75-second bound. CI Node v22.23.3 completed
them in 45.540 and 45.295 seconds. Each retained 202 synchronously flushed
startup/import/item/completion events. Instrumentation reverses byte-for-byte
to the original strict-reader payload. The final aggregate recomputes raw hashes,
identities, ordered receipts and the full census, rather than trusting summaries.

Earlier diagnostic runs remain failed: 845 stopped before browser execution at
a fixture-loader cwd error; e71 completed 34 pairs before the aggregate browser
time limit; 49 completed all browser pairs but exceeded the single 75-second
reader batch limit. The fixed groups preserve every original check and bound,
with the overall ten-minute diagnostic job unchanged. The formal 9b candidate's
old negative-test error-prefix mismatch also remains a failed run. Its successor
repaired only the exact active-stage expectation; all forty workflow Python
commands were then run locally (920 passed, two existing optional archive replay
skips) before the new complete formal CI. None of these failures is relabelled.

## Exact formal artifact and remaining limits

The [formal verify artifact 11788040886](https://github.com/scientistss/Infinity/actions/runs/38341533349/artifacts/11788040886)
is 39,975,396 bytes, ZIP SHA-256
`c57b5654b5f44ddf7027f3ee870b8bf496baaad646dd97f798b7f404a108e2e8`.
The complete source ZIP SHA-256 is
`b917c2b2387c5680bba858f4f73f314dd03b1ad30f13ded3e0c7446631e4f089`;
release.json is
`fffec2b2f02ee88e8390aed2fd76a5817e941fcb26a7b5315d7d7caee48088ad`.
The executed JavaScript `assets/index-BY906m_f.js` hashes to
`90d3029acbefb4a9d376b6c1689f016872b171cb153a02d9d701135dc85c469a`;
CSS remains `933b22bb315129b2869c408736a9602a0180312aa2d5d053fb44e2208a02f8ed`.

All 37 required browser reports passed, with 51,183 checks and 8,403 hashed raw
proof references independently resolved. The separate hidden-resume report's
106 checks were also verified. The full 66-scenario manual-payment census was
recomputed from its original groups. These counts describe finite acceptance
coverage, not complete future-roadmap or real-device validation.

The continuation retained all twelve performance runs, six pairs and 36 fixed
samples against archived 4bceef r8. That cumulative comparison is mixed and often
slower; it is not causal evidence for this fleet lookup patch. Current ordinary
Task medians are about 49–61 ms per wall-second, with no steady-window long tasks.
The extreme fleet Task median is about 874 ms per wall-second, RAF-gap p95 about
50.1 ms, and 44 long tasks total 2,561 ms across its three fixed windows. The
suite has correctness/watchdog gates, not an absolute-ms performance threshold.
Its interaction EventTiming p95 is 48 ms in the moderate profile and 264 ms in
the combined profile. It does not establish universally smooth play or 60 fps.

Separate unchanged-7ab [profiling CI 38337623899](https://github.com/scientistss/Infinity/actions/runs/38337623899)
completed all nine fixed diagnostic contexts and 27 strict save checks. Its
unprofiled manual Save capture-to-bubble spans were 141.6, 137.5 and 145.1 ms;
these include synchronous handler/render and observer overhead, not paint or
exclusive serializer time, and are not measurements of a Save optimization.
All six CPU profiles retain negative timeDeltas, so only raw sample frequencies
are usable; no weighted function CPU shares are reported. No retired unreadable
source allowance was needed for that successful run. Earlier failed profiles
remain unqualified.

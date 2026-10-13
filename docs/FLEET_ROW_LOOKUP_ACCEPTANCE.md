# Fleet row lookup: measured prototype and release gate

Status: the prototype is measured and source-audited. Version 0.6.29-alpha.1 is
being prepared for ordinary build and complete release acceptance; it is not
released by the prototype evidence below.

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
A separate real-DOM boundary check is required before this release is accepted.

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

## Release acceptance still required

The earlier recycle-stage source seal correctly rejected the prototype's new
space-panel bytes. The experiment verified the exact new patch, then ran the
unchanged ring/type/bundling/release tools separately; it did not claim ordinary
npm build or release approval. The formal release must use a new cumulative
source contract without rewriting the previous seals, pass ordinary npm build,
full units, the real-DOM boundaries and all seven mandatory jobs plus aggregate
on its exact final commit. Prototype performance claims remain bound to5359676.

The exact c92912b625d2f4f3d078d8fc5084526e76e4a50b test/docs diagnostic is also
carried forward. Its [complete CI](https://github.com/scientistss/Infinity/actions/runs/38333125369)
passed all seven jobs and aggregate without changing any game asset. The formerly
stalled 320px/job202 boundary completed with two real native RAF callbacks in
25.8ms; all361 waits and1,225 demolition checks passed. This establishes one
successful instrumented replay. It neither explains the earlier timeout nor
proves an intermittent freeze was fixed. No timeout occurred to exercise the
new native failure-capture branch in that run.

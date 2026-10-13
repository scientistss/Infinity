# Fleet row lookup: independent prototype experiment

This is a same-version A/B experiment based on published commit
`7ab569045996a1a6ad8ce1aee477092144dfad74`. Package version remains
`0.6.27-alpha.1`, save version 9/revision 14. This is not a release, deployment,
merge recommendation, or claim that the original seven required jobs passed.
No previous measurement result is inherited.

## Exact change and source boundary

The sole production change is `src/ui/space-panel.ts`: create a fresh, first-match
map of fleet rows for each render, then use it only during that render. Detached
rows fall back to the existing lookup. No persistent control-authority cache,
simulation, save, merchant, transport, or revision-15 change is included.

`check-fleet-row-experiment.py source` requires both exact checkout identities,
reads every tracked file's actual bytes and executable mode, checks the complete
`src`/`public` inventories, and compares all baseline tracked paths. Only the
exact changed file and seven named new experiment/test/document files are
accepted. Existing workflows, provenance manifests, build tools, package lock,
configuration, assets, core logic and data remain unchanged. Git replacement
objects and external diff/text-conversion programs are disabled.

The full, unabridged binary-capable patch is pinned, not a generic permission to
change that file:

- Patch SHA-256: `a488d9df9f99bba7ad408936bbbf963c9a5400a1e3eae19daebb0a8fca02e176`
- Candidate file SHA-256: `970c1f8a9102ef14f9680b3e34d22354abb4bb71353e4778c1a5fce6c777f65e`
- Patch options: `--no-ext-diff --no-textconv --no-renames --binary --full-index --no-color --unified=3 --src-prefix=a/ --dst-prefix=b/`

The old immutable cumulative recycle-preview seal correctly rejects this new
UI delta under ordinary `npm run build`. It is neither weakened nor regenerated.
The baseline runs the original complete build. Only this independent prototype
uses the exact new source proof followed by the unchanged ring-art check,
TypeScript check, Vite build, and release-manifest writer. Full candidate unit
tests remain mandatory in both matrix jobs. This explicit prototype pipeline
must not be reported as an ordinary candidate `npm run build` pass. A future
release requires a new cumulative adoption and all existing acceptance gates.

## Independent CI jobs and inputs

`.github/workflows/fleet-row-lookup.yml` triggers only on
`codex/infinity-fleet-row-index-20261013` pushes or manual dispatch. It does not
edit or trigger the existing release workflow through its branch pattern.
Its `equivalence` and `performance` matrix entries have no dependency on each
other, `fail-fast: false`, and job limits of 8 and 15 minutes. Both must succeed
for a complete experiment. No `continue-on-error`, skipped gate, deployment
permission, repository secret, user save, or external user account is used.

Each job independently archives both source trees and both built distributions,
uses Node 22, installs locked dependencies, and runs the official existing
browser-prerequisite script (Playwright 1.57.0 and official Chrome).

The baseline release manifest must have SHA-256
`c9411d7c952c217feb5c796d8c0653877ae650caa67fdc17941cfa2ce6c92e6f`.
Both distributions must contain exactly their 62 declared assets plus the
manifest, with no extras, omissions, or symlinks. Release metadata and all
CSS/static assets stay equal; candidate production JavaScript is distinct.

The actual old fixture factory at
`4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b` generates:

- Moderate: `scripts/render-scheduling-fixture.ts`, 2 planets and 1 fleet
- Combined: `scripts/performance-fixture.ts`, 100 planets and 1,000 fleets

The actual baseline's `scripts/prepare-r9-performance.mjs` adapts each original
fixture. Expected complete adapted-file SHA-256 values are:

- Moderate: `4947a1e9fcbb007edc52a2f2ebf0bddc4f4842eeefffd248a4af0c641cb38096`
- Combined: `51175269239ac45ac76b1ea8fc1f1bb3d6e9f42da58709b9ecdf6a171e680a98`

Both variants consume the same immutable revision-14 `pairedNative.afterSave`.
Only the two envelope timestamps are rebased at seed time, with exact whole-save
comparison proving that no other value changed. This is not a migration A/B
comparison. Raw original fixtures and original `afterSave` bytes are retained.

## Runtime identity and separate evidence modes

The baseline and candidate are served on separate loopback origins at ports
4176 and 4173 under `/Infinity/`. Every declared HTTP asset is byte-checked
against the corresponding local distribution. In every fresh context, named
executed V8 production script sources are captured and compared byte-for-byte
with the HTTP JavaScript and release hashes. Extra or duplicate named scripts,
wrong HTML, wrong assets, missing inputs, and incomplete evidence fail closed.

### Native performance

Two fixed ABBA blocks per workload yield 16 fresh foreground contexts and
48 native 1.5-second measurement windows. Each context navigates through
Overview, Orders, and Fleet with trusted inputs and warmup/settling periods.
Native clocks, animation frames, timers, storage, and DOM selectors stay intact.
Debugger is disabled before warmup; CPU profiling, tracing and DOMStorage
instrumentation are never enabled. There is no interaction, source inspection,
DOM readback, or strict-save evaluation inside a CDP measurement window.

Evidence retains raw CDP boundary metrics, native RAF callback timestamps,
long-task entries, complete save bytes, visibility/focus and workload checks,
runtime source identity, environment and viewport, and cleanup outcomes.
The small observer's exact source is recorded. Runtime/observer overhead remains.

All three windows enter each context median. All four adjacent AB/BA pairs per
workload enter reported paired differences and ratios, including regressions.
There is no favorable-outlier selection, numerical pass threshold, confidence
interval, or universal speedup claim. RAF gaps are not compositor paint time or
input-to-paint latency. Overlapping CDP CPU metrics are not exclusive call-site
costs or sampler-derived durations. These data concern steady fleet rendering,
not manual Save latency, startup, or every game workflow.

### Controlled equivalence

Four additional fresh contexts, in a separate job, deliberately control clocks.
Nine checkpoints per context cover initial display, tabs, focused numeric input,
three fleet updates, and manual Save. Baseline and candidate must match the
complete body DOM, focused element, recorded form properties, trusted event history,
and every native storage byte without field deletion or normalization. This
mode is deterministic behavioral evidence and never performance evidence.

### Whole saves after teardown

After the browser worker and its supervisor finish, the checker revalidates
source identity, completion, exact case/window inventory and cleanup. It then
uses **both actual source versions'** `importSave`, `deserializeState` and
`exportSave` implementations to check every complete envelope, strict-reader
acceptance, full-value round trip, and repeated canonical fixed point.

The timing job checks 114 raw saves against both readers (228 checks): two
original inputs, 16 seeds, and six boundary saves per context. The controlled
job checks 42 saves against both readers (84 checks): two inputs, four seeds,
and 36 checkpoint saves. Checkpoint raw strings are copied verbatim into new
files; original snapshots and raw save files are never rewritten. Full economy,
fleet, paid-job, planet, and clock values remain in each comparison. This is a
whole-envelope acceptance check, not an independent simulation oracle.

## Bounded failures and retained artifacts

Controlled worker/outer-supervisor budgets are 75/100 seconds; native budgets
are 560/590 seconds. Individual browser cleanup attempts are bounded at five
seconds. Shell watchdogs are later, at 115/610 seconds, leaving internal
cleanup and final-record time. The supervisor tracks owned process ancestry
and start times, never broad process-name matches. Unknown reparented processes
are an explicitly documented observational limit. Each HTTP server is also
cleaned up through bounded, owned-PID handling.

Each matrix job always attempts artifact upload, including failed or partial
runs. Artifacts are named `fleet-row-{equivalence|performance}-{candidate SHA}`
and retained for seven days. The evidence includes:

- Exact source archives, complete source/file-mode report, and pinned patch
- Both built distribution archives, release manifests and HTTP asset bindings
- Original/adapted fixtures, input hashes, environment and build/unit logs
- Each context's executed scripts, snapshots/metrics, errors and cleanup records
- `browser/report.json`, `browser/watchdog.json`, and `saves-check.json`

A missing, timed-out, partially uploaded, invalid, or incomplete run is not a
pass. Reading this document or passing Python mutation tests alone does not
establish native browser equivalence or performance. The experiment's measured
result must be read from the artifacts for the exact candidate commit.

# Fleet row real-DOM boundary diagnostic

This independent, same-version diagnostic compares the real application at
`5359676473c3b55e09acce33487ffd5f3ce8925a` with the original application at
`7ab569045996a1a6ad8ce1aee477092144dfad74`. Both remain version
0.6.27-alpha.1, save version 9/revision 14. It adds no production changes.
It is not a release, deployment, cumulative-source adoption, timing result,
or replacement for the seven existing native acceptance gates.

## Exact source and runtime boundaries

The diagnostic checkout adds exactly four new files: this document, its workflow,
its browser driver, and its Python contract tests. Every existing file is required
to match 535, including the original benchmark, its tests, existing workflows,
source seals, assets, dependencies and production code. Full actual file bytes
and executable modes are verified against both Git trees.

CI checks out separate, exact 535 and 7ab worktrees. The unchanged 535 source
checker validates its own frozen 612-file inventory against 7ab. It does not
validate the diagnostic checkout as a widened candidate. The original source
checker, frozen inventory and cumulative release seal are not edited.

The target uses the already-defined, exact-source experiment build: ring-art
check, TypeScript, Vite, and manifest writer. This is explicitly not an ordinary
535 `npm run build` pass. The 7ab baseline uses its ordinary full build. All 535
unit tests run. Driver, target, baseline and fixture source archives, both built
distributions, build logs and environment information are retained.

Both releases must have exactly their declared 62 assets plus release.json. The
baseline manifest hash is pinned. Every HTTP asset is checked against its built
bytes; each fresh browser context captures the real executed V8 production
script and checks exact HTTP, manifest and local-dist byte equality. The entire
body comparison has no normalization. Head assets necessarily differ between
the two production bundles and are validated independently by their manifests.

## Immutable whole-game workload

The actual 4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b factory and the actual 7ab
adapter recreate the existing combined fixture:

- Complete fixture SHA-256: 51175269239ac45ac76b1ea8fc1f1bb3d6e9f42da58709b9ecdf6a171e680a98
- Current-r14 afterSave SHA-256: 27e53db00f583e45db975d5b4421991de58a776d633c81da3efddca933340301
- 100 planets and 1,000 fleets, with the complete economy and all other fields

Only the two envelope timestamps are rebased at seed time, with exact validation
of every other value. No private save or paused/protected-state fixture is used.
All 16 contexts start fresh from those same full bytes.

## Eight explicit DOM-tampering scenarios

These mutations are deliberately unusual diagnostic inputs, not a claim that
players create them through ordinary controls. They complement the 24 DOM-double
unit cases with native browser selectors, containment, text removal and focus.

1. Ordinary navigation, focused fleet draft, real next-frame progress and Save.
2. Nested, classless article duplicate before the original; reorder the wrapper
   and verify the new first match on the next actual application render.
3. List-self matching attribute plus leading-zero and decimal ID impostors;
   remove the sole exact descendant and retain the expected missing-row error.
4. A first duplicate nested inside an earlier row's title is removed by that
   title's actual text write; the surviving later duplicate must be painted.
5. The last matching row is removed by an earlier title's actual write; retain
   the precise missing-row exception, prior writes, untouched later row and
   detached handle.
6. A removed progress child causes the exact missing-child exception after the
   earlier text writes; later rows and the removed child remain untouched.
7. Replace the entire list while retaining its old list, row and button handles;
   then replace a new row. Detached handles must never receive later writes.
8. Hide only the fleet list while leaving the Fleet tab active; verify its real
   renderer still paints it, then unhide and paint again.

Each context uses trusted native mouse/keyboard input for Overview, Orders,
Fleet, a focused draft and the final Save. DOM changes use only native DOM
operations. They never call a game action API, invoke a copied renderer/helper,
evaluate extracted renderer source, synthesize input events or replace DOM
prototypes. The original diagnostic controlled clock releases the actual bound
application's queued RAF callback. Sentinel field checks and complete snapshots
prove the targeted rows were really painted rather than merely comparing two
unchanged poisoned trees.

The exception path does not manually rearm an app frame that stopped at an
exception. The real tab and Save handlers still run, and the resulting complete
native save is checked. Fresh contexts isolate all poisoned scenarios.

## Evidence, equality and bounds

Every checkpoint archives the complete body DOM, all existing form/detail
properties, focus, trusted input sequence, every localStorage key/value and
complete native current save. Selected original/duplicate/replacement handles
also retain full outerHTML, form properties, connection and containment state,
including detached nodes. This catches writes that could disappear from the
visible DOM. All original production exception names, messages and stacks are
archived before qualification. Only names/messages participate in semantic
exception equality; unmodified stacks retain the differing minified bundle URLs
and offsets. Unexpected page errors and request failures fail the run.

All 40 baseline/candidate checkpoint pairs must match exactly; no subset pass,
error suppression or state projection is accepted. The two original source
readers/exporters subsequently validate all 97 complete save envelopes (194
reader/export checks), including every checkpoint, every initial seed and the
original afterSave. This runs only after owned browser/process cleanup.

The body is bounded to 120 seconds, with five-second cleanup operations, a
150-second owned-process watchdog and a 160-second shell timeout. PID/start-time
ancestry limits cleanup to observed owned processes; unobserved reparented
processes cannot be proven absent. Failure snapshots and original exceptions
are retained before cleanup. The independent job has a ten-minute limit and
triggers only on pushes to `codex/infinity-fleet-row-dom-20261013`.

No original native timing context, measurement window, result or comparison is
changed or rerun by this diagnostic. Passing these finite cases is not a proof
for arbitrary reentrant custom-element DOM mutation. Local Python contract tests
are not a native-browser pass; the new CI artifact is the browser evidence.

## Fixture-loader correction after the first CI attempt

Run 38338811456 at diagnostic driver
`845cfba6ffc02a6ef477388cc760ba3793c3b3c7` passed both builds and all 4,616 target
unit tests, then failed before browser execution. The old fixture factory used
bare `--import tsx` from the diagnostic checkout, which intentionally has no
installed node_modules. Node resolves that loader from its current directory.
The corrected command starts in the installed baseline worktree while still
executing the exact old factory path and writing the same original fixture.
The adapter already starts there; the later strict-reader process already uses
the installed target worktree as its cwd. A static regression test checks all
three loader calls. The original failed run remains failed evidence; no browser
assertion, timeout, source boundary or original performance result is changed.

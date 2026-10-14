# Energy tightening implementation checkpoints

## Current exact-source acceptance and release — 2026-10-14

**0.6.32-alpha.1 / v9/r16**, source
[`6af7a5e85a522ba89478c5e95d919a2c04fb2e55`](https://github.com/scientistss/Infinity/commit/6af7a5e85a522ba89478c5e95d919a2c04fb2e55), passed
[run 38505882754](https://github.com/scientistss/Infinity/actions/runs/38505882754): all twelve mandatory workers and the aggregate succeeded.
All twelve share the exact source/build identity: 719 tracked source files,
62 production assets plus release metadata, Node v22.23.3. The primary worker
passed all 5,012 unit tests. This acceptance belongs to the exact game SHA;
a later documentation commit does not inherit its CI result.

The development ref was advanced without force from 166c77f to 6af7a5e and read
back at that SHA. The separate [promotion run 38510286345](https://github.com/scientistss/Infinity/actions/runs/38510286345)
completed successfully at **2026-10-14 04:53 UTC**. An independent readback at
05:01 UTC confirmed all twelve required jobs and the aggregate succeeded,
the development ref remained at 6af7a5e, and `main` remained unchanged at
`ebbabd7854a5bb77fc154a63202c1a1b705d3c39`. Its result is separate from the
candidate run. The exact candidate artifact was separately published at
04:15 UTC with a succeeded result, after the release metadata and all 62
production asset hashes were verified.
Release JSON SHA-256:
`327ead4aa33749136c24ff966a6b4337e9ad00114dd39907f8324abf4179d030`.
The A-stage atomic-building release remains recorded in [its own status](BUILDING_BATCH_STATUS.md).

### Accepted evidence and its limits

- The 68 native challenge cases comprise 18 controls, 35 lifecycle/authority/
  storage cases and 15 migration/protection cases. All retained gates, including
  atomic building batches, NPC orbital combat and scout rehearsal, also passed
  at this SHA; no earlier green substitutes for an unrun current gate.
- A separate continuous solar route starts from a pristine fixed-seed new game:
  4,383 actions, 4,201 original one-second engine frames, 149 actual building
  payments, four research payments, two manual curvature confirmations and
  22 actual save/reload checkpoints. It earns the score without importing an
  eligibility checkpoint, then actually pays for and completes the third
  building/research queue positions. The solar lane records 18,487 checks
  and no screenshots. Separate native controls provide the 320/390/768/1440
  viewport evidence; those screenshots are not from the continuous solar lane.
- This is **compressed logical time**, not 4,201 seconds of natural wall-clock
  play, an all-strategy balance result or a real-device endurance test. The
  three earlier strategy checks remain separate transition evidence; their
  imported earned eligibility checkpoints do not become continuous playthroughs.
- The same-Chrome reference is sealed before the native application context
  starts. It independently executes the same domain engine against fixed actions;
  it is not an independent mathematical engine. Independent price/payment,
  completion and production-score checks supplement exact complete-state,
  receipt and save-byte comparisons. No floating tolerance was introduced.
- Supported same-lineage r2–r14 inputs pass their complete old validation and
  backup/write/readback path before receiving an inactive, zero-score challenge.
  Native r14 coverage includes real startup migration, byte-exact original backup,
  upgrade and continued state. The seven startup migration storage faults are
  separate Map-backed unit evidence within the 97 formally passing tests in
  `tests/energy-challenge-migration.test.ts`: backup quota/drop/read, primary
  quota/drop/read and concurrent modification. That suite's r14 input is the
  public additive r13→r14 projection of actual archived r13-reader output,
  adding explicit null scout-snapshot slots; it is not a native r14 producer.
  The six native enter/abandon/finish write/readback failure cases cover
  challenge operations, not those seven r14 startup-migration faults. Unknown
  r15 and malformed r16 receipts are protected rejections, not arbitrary
  cross-route compatibility.
- Two optional historical archive-replay tests were skipped in the primary job
  (old render-order snapshot replay and the pinned 2,889-check orbital-journal
  replay). Required current gates remained mandatory and passed. An additional
  22-checkpoint inactive-world differential passed locally on Node v24.19.0;
  this is supplemental synthetic domain evidence, not Node 22 CI or native
  browser coverage, and does not establish every inactive gameplay behavior.

### Performance boundary

The existing paired benchmark uses fixed historical 4b / 0.6.11, spanning
multiple releases. Current ordinary navigation EventTiming P95 is 48 ms, with
no observed steady long tasks in those sampled windows; extreme P95 is 248 ms.
The extreme sample's maximum steady long task is 80 ms; maximum startup long
task is 448 ms. These observations do not establish a
challenge-specific speedup, general smoothness or a save optimization.
The pressure fixture has **no active challenge**, so active-challenge extreme
performance remains unmeasured. A future active-challenge diagnostic is a
remaining validation task, not a result or a performance improvement already
delivered. See the [remaining roadmap](ROADMAP_ACCEPTANCE.md#剩余路线分组).

## Historical checkpoints

The following records retain their original timing and outcomes. Later success
does not turn a failed run green or make an earlier unreleased checkpoint a release.

### Final two-worker failure and test-only successor

[`7b1b9028`](https://github.com/scientistss/Infinity/commit/7b1b9028ce78478287c9e8d63c3e3798c47dafb4),
[run 38503753970](https://github.com/scientistss/Infinity/actions/runs/38503753970),
failed `energy-solar-route` and `verify-continuation`; the aggregate also failed.
Ten other required workers passed, which did not make that run releasable.

The solar route had completed its states, payments and reloads before the final
storage audit rejected genuine pre-RAF autosaves. In three captured receipts,
`savedAt` was one second later than the most recent completed `lastTickAt`:
the timer saved before the next frame. The test had assumed the clocks always
matched. The successor binds those exact pre-frame receipts to the complete
trace and unchanged raw bytes; it does not tolerate arbitrary clock differences.

The separate continuation failure came from an old randomized deployment
fixture: its fixed destination could equal the randomized home's coordinates.
The test-only repair chooses a provably distinct legal destination and preserves
explicit regressions rejecting captured duplicate-coordinate seeds. These two
repairs are independent and leave production rules unchanged. The fresh 6af run
passed its own complete gates; neither diagnostic replay nor later success
reclassifies the original 7b run.

## Same-browser reference and migration evidence repair (unreleased)

The complete [309ec203 run](https://github.com/scientistss/Infinity/actions/runs/38496521976)
failed. Seven of its twelve required workers succeeded; five and the aggregate
failed. Controls completed 18 cases and lifecycle completed 35 cases. Those
results do not establish a releasable challenge version.

The [08ad6d00 numerical diagnostic](https://github.com/scientistss/Infinity/actions/runs/38499599843)
reproduced the first solar disagreement using the original application bytes.
The first 116 complete states agreed. At event 117, Node 22.23.3 and Chrome
154.0.8037.97 differed by one binary ULP in Math.pow(1.1, 4), crossing the existing
Decimal addition's rounding boundary. The only state difference was the final
digit of the deuterium balance. Neither save adoption nor tick count differed.
This diagnostic is not completion of the solar playthrough.

The follow-up therefore adds a separate, source-bound reference run in the
same Chrome launch. Its input contains only the fixed 4,383 actions, never
observed UI state or precomputed monetary outcomes. It constructs a new game,
replays the domain APIs, and performs its own 22 Map-backed SaveSession
checkpoints. Complete states, receipts and raw saves are sealed before this
isolated context closes and the native application context starts. This is
an independently executed reference using the same domain engine, not an
independent mathematical implementation. Independent catalog-price, payment,
completion and production-score checks remain additional requirements.

The original Node report and oracle are retained as different-runtime evidence.
Native comparisons remain exact for every complete state, payment receipt and
save byte; no rounding tolerance is added to those comparisons. Production math
is unchanged. Reference preparation has an explicit 60-second bound, followed
by the unchanged 600-second native window and 20-second cleanup allowance.
The job remains limited to 15 minutes; any failed preparation terminates the
run without recalculating expectations from native observations.

The [56ac3f06 migration diagnostic](https://github.com/scientistss/Infinity/actions/runs/38501009650)
remained red but preserved the previously missing receipt details. Its real
r14 startup wrote the facilities UI preference, then a trusted navigation to
the save page changed that preference to save. The storage checker had allowed
only primary and backup keys. The follow-up binds these two specific preference
writes to native navigation witnesses and storage cuts while retaining the
complete primary/backup replay. Other keys, extra transitions and changed
values remain rejected. The original 309 migration failure lacked those rows;
its exact cause cannot be retrospectively established from this new run.

All twelve required workers and their aggregate must succeed at the final
source SHA before this candidate can replace the published atomic-building
version. Local preparation, diagnostic success and partial native runs do not
satisfy that release requirement.

## Native checkpoint evidence and continuous-route gate

The source repair checkpoint
[`bb7fc33`](https://github.com/scientistss/Infinity/commit/bb7fc33f1b51c5e27324c9df7df2a27a357802ff)
retains the production code from the preceding candidate. The exact preceding
[`ceda5a2` run](https://github.com/scientistss/Infinity/actions/runs/38489528477)
is red. Its lifecycle worker completed 35 cases; controls exercised all 18
cases but failed its final evidence census. The migration worker failed at a
save-receipt observation boundary. Several legacy gates rejected outdated
source or fixture contracts, and three workers were cancelled before their
complete acceptance. Passing portions do not make this candidate releasable.

The first three browser strategy checks entered normally and verified paid
building proofs, then imported engine-earned eligibility checkpoints before
finishing. They establish those separate transitions, not continuous browser
earning. An additional mandatory solar-route worker therefore starts from one
pristine fixed-seed new-game envelope and performs 4,201 original one-second
engine frames, 149 building payments, four research payments, two challenge
confirmations and 22 actual save/reload checkpoints. It never imports an earned
checkpoint. The final reward and third building/research slots must be used
through the UI. This is compressed logical time, not a wall-clock playthrough.

The proposed acceptance has twelve required workers plus the aggregate gate;
the original eleven workers and 68 challenge cases remain required. The solar
worker has a 600-second execution budget and bounded cleanup. Its local oracle
and runner checks are preparation evidence only until exact-source native CI
and all existing gates succeed.

The previously released atomic-building version remains the playable baseline.
Its [promotion run](https://github.com/scientistss/Infinity/actions/runs/38488563403)
also completed successfully. No energy-challenge candidate has been released.

## Complete source checkpoint, not yet released

`f2e0549c3345aa0cb5485c27df6cf2351cb59f6a` preserves the complete domain,
UI, r16 migration and eleven-job acceptance integration, including the
released atomic-building ancestry 166c77f. It is an explicitly unreleased
source checkpoint, not a successful CI or deployable artifact.

Its exact local source tree passed 5,009 of 5,010 unit tests on Node 24.19.0;
the existing 120-mission deep-release loop exceeded its unchanged 15-second
limit. The isolated file subsequently passed 26 tests, including that loop
in 12,155 ms; this does not turn the full run green. A new test's missing
deserialize step also caused two TypeScript diagnostics in the real build.

Clean, fixed-seed engine routes reached the challenge target and next legal
curvature after 2,269 / 2,340 / 2,785 challenge logical seconds. All three
independent route checks, eleven supplemental branches, 32 migration
preparations, 15 migration inputs and six migration-oracle tests passed.
These are local compressed simulations, not native browser acceptance.

Actual workflow enumeration found narrow preparation errors: directory-based
checkers were passed file paths, several current-version checks still named
r14, and an immutable historical producer needed the strict source projection.
The follow-up corrects these contracts, the test type conversion and exact
eleven-job census without changing production or weakening historical checks.
The real local Node 24 identity was correctly refused by the Node 22-only
native-plan builder. Final exact-SHA build, native lifecycle/migration, old
regressions and the eleven required jobs remain mandatory before release.

## UI and raw-input compatibility checkpoint

The follow-up source checkpoint includes the challenge panel, explicit native
confirmation and SaveSession write/readback-before-adoption integration. It
also restores the established raw descriptor/cycle rejection priority before
the new challenge authority scan. All checks remain enabled.

Local integration evidence on Node 24: the 152 challenge save/migration tests
passed after the ordering repair. The earlier 22 panel/presentation/integration
checks passed; the complete UI must still pass native browser acceptance at
the final source SHA. In the larger uncommitted preparation workspace, 1,517
tests in 28 legacy suites passed after precise fixture/revision adaptations;
those preparation changes are not included in this UI checkpoint.

Three fixed-seed, paid engine strategies reached the challenge finish and
used the third ordinary queue slot after 2,269 / 2,340 / 2,785 logical seconds.
That evidence was generated from a working-tree diagnostic and is not final
source-bound CI or a real-time browser playthrough. The final clean-source
routes, complete native lifecycle/migration gates and all existing gates remain
required. This checkpoint is unreleased.

## Earlier domain-only checkpoint

Unreleased, unmounted domain and v9/r16 persistence checkpoint based on the
atomic building-template source checkpoint `56c16a1c73e24347919141c2b789655ae59e82cb`.
This branch is not the development or deployed version.

Implemented: doubled mine energy demand; bounded downward-quantized production
score; four actual paid home-building completion proofs; explicit one-use
entry, abandonment and successful finish; one additional ordinary queue slot;
automatic-curvature restrictions; complete supported historical migration and
protected rejection of unknown r15 data. See `ENERGY_CHALLENGE_SPEC.md` for the
exact rules and limitations.

Local Node 24 verification on 2026-10-13: 251 tests in the four domain, score,
save and migration files passed. An additional 22 UI tests passed in the larger
local integration workspace, but that UI is not included in this checkpoint.
Independent Python arithmetic review checked 36,216 rational-oracle cases and
6,000 subdivision cases. Those are not native browser or final CI acceptance.

The whole-workspace TypeScript check is still red on legacy fixture-generator
current-revision literals and a Node-only diagnostic script's type imports.
The natural two-curvature route, inactive-world differential, native controls,
four widths, complete legacy gates and final source identities remain pending.
No release, development-branch promotion or Site update is authorized by this
checkpoint alone. Historical r15 recovery remains outside this implementation.


## Bounded history consistency follow-up

Independent review found two impossible histories accepted by the unpublished
reader: attempt 2 completed after only two total curvatures, and an entry job
floor with fewer than four IDs available. Three focused counterexamples first
failed while the 55 existing reader tests passed. The reader now requires each
issued attempt's entry curvature (retained after abandonment), one additional
finish curvature for a completion, and the original four-ID entry capacity.
The completed follow-up run passed 171 domain/save/migration tests. A coherent
synthetic curvature fixture explicitly includes the pre-existing first-launch
card; its original normalization mismatch is retained in local test evidence.

The save-screen text explicitly lists supported r2–r14 sources and rejects the
unpublished r15, matching the actual reader. This does not establish full native
or final CI acceptance.

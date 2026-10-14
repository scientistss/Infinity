# Energy tightening implementation checkpoints

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

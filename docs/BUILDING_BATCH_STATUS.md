# Multi-planet building template release

## Current continuation

The A-stage release below remains accepted. Its separate
[promotion run 38488563403](https://github.com/scientistss/Infinity/actions/runs/38488563403)
subsequently succeeded. The B-stage successor 6af7a5e / 0.6.32-alpha.1 / v9/r16
was accepted and released after all twelve required jobs and the aggregate
passed, including this batch's 25 native cases. See [the current challenge acceptance](ENERGY_CHALLENGE_DOMAIN_STATUS.md).
The r16 successor preserves this finite batch's independent budgets, local
payment and authorization rules. New paid admissions use the current challenge-
aware queue capacity; registration itself still does not pay.
The earlier pending status and failures below are preserved as historical records.

## Released 2026-10-14

Version **0.6.31-alpha.1**, save v9/r14, was accepted at
`166c77fe0fc36ac40eb390804c2a96598870006e` and deployed from its exact CI
artifact. [Run 38484078861](https://github.com/scientistss/Infinity/actions/runs/38484078861)
passed all eight required jobs and the aggregate. All eight packages contained
the same 651 source files, 62 production assets and Node v22.23.3 identity.
The new native suite passed all 25 scenarios and 774 checks, including actual
two-planet registration/payment/completion and 320/390/768/1440 layouts.

Player entry: Plans → building templates → the 2–4-planet application section.
Choose a saved template and planets, set each independent cap, review, then
confirm once. Registration does not prepay; real construction pays locally.

Performance is a limitation, not an improvement claim. The fixed comparison
is historical 0.6.11, not the preceding release. In the moderate fixture the
18 recorded EventTiming interactions had P95/max 56 ms and no observed steady
long tasks. Extreme combined orders used about 639 ms of script and 669 ms of
total task time per second; extreme input P95 was 240 ms. A previously used,
then folded batch panel retains bounded checks of at most four selected
planets; its independent CPU cost was not measured. Future optimization must
preserve retirement and one-use authorization checks.

Release JSON SHA-256:
`23b2cf288d0f1a7803213ace6c3bf214f9b57d5730bb8672af58288e59304c29`.
The development ref was advanced normally from 6f73735 to 166c77f; its separate
promotion run 38488563403 was still running when this document was prepared.
The historical failed runs below remain failed.

## Original candidate observations

This candidate integrates one explicit application of a saved building template
to 2–4 selected owned planets. Each ordinary finite order retains its own fixed
local payer, goals and resource caps. The confirmation shows the total cap and
each planet's shortfall. Registration does not prepay construction or create
transport, recurring work, or a shared wallet.

The whole domain batch is prepared privately. The UI adopts it only after the
existing SaveSession write/readback succeeds. An uncertain write preserves the
original visible state under protection and retains recovery bytes; it does not
claim to roll back browser storage. Completed or already-covered goals are an
explicit no-op, including no save write.

The earlier domain-only checkpoint is
`a0a212cab84c5ac4419016a99912da220c31d8b1`. Its published baseline was
`6f73735534ffc1b0e47a01935d8c6e3ff786c989`, version 0.6.30-alpha.1. The release
keeps save v9/r14. The original candidate observations below preceded the
complete acceptance recorded above.

## Local observations on 2026-10-13

- Node v24.19.0: 71 new domain, presenter and DOM-double tests passed. The wider
  focused source/presenter group passed 92 tests. TypeScript and the complete
  build passed, producing 62 hashed assets.
- The first complete local run passed 4,706 of 4,709 tests. One exact historical
  host-text assertion needed the newly approved retirement call; that assertion
  subsequently passed without changing its ordering or safety requirements.
  Two unchanged large-loop tests exceeded their original 5-second and
  15-second timeouts, also on the targeted follow-up. The earlier clean baseline
  had two timeouts, but not the same pair. These observations do not establish
  a complete local or cloud pass; no test limit was increased.
- The independent fixed-seed natural route starts with ordinary initial
  resources, pays for progression and real colonization, and reaches two
  planets. Its original diagnostic covered 2,520 logical seconds, four
  independently priced batch jobs, and exact final ownership. This is
  compressed simulation, not human wall-clock play.
- Additional synthetic 3/4-planet, capacity and authority cases are explicitly
  labeled. The final clean producer and native acceptance must be rerun at the
  final commit; earlier diagnostic hashes are not release evidence.

The required native job contains 25 fixed scenarios, including an unobserved
natural control, actual paid-job/owning-task identities, full-state protection
witnesses, exact storage-byte no-ops, and four viewport widths. It preserves raw
HTTP/V8 sources, screenshots and per-document event records. The aggregate
reopens those originals, the complete source ZIP and all assets, and requires
all eight jobs at the same source/build/runtime identity.

See [the bounded contract and evidence design](BUILDING_BATCH_SPEC.md). No
native browser or full CI success is claimed by this source checkpoint.

## First native run and activation repair

Exact candidate `56c16a1c73e24347919141c2b789655ae59e82cb`, run
`38478207514`, failed its new batch browser job `115574074659` after 141
successful identity/initial-state checks. The first real checkbox activation
was cleared by an over-eager delegated click authorization before the browser's
input/change events. No batch registration or payment had been verified yet.
The immutable failed artifact is `11856226056`, ZIP SHA-256
`36a0a86437f24f0fafb9c4bb9c8ef7fb6ac7ffae425cf04dcb032c8765a809fd`.

Three new event-order regressions fail on that original implementation. The
minimal non-action-button early return passes all 15 panel tests; actual action
buttons retain complete authorization and silent-draft checks. Failure capture
now runs before Playwright teardown, with independent diagnostic attempts;
11 focused Python contracts preserve all 25 scenario bodies and budgets.
The resealed production inventory retains all 215 entries and fourteen prior
seals; 193 source checks and 15 synthetic provenance tests passed locally.
This repair still requires a new exact-SHA full native CI run. The original
failed run is not reclassified as successful.


## Cold-reload source-identity follow-up

At `c7b24dac00d43550a6803376e966e1d7945acf54`, the repaired native
selection flow passed both planets' four actual paid jobs, fixed task/payer
identities, and full completed economic state. The first reload then failed
the strict unique HTTP 200 source-response gate (181 checks recorded). That
run did not record the failing HTTP status, so its cause is not labeled a
304, cache hit, or production defect. Its original artifact is preserved in
run 38482665623, artifact 11858131739.

This test-only follow-up explicitly disables HTTP cache through the existing
CDP connection before navigation, as the other correctness suites already
do. It records full response status, redirect/request metadata and CDP cache
flags before asserting the unchanged unique-200 and full HTTP/V8/release
byte checks. It makes no claim about normal cache behavior or performance.
All 25 scenarios and existing time budgets remain mandatory; final exact-SHA
CI is still required.

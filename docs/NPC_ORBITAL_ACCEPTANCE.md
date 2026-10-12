# NPC orbital battle and compact-report acceptance

Evidence checkpoint: **2026-10-12**. The bounded r13 orbital loop and compact
reports are accepted at game commit
[576e92910a07456a9b237b809e7c77d95203bbe5](https://github.com/scientistss/Infinity/commit/576e92910a07456a9b237b809e7c77d95203bbe5),
**0.6.21-alpha.1 / v9/r13**. Its own
[full CI 38179829606](https://github.com/scientistss/Infinity/actions/runs/38179829606)
and [job 114589839938](https://github.com/scientistss/Infinity/actions/runs/38179829606/job/114589839938)
succeeded on 2026-10-11 at **22:58:21 UTC**. Publication of this exact game
artifact was separately confirmed by the release owner at **23:11 UTC**.
CI success alone is not deployment evidence; this record does not assert that
all hosted copies or GitHub Pages serve that version.

This is a documentation checkpoint about that immutable game artifact. It does
not change its source, built assets or save format, and does not assign its CI
result to a later documentation commit. Earlier failures remain failed.

## Accepted scope

A player can scout a live NPC garrison, pay for legal research and ships, pay
round-trip dispatch fuel, fight up to six rounds, retain permanent losses,
bring integer loot home once, then scout and collect again after production.
The compact closed report shows outcome, delivery, route, permanent player
losses, actual loaded loot, rounds and readable game time. Expanded details
retain exact per-type losses, historical technology, raw time and round values.
Viewing either form never pays, fights or retries a dock.

- Persistent bounds are **512 sites, 64 unfinished attacks including blocked
  returns, and 60 terminal reports**, with live battle-return reports pinned.
  Defeated sites remain present; pruning cannot regenerate their garrisons.
- A victory with survivors takes at most half of each actual NPC stock, as
  integer loot limited by surviving cargo capacity. Losses remain permanent.
- Landed stock is limited to `1e15` ships per type per planet; an attack carries
  at most `1e12` per type, with safe-integer empire totals. Other mission limits
  are unchanged. An unsupported landing retains cargo and survivors for retry.
- Every adopted NPC transfer proves the exact equation
  `V(W_after) + r_after = V(W_before) + r_before + signed_integer_transfer`.
  Each local resource right is a canonical string with `0 <= r < 1`.
  There is no epsilon, discarded loot, compensating grant or repeat credit.
  Fuel still requires the main deuterium wallet to afford the full integer quote.
- Current r13 requires valid remainder fields. Validated same-lineage r2–r12
  migrations initialize zero rights. Earlier unreleased r13 saves missing them
  reject under protection. Ordinary production and purchases preserve rights
  separately; a right is not universally spendable and has no promised flush time.

Rules: [orbital persistence](NPC_ORBITAL_ATTACK.md),
[exact settlement](NPC_REMAINDER_SETTLEMENT.md),
[compact display](NPC_REPORT_DISPLAY.md). NPC construction, spending-led growth,
ranking rewards, retaliation, full planetary warfare and battle rehearsal are
**not completed by this release**. Later r14 work is separate preparation.

## Exact artifact and completed gates

[Artifact 11718137190](https://github.com/scientistss/Infinity/actions/runs/38179829606/artifacts/11718137190)
is **144,048,012 bytes**, ZIP SHA-256
`8480816e6db37ff6175e2d78a12cc8de656bf77345e7c4d97b0c2e2cb48fb122`.
Its 501 source files were checked against exact Git blobs; all 62 release-manifest
assets were byte-verified, with no missing or extra files in either set.

| Artifact member | SHA-256 |
| --- | --- |
| `source.zip` | `89a9c2262fd66f863ba88da500883bd775fd925f703f847aca929e98f5e540c2` |
| `dist/release.json` | `7246dd01af051fa7ba7c21ae009f073756a0505c72f2d2266e4314f31fe6fa17` |
| `npc-attack-evidence/npc-attack-browser-report.json` | `5b9e1d6f89ec7e03cd31095dac02c8cea345432adc21e8de84ad3d566db1d159` |
| `npc-attack-natural-report.json` | `165395b699e6cc4e80c73d84e1ed2f9ba2c7a314ff5e914275e69c253a01cbfd` |
| `npc-attack-native-report.json` | `73529140b888704652939bd22bb4cd2e07cf1548bc68fef949ef52abe0b2c3ba` |

| Gate on exact 576e929 | Recorded result |
| --- | --- |
| Main unit suite | **3,465 / 3,465**, 99 test files; zero failed or pending |
| Build and source contracts | Passed; original UI has 46 pinned files |
| Independent orbital engine schedules | **948 / 948 each**, frequent-reload and actual four-reload oracle |
| Native battle, compact reports and protection | **6,590 / 6,590**, completed, no page errors or failed requests |
| SaveSession | **5,721 / 5,721**, completed |
| Render scheduling and exact legacy panel parity | **1,944 / 1,944**, completed |
| All required earlier native gates | Completed successfully, including NPC economy, demolition, terraformer, IRN, transport, orders, templates, formations, ring, navigation and persistence |
| Native performance report | 313 validity checks passed; no absolute-speed pass is implied |

Two **optional archived replay preparation tests** were explicitly skipped;
they are not part of the 3,465 passing main unit tests. The completed orbital
report contains 351 evidence entries, 263 checked evidence-file hashes and 33
HTTP/executed-JavaScript page bindings. Its sealed journal reconstructs all
6,590 checks without missing report keys; the final report adds only recorder,
worker-exit, supervisor-time and process-cleanup metadata.

## Natural route and native interaction

The unchanged public r12 origin has raw-save SHA-256
`047d49cbf04fd5424bca4d7d45e861e0439a0d51c4ac54700f77e263bb8eadcc`.
The 31-adopted-second continuation injects no wallet, technology, ship or clock
values into the **engine route**. In the browser, Date/performance/RAF timestamps
are explicitly controlled, while HTTP, input, file picker, dialogs and Storage
are native. This is one economic execution with four-width witnesses, not four
independent playthroughs or 31 seconds of real-time human play.

Attack #7 draws after six rounds, permanently losing one player and two NPC
light fighters. Attack #8 wins and delivers **265 / 132 / 23** M/C/D at the actual
first dock boundary, `18.79955725610165` adopted seconds. After production and
scout #9, attack #10 collects **44 / 22 / 4** from the still-empty garrison.
The final crystal wallet is `452477.4625733589`, with right `0.00000000006`;
all three exact equations hold and no active fleets remain.

Both engine schedules pass independently; their full states are not claimed to
be byte-identical:

| Reload schedule | Reload checkpoints | Final complete-state SHA-256 |
| --- | ---: | --- |
| Frequent-reload regression | 34 | `51b5fe6f28226e48ec087261d8876eddbc9f830967e2e442ea0bcd8d1d7c3241` |
| Actual native-main oracle | 4 | `aba6ce7b3334c7487f95591782941b9bbc362144a39a8574173f719df438dc92` |

Native branches cover same-time reloads, recall, same-time paid arrivals,
once-only cold-start catch-up, curvature, abandonment, blocked return and paid
capacity release/retry. Protection probes cover stale/hidden/cloned/reinserted
controls, same-world import, current-save write/drop/readback faults, migration
backup faults and actual cross-tab storage events. Observed conflict protection
is not atomic localStorage compare-and-swap.

The main route is natural continuation; three boundary setups are explicitly
synthetic: a colony metal right of `0.25`, a `1e15`-fighter full port, and a long
special-character colony name plus one delivered report's source ID. The last
uses real file import and lawful abandonment, not a native rename or a naturally
fought colony battle. Closed summaries, opened details, local round scrolling,
focus, clipping and actual controls are checked at **320/390/768/1440 px**.
Round columns scroll within their accessible region on narrow screens; they are
not all simultaneously visible. Origin display uses the current matching planet
or an unavailable-origin fallback; combat facts remain the saved receipt.

## Performance and coverage limits

The separate successful [native-clock pressure run 38168264544](https://github.com/scientistss/Infinity/actions/runs/38168264544)
used measurement commit `74aa5094527ba5ed75621178e748f0039507d501` against game
`a8454529ee5abf8d915fee7f4cc1c5d77d6a8ef7`, not 576e929. Its synthetic workload
has 512 sites, 64 attacks and 60 terminal reports, with disclosed prerequisite
seeding and repeated fuel resets. Three paired control/pressure runs include
18 five-second CPU windows and 30 trusted actions. In that run, pressure-save
capture-to-document-bubble intervals were **52.7–59.9 ms**, and event-to-second-
RAF callback-entry intervals were **55.8–62.8 ms**. These establish a substantial
extreme-save cost, not completed-paint latency or smooth 60 fps.

The separate observer [12a7a3ea comparison](https://github.com/scientistss/Infinity/actions/runs/38169615509)
and import-snapshot [4a317d46 comparison](https://github.com/scientistss/Infinity/actions/runs/38173224158)
did not demonstrate a robust speedup. Neither experimental candidate is part
of this released source. The exact 576 CI does not contain a new standalone
512/64/60 pressure experiment.

The exact full-CI performance report compares r8 with r13 across many changes,
not orbital combat in isolation. Combined-maximum script CPU medians regress
about **9–27%**; startup script median rises **183.444 → 275.977 ms**, and Fleet
aggregate long-task median rises **116 → 488 ms per sample**. Frame p95 remains
50 ms. Valid measurements do not establish a general performance improvement.

Automated coverage is Linux Chromium. The separate native-background gate has
two real hidden intervals of at least 32 seconds; this does not establish
multi-hour sessions, OS sleep, clock jumps, Safari or physical-phone behavior.

## Failed and incomplete checkpoints remain historical

- [c66bc826](https://github.com/scientistss/Infinity/commit/c66bc826f3e74a6261cba78a8038fe7ee0515c68)
  rejected the ordinary first winning dock for precision and preserved cargo.
  The previously cited 19-second state was a later blocked observation; six
  ordinary retries stayed blocked. Later balance-dependent success did not fix it.
- [a8454529 / CI 38165735193](https://github.com/scientistss/Infinity/actions/runs/38165735193)
  failed after 1,086 SaveSession checks at protected-frame observation; orbital
  native acceptance had not run.
- [d97d37c9 / CI 38167566978](https://github.com/scientistss/Infinity/actions/runs/38167566978)
  passed 6,243 SaveSession checks, then stopped after 201 orbital checks at
  horizontal interaction preparation.
- [08f9e9f / CI 38169259939](https://github.com/scientistss/Infinity/actions/runs/38169259939)
  reached 477 orbital checks before a full-state timestamp mismatch between
  34-reload and four-reload schedules. Both schedules remain preserved.
- [3444a6ca / CI 38170880093](https://github.com/scientistss/Infinity/actions/runs/38170880093)
  failed at the 900-second worker bound after 2,889 passing orbital assertions.
  The interrupted stack was full-report JSON serialization; it does not establish
  the sole cause of elapsed time. The second collection and later gates were
  incomplete. [Artifact 11713324817](https://github.com/scientistss/Infinity/actions/runs/38170880093/artifacts/11713324817)
  retains the partial record, ZIP SHA-256
  `a2479c0d17ada3efce49a4cba00ca0fc3dda574acb45ea13eb37d0c773a57856`.
- [7554c662 / CI 38173505724](https://github.com/scientistss/Infinity/actions/runs/38173505724)
  completed 4,884 orbital checks after the journal-only recorder correction,
  but failed the later exact galaxy-hint parity assertion. Render scheduling
  stopped with 1,140 recorded passing checks; this was not a green full run.
- [db972991](https://github.com/scientistss/Infinity/commit/db972991f69dbec3364953c0003e7bc664380258)
  and [cc19bf5e](https://github.com/scientistss/Infinity/commit/cc19bf5e1a459cf8e667ca55f4891ca9ffd25a71)
  retained 4,884 and 6,590 completed orbital checks respectively, but each failed
  exact shipyard visible-content parity after 1,386 passing render checks.
  576 binds the literal facility-copy changes and preserves all remaining parity.
- Standalone [9ebdf89c / run 38179802557](https://github.com/scientistss/Infinity/actions/runs/38179802557),
  [job 114589755743](https://github.com/scientistss/Infinity/actions/runs/38179802557/job/114589755743),
  ended `cancelled` at **2026-10-11 23:02:35 UTC**, with the native stage cancelled
  at its 45-minute bound. It is not green, and this record does not attribute
  cancellation to a person.
- [Pressure run 38166547815](https://github.com/scientistss/Infinity/actions/runs/38166547815)
  failed with one control window and no completed pairs; its partial samples
  are excluded from the successful pressure comparison.

The final 576 run supplies its own complete evidence. No partial count, recorder
benchmark, isolated pressure pass or later release retrospectively passes any
of these earlier runs.

# Manual ship and defense confirmation acceptance

Candidate: `0.6.26-alpha.1`, save version 9 / revision 14 unchanged.

## Evidence classification

The new native job is an additional, independent sixth required gate. It does not replace the existing five gates or their natural/UI controls.

The job freshly checks out immutable source `241a51de31364e9086abcc304884bf9df7cd6912`, builds that source and runs its unchanged `scripts/natural-growth-journey.ts`. It does not upload or reuse a pre-generated natural report. The complete resulting report must reproduce SHA-256 `9102da6f8fc52427b642883389d186726a8cf0c02747aa6c135150566458d8ea`. Its full source binding is created by the unchanged old diagnostic script at `1f66672f40556c61c4acfaeec23f1cb18c64636a`; that diagnostic test SHA is intentionally different from the new candidate SHA.

Natural branch A imports the original milestone 05 without editing any game state. It pays for one small cargo ship, advances ordinary one-second live ticks until that ship has completed and production has earned at least 10,000 crystal, pays for a two-ship batch, advances until exactly one has completed, and fills to five by paying for exactly two more. That fill counts two completed ships and one paid remaining ship, not the batch’s original ordered count of two. The final max purchase uses remaining real funds. The fixture preserves every intermediate tick's complete before/after state as well as each real paid job, identity and wallet transition. The browser independently performs every one-second functional frame and records every requested/observed clock transition. Complete real Save comparisons occur at the declared payment, partial-completion and funding checkpoints. The independent fixture retains every intermediate full state. There are no extra per-second Save clicks, reloads, or reader adoption; no claim is made that intermediate browser memory was directly read. This bounded new-suite observation schedule preserves the entire economic route and all transaction checks, avoids unnecessary UI overhead, and does not accelerate game rules or relax any existing gate.

Natural branch B imports original milestone 09, dispatches its two legitimately produced cargo ships on a real paid transport flight, and proves those in-transit ships do not satisfy a local fill target.

Unlocked prerequisites, large wallets, zero funds, shield ownership, missile stock and local safety-cap setups are all explicitly synthetic isolated contexts. Synthetic setup is never described as natural progression. The ten-slot full queue uses ordinary paid APIs on its explicitly funded input.

The browser uses actual native anonymous contexts, headed system Chrome under Xvfb, Storage, File, confirmation dialogs and trusted input. The hidden/resume case turns off Playwright focus emulation for the game and cover tabs, verifies they share one real Chrome window, and observes native visibility getters plus trusted visibilitychange events with bounded actual-state waits. No document property or event is fabricated. Actual HTTP200 document/assets, every release resource, and V8 executed script source are bound to the candidate release and committed full source tree. Date/performance/RAF timestamps are controlled only for functional replay. Python monotonic time and the retained native RAF observer establish geometry/scroll readiness; this suite makes no wall-clock gameplay or performance claim.

## Commands

Run from the clean committed candidate tree, after the fresh historical report and old source binding are generated:

```sh
node --import tsx scripts/manual-unit-native-fixture.ts \
  "$FRESH_241A_REPORT" "$OLD_SOURCE_BINDING" "$GITHUB_SHA" \
  > manual-unit-source-evidence/native-fixture.json

xvfb-run -a python scripts/browser-manual-unit-orders.py \
  --fixture manual-unit-source-evidence/native-fixture.json \
  --expected-fixture-sha256 "$FIXTURE_SHA256" \
  --natural-report "$FRESH_241A_REPORT" \
  --source-binding "$OLD_SOURCE_BINDING" \
  --expected-sha "$GITHUB_SHA" \
  --expected-version 0.6.26-alpha.1 \
  --runtime-node "$(node --version)" \
  --chromium "$CHROME" \
  --url http://127.0.0.1:4173/Infinity/ \
  --output manual-unit-evidence
```

`manual-unit-evidence` must not already exist. Browser execution refuses any process outside GitHub Actions CI. The worker has a 660-second functional bound; the workflow retains its independent 15-minute job bound.

Offline contracts need neither Node nor browser:

```sh
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s scripts -p 'test_manual_unit_acceptance.py' -v
```

## Native coverage

- All 24 units: literal independent three-resource price goldens, real count payment, nine invalid raw strings each; every rejection is followed by actual Save to witness the full current in-memory game
- Separate mode selection never pays; count/fill/max show payer, exact added quantity and all three complete resource amounts
- One representative legal raw input ` 0002 ` retains whitespace/leading zeroes and pays exactly two small cargo ships at 4000/4000/0
- Default one, genuine native double click, successful quote consumption, later paint and actual hidden/resume
- Filled totals count completed local stock plus paid remaining queue, excluding original ordered quantity, other worlds and in-transit ships
- Full queue, insufficient funds, shield-owned/shield-queued uniqueness, one- and two-slot missiles, the 10^15 local unit limit, satellite flight exclusion, and a newly paid finite plan changing prepared max and fill quotes, with rejection followed by explicit reselection and correct new payment
- Planet A→B→A, same-identity import, reset, tab departure, cloned controls, detached controls, same-turn remove/reinsert, ancestor remove/reinsert, hidden/reshown quote and total text, ancestor/class/visibility hide–show, and cross-labeled payment controls
- Failed and cancelled real File imports while a quote remains visible retire its payment; unchanged complete state is checked before a separately reauthorized payment
- Separate real cross-tab protection check preserves the exact competing raw save and every other local-storage byte; it does not mistake an old persisted value for a current-memory witness
- Widths 320/390/768/1440: genuine scroll settling, all five hit points, per-glyph clipping checks, and screenshots with `caret='initial'` plus exact before/after DOM identity witnesses
- Complete before/expected/after originals are published with exclusive paths scoped to exact case identity. Native failures preserve storage, DOM and screenshot while the context is still alive. Final sealing recursively verifies every nested file reference and hash.

## Read-only legacy entry census

The following locations were found before any legacy runner edits. Line numbers refer to the starting candidate tree; later integration edits can move them.

| File and original line | Existing legal interaction | Narrow integration required |
|---|---|---|
| `scripts/browser-orders.py:340–343` | Edits light-fighter quantity and clicks old count direct-payment action | Keep quantity and transaction assertions; select count then use the distinct payment control |
| `scripts/browser-orders.py:390` | Asserts original building/research/manual-unit controls exist | Preserve all three categories and assert the new mode and payment controls instead of removed direct-payment action |
| `scripts/browser-npc-economy.py:922` | Asserts espionage probe build control is disabled for unmet prerequisites | Assert disabled separate payment control; mode selection is allowed to explain a rejected quote |
| `scripts/browser-npc-economy.py:928` | Clicks original probe direct-payment button | Select count then pay; preserve the old economic assertions |
| `scripts/browser-npc-attack.py:1508–1509` | Natural route edits quantity and pays via old build button | Select count then distinct payment; keep natural operation tape and complete-state comparisons |
| `scripts/browser-scout-rehearsal.py:1057` | Natural/light-fighter setup quantity and direct build | Select count then distinct payment; preserve the original downstream state and protection checks |
| `scripts/browser-manual-unit-proof.py:110–164` | Immutable 241a counterexample observes and invokes `build-units` | No change. This must keep reproducing the old released defect against immutable 241a |
| `scripts/check-original-parity.mjs` | Domain `orderUnits` behavior comparisons | No UI migration and no removed assertions |
| `scripts/check-shipyard-census-parity.mjs` | Domain queue/fleet/capacity invariants | No UI migration and no removed assertions |
| `scripts/check-ui-baseline.mjs:45` | Pinned original shipyard icon | No icon or artwork change |

No blanket assertion deletion, selector filtering, natural-route exemption or parity weakening is needed. This acceptance owner does not edit any of those existing files; integration owners make only the listed narrow legal interaction changes.

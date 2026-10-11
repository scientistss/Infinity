# NPC remainder settlement: candidate r13 design

2026-10-11. This document specifies the integrated r13 candidate contract for exact NPC fuel and loot settlement using a bounded nonnegative subunit entitlement. The remainder is an explicit new rule of this project. It changes NPC transfer representation, not battle rewards, old payment rules, or save-protection policy. The independent settlement matrix and natural-route engine checks pass; native-browser acceptance, final CI and immutable release-artifact gates remain pending.

## Status and measured motivation

The playable, supported release is `0.6.19-alpha.1`/r12 at `eefc0706e8bc2ce39fbfd732ab9d3b67ac190d81`. Public commit `c66bc826f3e74a6261cba78a8038fe7ee0515c68` is an explicitly unverified, unpublishable r13 work-in-progress candidate, not a published or supported r13 save contract. The first supported r13 format will require the remainder field. Earlier unreleased r13 candidates must not silently receive zero remainders or be treated as supported historical migrations.

A deterministic pre-remainder diagnostic crossed all 55 distinct saved home-resource texts from a real 23-milestone route with fixed movement sets. It did not select only successful states or randomize balances:

- 22 distinct legal route fuel amounts × 55 wallets: 168 of 1,210 sufficient-funds fuel debits rejected for precision (13.9%).
- 17 fixed small positive integer amounts × 55 wallets: 137 of 935 loot credits rejected for precision (14.7%).
- At an ordinary main balance of 1,000,000, legal fuel amounts 12, 16, 26, 30, 50, and 64 exposed precision failures.

These measurements remain diagnostics of the preceding strict single-Decimal approach. The integrated remainder candidate now passes all 1,210 sufficient-funds fuel cases and all 935 credit cases from that matrix. An independently checked expanded matrix records **6,006 cases: 5,782 exact successes, 224 correct insufficient-funds rejections, and zero unexpected results**. Exact result construction and source-text handling alone do not make every ordinary target representable; the new contract retains every unresolved subunit as an exact, visible right while putting the usable bulk into the existing wallet.

A fresh natural engine continuation from the same genuine public r12 origin passed **905/905 assertions over 31 adopted game seconds**, without injected wallets, technology, ships or clocks. Attack #7 drew with permanent losses of one player and two NPC light fighters; attack #8 won and delivered `265 / 132 / 23` at the actual first dock boundary, `18.79955725610165` seconds. After production and a further scout, attack #10 delivered `44 / 22 / 4` at approximately `30.799557` seconds. Its crystal settlement produced W=`452477.4625733589`, r=`0.00000000006`, with the exact rights equation proved; no active fleets remained at the end.

The old failed route is retained as failed evidence. Its `19`-second blocked frame was a later observation, not the actual first dock event. Waiting for production to make a retry pass was not a fix, and the new candidate does not retrospectively turn that historical run green. See [orbital status](NPC_ORBITAL_STATUS.md) for the corrected boundary and release gates. The actual-click native runner is wired but has not been run or passed; these engine checks do not establish native acceptance.

See also [orbital persistence](NPC_ORBITAL_ATTACK.md), [save migration](NPC_SAVE_MIGRATION.md), and [orbital status](NPC_ORBITAL_STATUS.md).

## 1. Authority and per-planet schema

Every current-r13 `PlanetState` and serialized planet requires `npcResourceRemainder`, initialized for new planets as:

`{ metal: "0", crystal: "0", deuterium: "0" }`.

Each value is an independently persisted exact decimal string r with **0 <= r < 1**. It is a pending entitlement belonging to that planet, outside its ordinary spendable/resource-production wallet. It is not a battle-report field, grant, refund, negative debt, or lifetime-production increment.

Let V(W) be the exact decimal rational denoted by the original runtime Decimal's canonical `toString()` text captured once. For every adopted new NPC transaction, prove exactly:

V(W_after) + r_after = V(W_before) + r_before + signed_integer_transfer.

Loot has a positive integer transfer; fuel a negative integer transfer. No tolerance, truncation of entitlement, negative remainder, repair of quoted price, or double rounding is permitted.

## 2. Closed numerical/storage bounds

- Main wallet/source/quote canonical text: retain existing NPC maximum 256 characters.
- The remainder parser is independent of the old main-wallet 256-character input cap; it must accept the full valid 258-character remainder representation.
- Remainder text: exactly `"0"` or `"0."` followed by 1–256 decimal digits with a nonzero last digit; at most 258 ASCII characters. Plain own string value only.
- Canonical zero is exactly `"0"`. Reject negative zero, signs, whitespace, NaN, Infinity, missing values, numbers in place of strings, leading/trailing zero aliases, and alternate noncanonical encodings.
- Nonzero remainder canonical form is plain fractional text only. Examples: `"0.25"`, `"0.00000000007"`. Fractional leading zeros are necessary and allowed; trailing zeros, exponent notation, `".25"`, and `"00.25"` are rejected. Normalized coefficient has at most 256 digits.
- Supported remainder scale is exactly 1–256 fractional places, so its trailing-zero-free coefficient power is in **[−256,−1]** and its exact amount is <1. This is a bounded exact supported domain, not a rounding policy. Smaller unsupported tails reject; they are never clamped to zero.
- Common-scale arithmetic work: at most 512 aligned coefficient digits per input, checked with BigInt exponents before exponentiation or Number conversion. One carry digit is allowed in a temporary result; all persisted outputs must satisfy the final bounds. Normalize zeros/trailing zeros before checking aligned work.
- Source/quote exponents retain the existing bounded-text parser and BigInt comparisons; a huge value is not rejected merely for magnitude if an existing exact path proves it. New expanded carry arithmetic must reject unsupported spans before allocation.
- Per-planet resources: exactly M/C/D, no extra keys/accessors/inherited entries. Existing maximum 100 planets remains unchanged; at most 300 remainder strings. Gross new ASCII value budget is 77,400 characters (300×258), plus fixed field/JSON indentation overhead. Add a maximum-population serialization test and retain the existing whole-save/storage protections; no unbounded per-raid ledger/list is added.

The specific field name and numerical bounds above define the candidate contract. They must be kept consistent among validator, constructor, serializer, migration, tests, and UI; implementation must not quietly broaden them.

## 3. Source, quote, and output validity

Source W must be valid, finite, nonnegative, and its captured canonical text must survive text→reader→text unchanged. A representation-only difference in original mantissa/exponent is allowed if monetary text is unchanged. The original text, not a silently repaired value, is the equation's left side.

The observed actual dock deuterium satisfies this exception: runtime `[6.88257241553523,4,"68825.7241553523"]`; reader `[6.882572415535231,4,"68825.7241553523"]`. Independent Node review verified unchanged text. An actually observed text-value drift must reject the new NPC transaction atomically; it is not absorbed into a new currency.

Quote/cargo checks remain stronger and unchanged: original fuel quote must exactly equal the independently retained intended integer, and saved cargo must exactly equal integer loot. The remainder cannot make a malformed or rounded quote valid. E.g. intended 1073741824000 represented as 1073741824000.0001 still rejects.

Output W_after must be valid, nonnegative, and stable in **all** mantissa/exponent/canonical-text fields through the existing reader. Output r_after must be canonical exact text within section 2. Source flexibility does not weaken output persistence or original quote checks.

## 4. Conservative projection and exact carry

Compute exact T = V(W_before) + r_before + signed integer, inside the bounded arithmetic domain.

1. First try exact result construction from T, using plain decimal text in canonical orders −6..20 and bounded scientific text elsewhere. If its stable representation is exactly T, use r_after=0.
2. If the exact-target constructor does not yield a directly acceptable pair, use its normalized finite nonnegative candidate as the starting point. Probe the initial candidate and at most **64 downward adjacent-mantissa steps** at its current exponent, renormalizing as needed. At every probe, evaluate both the raw candidate and the reader-hydrated candidate `big(rawCandidate.toString())`; each must independently pass output stability and exact target/remainder proof. This is at most 65 raw plus 65 hydrated candidate checks. The hydrated candidate is only a proposed representation; it never changes the original exact target or source authority. Descend when a candidate is below target but representation-unstable as well as when it is above target. Each step uses the next lower representable binary64 mantissa, not a multiplicative epsilon. This is a fixed work limit, not correctness evidence. No unbounded search or normalization loop is allowed.
   Required integer-snap golden: W=1, r=0.00000000001, loot=1 gives T=2.00000000001. The library can stringify many adjacent raw mantissas as `"2"` while their bits are not the stable representation of 2. The reader-hydrated X=2 with r_after=0.00000000001 is valid. Raw-nextDown-only search is insufficient even with dozens of probes.
   Also include a bounded decimal-truncation fallback: from the exact positive target coefficient, retain its leading n significant digits for n=17 down through 1, replacing the omitted digits with exact powers of ten (BigInt/text construction, never floating rounding). Construct each truncated value with the same plain/scientific rule and evaluate both its raw and reader-hydrated forms. This adds at most 34 candidate checks, for a combined ceiling of **164 checks**. No candidate is accepted without the same full proof. Duplicate candidates may be skipped.
   Required below-integer plateau golden: W=0.99999999998, r=0, loot=1 gives T=1.99999999998. The raw target and many nextDown probes can stringify `"2"` above T; hydration does not fix this. Independent real-JS review found the best stable candidate in the specified truncation set is X=1.9999999999, with exact r_after=0.00000000008; the coarser X=1.99999999 and r_after=0.00000000998 also prove the fallback principle. Use the observed tighter pair as the golden for the greatest-verified-candidate policy. The fallback is necessary for ordinary-scale integer-snap plateaus, not merely extreme values.
3. Independently prove each candidate X is stable, 0 <= V(X) <= T, and the exact difference r_after=T−V(X) is valid and **<1**. Prefer the greatest verified candidate from the bounded set, minimizing the retained tail.
4. Independently re-prove the original signed five-term equation V(W_before)+r_before+signed_integer−V(X)−r_after=0 using bounded exponent elimination or an independent common-scale equality. Do not merely assume conservation because the same helper calculated r_after.
5. Adopt only a fully proved pair. If no supported candidate qualifies, retain original state and use the existing precision fallback. Do not move the whole wallet/loot into pending claims. Do not treat floating nextDown or a relative error test as the proof.

For positive integer loot L, because both old/new r are in [0,1), the ordinary-wallet increase is exactly L+r_before−r_after, hence strictly greater than L−1. A normal 265 grant cannot become 265 pending; more than 264 enters the ordinary wallet immediately, usually all but a tiny representational tail.

At extreme balances where no stable X can leave less than one unit, blocked fallback is intentional. Never discard a residual, clamp r to 0.999…, grant a replacement reward, or release ships while losing the cargo/right.

## 5. Fuel authorization and zero operations

Fuel intent, flight duration, empty outgoing cargo, roundtrip/cargo capacity reservation, quote amount, and paid-once semantics remain unchanged.

Conservative affordability: **V(main deuterium wallet) >= independently intended fuel integer** remains required. Explicit regression: W=0.75, r=0.25, fuel=1 rejects as insufficient despite composite ownership of 1. A hidden remainder must not turn an ordinary displayed “insufficient funds” into an authorized launch. Once the same original quote is affordable, exact composite settlement may carry/merge r. Price paid is still the full intended integer; capacity uses the full fuel quote, not a reduced main-wallet delta.

For attack deuterium, the exact canonical affordability result must replace the old shared Decimal `.lt` amount gate, rather than be preceded by a potentially disagreeing hidden mantissa comparison. Keep the old gate for unrelated missions/resources; keep all independent cargo/stock/capacity rules.

Preflight/preview computes candidates only. Failure changes no wallet, remainder, ships, IDs, target reservation, cargo draft, report, or owner. Final adoption uses the same complete candidate; no second fee or silently changed quote.

Validate the remainder container and canonical value before the zero-amount shortcut; malformed r must still reject. Per-resource zero amount is a strict identity operation on both W and r, preserving current unusual zero behavior. Do not use a zero-loot draw/recall or a quote preview as an unrequested remainder sweep. Other resource components with positive integer loot settle normally. Fuel touches deuterium only.

## 6. Dock atomicity and receipts

Resolve exactly one owning origin planet by ID before adoption; missing or duplicate origins reject. A `some/find` followed by `map` over multiple same-ID planets must never duplicate a deposit. Validate all three cargo amounts and independently preflight all ship landing counts. Adopt all three W/r pairs, all survivors, removal of the unique fleet, and report delivery transition in one transaction. Attack-only launch validation permits landed counts up to `1e15` per ship type per planet, retains the `1e12` per-type flight limit, and requires safe-integer empire-wide totals per ship type. Landing must still fit the landed limit. This distinction allows a legal small attack to leave a full port; unrelated mission checks are unchanged. If any resource/candidate or ship check fails, preserve the complete original fleet, cargo, wallet, remainder, report, and owner; existing blocked/retry semantics remain.

NPC target stock was already debited at battle arrival. Dock must not debit it again. A delivered report is historical and never separately redeemable. Terminal report trimming cannot delete rights because r belongs to the planet. Retrying or reloading cannot duplicate the removed fleet's deposit.

## 7. Later old actions and precise scope of conservation

All existing production, manual/plan/protocol purchases, merchant/transport/stake actions, normal refunds, cap/fusion logic, and ordinary UI affordability continue to read/change only W. Every such update must structurally preserve the exact r strings unchanged. Do not automatically spend, clear, normalize, cap, or move r through old paths.

Their composite change is consequently exactly their actual canonical main-wallet change. This preserves the independent tail right without introducing negative spendable debt. It **does not** promise that old nominal-price arithmetic becomes exact or that all composite E is usable by every old action.

The remainder is an off-warehouse pending entitlement. Ignoring it in old mine caps/fusion is deliberate scope, not a claim of equality to a fully integrated warehouse. Do not count it toward storage-full achievements, production rates, lifetime output, old affordability, or ordinary resource ratios.

Counterexample that must remain honestly represented: W=0.75, r=0.25, ordinary price=1 still fails the untouched ordinary purchase. Do not display combined E as an ordinary spendable balance. Likewise M/C tails may remain pending if no later positive NPC transactions happen; no finite-time flush is promised.

## 8. Future carry is earned value, not hidden new funding

Every later positive NPC transfer for that resource reuses the existing r exactly in T. Example: W=100.9999999997, r=3e−10, later loot=1 yields T=102. A stable W_after=102, r_after=0 merges the old remainder; main-wallet increase 1.0000000003 is exactly new loot 1 plus already-owned old remainder. No new value is created.

The analogous affordable fuel debit of 1 from that pair gives T=100 and r_after=0; main-wallet debit 0.9999999997 plus consumed remainder 3e−10 equals 1. This does not bypass the main-wallet fuel affordability rule.

If exact representability is still unavailable, a new smaller bounded tail can remain. Carry proves preservation and possible release; it is not a guarantee every tail vanishes after a fixed number of raids.

## 9. Save/read/migration and protection

The supported production baseline is r12 (`0.6.19-alpha.1`); no supported or released r13 save contract exists. Public r13 work-in-progress code does not establish save compatibility. If that release status changes before this design ships, specify an explicit revision migration rather than rejecting a newly supported format. Never initialize missing current-r13 rights to zero.

Current r13 planet data must contain exactly valid `npcResourceRemainder`; missing/malformed current data rejects before adoption and before JSON can hide invalid runtime fields. Recognized r2–r12 migrations initialize every resulting planet to zero *after* the existing legacy planet reader. A raw namespace guard must reject `npcResourceRemainder` in wrong locations and reject all occurrences in legacy input before any normalization, just like other r13-exclusive markers. Legal current location is the direct field of a real `state.planets[index]` only (or the equivalent non-envelope state path). Legacy input cannot smuggle current remainder fields. No positive claim is inferred from old reports, historical production, or totalTime.

Serialize r as exact validated strings, never via Decimal/Number. Current reader validates the same strings and preserves them exactly. NPC settlement output W/r must preserve the exact composite value and stable W representation on immediate save/read, and repeated refresh must not re-credit or flush r. Existing SaveSession read-only preparation, original-backup preservation, conflict checks, failed-write/readback handling, import replacement, and protected-state behavior stay intact.

No new blanket rejection, normalization, or rebate is added to all old W resource readers. SaveSession currently export-validates by `importSave(raw)`; it does not establish global nominal-economy exactness. Subsequent old arithmetic continues under its pre-existing semantics; r remains independent and exact. If an actual later old-W text normalization changes that legacy W value, this contract does not silently compensate it or claim to have fixed that old behavior. A stronger cross-every-old-action/global-refresh guarantee would require a separately approved broader wallet change.

New-game factories and every newly colonized planet initialize zero. Current clones/spreads/planet selection preserve exact r. Previewing research, flight, save/import preparation, or reset candidates must not mutate original state or grant/clear tails.

## 10. Curvature, planet ownership/removal, and refunds

Curvature and new game clear per-planet r with the rest of the player run's resources; NPC world/garrisons persist only under their existing separate rule. Prestige preview may construct a zeroed candidate, but original state is unchanged until reset adoption. Import replaces the entire supplied state; it does not merge old tails into the imported run.

Claims stay with their original planet. Colony creation starts zero; changing active selection never transfers rights. Existing abandonment guards remain. An explicitly confirmed colony abandonment forfeits its r together with that colony's existing resources, buildings, and stationed ships; update the abandonment warning when a nonzero tail exists. Do not transfer a disappearing colony's tail to homeworld, retain an orphan map entry, or silently forfeit it through any unrelated action.

Old refundable jobs did not spend r, so their existing refunds leave r unchanged and require no new funding attribution. NPC fuel is nonrefundable: recall/failed target/defeat does not refund the ordinary-wallet portion or any consumed old remainder. NPC deposits are not cancellable. If future ordinary purchases are allowed to spend r, their manual/plan refunds and partial completion/queue repricing must be upgraded together; that is outside this scope.

## 11. UI and verification gate

The candidate includes the compact local-rights detail and explicit curvature-reset/colony-abandonment loss wording described here. Native-click verification of these surfaces and branches remains pending. The complete local unit run passed `3,424 / 3,424`, including real paid capacity release and once-only retry, and the production build passed. The enhanced natural/branch engine rerun passed `939 / 939`; its main 31-second final-state hash stayed unchanged. Final CI and the immutable candidate artifact must be verified before release.

The native runner includes three added branches with passing engine checks but no native execution yet: curvature reset from the natural 31-second state and its real remainder; colony abandonment with an explicitly synthetic `0.25` metal remainder; and an explicitly synthetic `1e15`-fighter full port followed by actual dispatch of six fighters and a blocked-dock retry. The last two are boundary fixtures, not natural-route evidence.

Expose nonzero r as one compact per-planet “不足 1 的待结算权益” detail for M/C/D, with exact/scientific amount available and wording that later NPC settlement carries it. Zero tails need no persistent UI clutter. Do not show one claim per raid, silently hide all tails, offer an endless manual Claim retry, or claim r is universally spendable. Ordinary wallet display/affordability continues using W.

Battle reports retain full integer loot earned. Successful dock says ships and loot rights arrived; where a tail remains, disclose the pending subunit portion instead of claiming every unit entered ordinary spendable stock. No new reward, rounding bonus, or compensating giveaway.

Required regression and acceptance coverage (the engine evidence above is not a claim that all native gates have passed): actual 18.79955725610165-second natural dock; all three rights equations; natural matrix failures recovered within domain; 1e6 fuel 12/16/26/30/50/64; both rounding directions; source same-text/different-bits; true source text drift rejection; unchanged exact successful cases; independent quote rejection; huge unsupported span; near-one/zero/tiny tail boundaries; noncanonical/negative-zero/overlength/exponent rejection; per-component zero identity; atomic ship overflow; repeated retry and save/read; full 258-character remainder acceptance; 100-planet size bound; integer-snap/hydrated-candidate and below-integer/truncation goldens; current-schema tampering and legacy field smuggling; migration zeros; old-action r preservation; reset preview/adoption; colony initialization/abandonment; report trimming; owner/destination correctness.

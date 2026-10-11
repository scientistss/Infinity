# NPC orbital r13 candidate status

2026-10-11. The remainder-settlement repair is integrated and has passed the
independent settlement matrix and natural-route engine checks below. This is
still an unreleased candidate, not a native-browser acceptance or release claim.
The published fixed-production/scouting baseline remains
[`eefc0706`](https://github.com/scientistss/Infinity/commit/eefc0706e8bc2ce39fbfd732ab9d3b67ac190d81),
version `0.6.19-alpha.1`, save revision 12.
[`c66bc826`](https://github.com/scientistss/Infinity/commit/c66bc826f3e74a6261cba78a8038fe7ee0515c68)
preserved the earlier ordinary-return blocker as an unverified work-in-progress
checkpoint; it did not publish or establish a supported r13 save format.

## Integrated scope

The candidate connects wallet/garrison state, six-round combat, integer loot,
paid dispatch, arrival, return, recall, persistence and a compact UI. NPC fuel and
loot now settle an exact main-wallet-plus-subunit-right equation. Each planet
owns three canonical remainder strings, each nonnegative and less than one;
ordinary purchases and production continue to use the main wallet alone.
Source canonical text is authoritative: different source mantissa bits are
allowed only if reading preserves that text. Outputs must still pass strict
wallet representation stability and exact remainder validation. See
[the settlement contract](NPC_REMAINDER_SETTLEMENT.md) and
[orbital persistence](NPC_ORBITAL_ATTACK.md).

Current r13 saves require valid `npcResourceRemainder` fields. Supported r2–r12
migrations initialize them to zero; missing fields in earlier unreleased r13
candidates reject under save protection rather than silently losing rights.
Raw attack-ship symbols, hidden fields and custom prototypes are checked before
normalization; ordinary mission normalization remains unchanged.

Attack-only launch checks distinguish landed inventory (at most `1e15` per
ship type per planet) from flight inventory (at most `1e12` per ship type), while
requiring safe-integer empire totals. Old mission checks remain unchanged.
The UI exposes nonzero local rights and explicitly warns about their loss on
curvature reset or colony abandonment. Native-click verification is pending.

## Verified candidate evidence

- The independent 6,006-case settlement matrix reports 5,782 exact successes,
  224 correct insufficient-funds rejections and zero unexpected results.
  All 1,210 sufficient-funds route fuel cases and all 935 route credit cases
  now pass, compared with 168 and 137 precision rejections respectively under
  the preceding strict single-Decimal approach.
- A fresh continuation of the same genuine public r12 natural origin adopted
  31 game seconds and passed all 905 engine assertions. No wallet, technology,
  ship or clock values were injected into the route.
- Attack #7 drew after six rounds, permanently losing one player light fighter
  and two NPC light fighters. Attack #8 then won and delivered integer loot
  `265 / 132 / 23` (metal/crystal/deuterium) at the actual first dock boundary,
  `18.79955725610165` seconds into the continuation.
- After production and another scout, attack #10 collected `44 / 22 / 4` from
  the empty garrison and docked at approximately `30.799557` seconds. Its crystal
  settlement retained ordinary wallet `452477.4625733589` plus exact remainder
  `0.00000000006`. All three resource equations were proved, and the continuation
  ended with no active fleets.

These are candidate engine results, not results for the historical failed
checkpoint or a substitute for native browser interaction.

## Historical failure retained; dock timing corrected

The earlier route remains failed. Its actual first attack-#8 dock event occurred
at `18.79955725610165` seconds, with metal `2910911.83616177`, crystal
`447710.15680556995` and deuterium `68825.7241553523` before credit. The preceding
transfer implementation rejected that event for precision and retained all
ships and cargo.

The previously described `19`-second state was a later observed blocked frame,
not the first dock boundary. At that later frame, metal `2911027.71225653` plus
loot `265` produced `2911292.7122565303` rather than the exact
`2911292.71225653`. Six ordinary one-second production retries stayed blocked
before a later balance happened to accept the transfer. Neither that accidental
retry nor the repaired candidate retrospectively makes the old route pass.
There is no epsilon allowance, discarded loot or compensating grant.

## Remaining release gates

- The full unit suite passed `3,424 / 3,424`, including the real paid release
  and once-only retry regression; the production build also passed locally.
- An enhanced engine rerun passed `939 / 939` assertions across the unchanged
  main route and all six branches. Its main 31-second final state hash remained
  `51b5fe6f28226e48ec087261d8876eddbc9f830967e2e442ea0bcd8d1d7c3241`.
  The three added reset/capacity cases below have engine evidence, not browser evidence.
- The actual-click native browser runner is wired but has not been run or
  passed. Native route and persistence/protection acceptance remain pending.
  Three added native branches are also unverified: curvature reset from the
  natural 31-second state with its real remainder; colony abandonment with an
  explicitly synthetic metal remainder of `0.25`; and an explicitly synthetic
  `1e15`-fighter full port, followed by actual dispatch of six fighters and a
  blocked-dock retry. The synthetic branch setups are boundary fixtures, not
  milestones of the natural route.
- Final CI, exact candidate-commit/source binding and a verified immutable
  release artifact remain pending. No r13 deployment is approved by this status.

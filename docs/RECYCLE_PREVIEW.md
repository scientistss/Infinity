# Recycling estimate: preparation checkpoint

This checkpoint extracts the existing recycling arithmetic into a shared pure calculation. It does not add a player-facing preview, change the save schema, or constitute a release. The complete current release gates still apply before any later playable candidate is published.

## Preserved settlement contract

The reference is public commit `6b985b88ec6b263a3eeb8f34252525383a9f110f`, `src/game/deep-space.ts`, Git blob `b5bca084100ad780aa99bf87ee1590074dd99bc1`.

- The fixed ship and resource iteration order, each Decimal operation, and current hyperspace factor remain unchanged.
- Available room is the lesser of unoccupied total cargo capacity and recycler capacity. Existing metal, crystal and deuterium all occupy space.
- Metal is the proportional amount rounded down. Crystal uses the remaining pickup amount, capped by available crystal and rounded down; it is not independently proportioned.
- The original missing-field return, remaining-field order, complete state/fleet construction, object ownership and summary text remain unchanged.
- Departure already pays the round-trip fuel under existing flight rules. Pickup does not deduct or reserve that fuel a second time.
- Returned `used` is a copied Decimal, so the pure calculation does not expose an input cargo object through Decimal's zero-add shortcut.

## Two distinct verification purposes

Independent literal examples establish the intended amounts: a 40,000 metal / 20,000 crystal field, hyperspace technology 2 and one recycler yields 14,666 metal / 7,334 crystal, leaving 25,334 / 12,666. Adding one large cargo ship and carrying 30,000 units leaves room for 13,000 / 6,500. Two fractional half-units produce no whole-unit pickup.

A separately retained historical function proves extraction equivalence, not correctness of the original economics. Its complete results and JSON order are compared with frozen input state/fleet, including unrelated resources, fleets, offers, messages, RNG and field order. The matrix has 560 deterministic combinations plus 70 per-ship cases and explicit boundary examples. The real dispatch-to-pickup-to-return API route separately verifies that fuel is charged once.

Local checks for this checkpoint: all 4,490 unit tests in 116 files, the separate 28-test extraction suite, 140 existing deep-space/dashboard/transport tests, and TypeScript passed. These ran locally on Node 24.19.0; they are not native-browser or full release acceptance.

## Intended later read-only presentation

A subsequent candidate may show a short current-condition estimate and default-collapsed details using the same function. It must only use already visible debris, remain advisory because fields and technology can change before arrival, preserve current dispatch controls, and introduce no payment or dispatch authority. That presentation is not implemented in this checkpoint.

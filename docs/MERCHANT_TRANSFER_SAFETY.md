# Merchant transfer safety

This candidate changes only merchant transaction preflight. The released quote
formulas, fee, quantity parsing, exchange ratios, storage checks and repeat-trade
behavior remain unchanged. Save version 9 / revision 14 is unchanged.

## Reproduced released behavior

The independently prepared synthetic control and counterexample execute the
unchanged released code `6b985b88ec6b263a3eeb8f34252525383a9f110f` through its real
merchant UI. The proof is stored at
`da9a94dee20125224ff25533d367ee3b93096aa6`,
[run 38328373815](https://github.com/scientistss/Infinity/actions/runs/38328373815).
It is a successful defect reproduction, not a safety verdict on the old code.

At the explicit synthetic 3:2:1 ratio, selling 1,000 metal receives 646 crystal
after the existing 3% fee and consumes 1,000 merchant quota. The ordinary control
starts at 100,000 metal and ends at 99,000. The large-wallet counterexample starts
and ends at `1e+100` metal while still receiving 646 crystal and spending quota.
Both inputs and all ten actual before/after/save/reload records are accepted by
the unchanged released reader. These are anonymous generated game states, not
player saves or a natural-new-game demonstration.

## Merchant-only numerical contract

The existing quote determines three positive canonical amounts: seller debit,
buyer credit, and the possibly fractional metal-equivalent quota debit. The
existing Decimal operations construct the candidate results. Each leg must:

1. Have finite, nonnegative source and result values with stable canonical text
   through construction from that text and serialization/readback.
2. Move a strictly positive amount in the required direction. A swallowed debit
   or credit is rejected regardless of wallet magnitude.
3. Satisfy `abs(actual - quoted) * 1e9 <= quoted`, computed exactly with bounded
   decimal-integer arithmetic on canonical text. The bound is relative to this
   transaction leg, never to the wallet balance.

This is an explicitly bounded rounding-error contract, not exact conservation.
It permits ordinary representational rounding while rejecting zero movement and
materially wrong partial transfers. For example, a quoted 1,000 debit whose
persisted values prove that only 999.9 moved is rejected even if Decimal reverse
subtraction itself rounds back to 1,000.

All three candidates are captured before any commit. If any check fails, the
original state, resources, offer quota, IDs and random state remain unchanged.
The existing capacity error retains priority. A successful commit uses exactly
the captured candidates and the same offer identity. No NPC remainder account,
shared wallet change, new economic reward or persistent trust cache is added.

Canonical text is authoritative. A different internal Decimal mantissa after
readback is not itself a monetary difference when the canonical text is stable.
Unsupported or unstable canonical values are rejected rather than normalized to
make a transaction succeed.

## Bounded work

Inputs to the decimal proof are limited to 256 characters. At most three terms
are compared. Exponent differences larger than the supported alignment bound
are decided by magnitude dominance without exponent-sized allocation; at most
two shifts of 272 places are performed. Intermediate coefficients are bounded
conservatively to 811 digits. Boundary tests include 271/272/273-place gaps,
huge exponents, tiny amounts, both inclusive error limits and adjacent failures.

## Acceptance status

The defect reproduction is complete. The production fix still requires its own
exact-source build, complete mandatory regression jobs and native acceptance.
Synthetic goldens are derived from the stated business formulas. A separately
written initial-state progression must identify its own seed, actions and
earned resources; it must not be presented as a player's existing save.

The current UI continues to show an unavailable quote and prevents payment when
preflight rejects a transfer. Existing valid merchant offers can still be used
repeatedly. This change does not introduce one-use authorization or change any
other trading, fleet or queue rule.

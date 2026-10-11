# Ordinary demolition A acceptance

2026-10-11. Candidate version `0.6.18-alpha.1`, save v9/r11. This is a new manual-only implementation on the independently verified and released [ac3cce9](https://github.com/scientistss/Infinity/commit/ac3cce98403bea1e7162bcb4092e4cfeeb448a9a) r10 baseline. A candidate checkpoint does not establish complete CI or release acceptance.

## Executable contracts

- `docs/DEMOLITION.md` defines the project-specific P/T, cancellation, compatibility and locked-protocol rules. Terraformer, moon and unavailable facilities remain excluded.
- `tests/demolition-*` covers independent integer prices, representability refusal, all-resource atomic payment/refund, stable paid IDs, completion boundaries, positive-progress numerical tolerance, interlocks, strict current input and historical migration.
- The mathematical warehouse32→31 fee remains exactly `1073741824000`; the current Decimal carrier cannot represent that decimal integer exactly. The actual action rejects with a precision reason and leaves all resources, IDs and queues unchanged. This is not a near-value payment success.
- `scripts/check-demolition-migration.mjs` runs the actual fixed ac3 reader over 12 r10 originals and three preserved r9 inputs. The r11 result may add only an explicit null demolition slot per planet and the envelope revision, after existing historical normalization. Existing earned grants, payment floors, jobs and clocks remain exact.
- `scripts/demolition-r10-fixture.ts` reproduces those 15 historical raw files byte-for-byte through the fixed historical serializers. Its portable metadata does not overwrite the original producer or evidence-manifest hashes.
- Frozen r10 compatibility helpers and both previous ring-domain manifests remain unchanged. The new demolition provenance manifest binds the complete approved protected-source delta, including modes, full patches and individual hunks. Provenance checks do not waive native protection tests.

## Natural continuation

The original r10 save is a byte slice of `$.milestones[10].save` in the green ac3 CI report. The provenance file records the exact commit, artifact, report and save hashes. An actual one-second tick reaches its recorded terminal world at game time25811; no wallet, technology or job is injected.

The executable continuation then reviews and dismisses, pays128000 metal, produces for two seconds, cancels for exactly that paid fee, pays again, reloads partial work, completes warehouse9→8, and pays the ordinary256000 upgrade to rebuild9. There are45 simulated live seconds, IDs202/203/204 and net384000 metal paid. Total fields173 and the historical terraformer ledger do not change. Warehouse capacity falls2920000→1590000 and later returns; excess stock is retained and metal production resumes only at the actual completion boundary.

Exact fee/job/timer/state comparisons are separate from the independently integrated wallet/lifetime prediction, whose explicitly bounded absolute tolerance is1e−6 resource units. The first local natural replay passed; it is compressed engine execution, not elapsed human play or a native-browser result.

## Browser gate

`scripts/browser-demolition.py` must execute against the exact CI-built HTTP bundle. It covers real file confirmation, payment, cancellation, persistence, reload and the natural rebuilding loop; four-width layout/hit evidence is separate from the1440px economic loop. Additional clearly classified branches exercise protected-state old-node replay, hidden skipped-paint edits, detach/reinsert retirement, reset/curvature retirement, and locked-card stop/clear→reload→ordinary rebuilding→unlock behavior. Synthetic setup does not replace the unchanged natural origin.

Existing full ring, SaveSession, order, template, formation, navigation, background-time and paired-browser performance gates remain mandatory. There was no local native-browser run for this candidate. Publication requires this candidate's own complete CI and independently verified immutable dist/source artifact.

## Local preparation record

The integration run passed2319 unit tests and the build; original view/style/assets and ring artwork checks passed. Fifteen later fixture generators actually executed, producing127 accepted strict cold-read envelopes. Four existing formation/research-template inputs still receive the same achievement/card normalization as separately executed fixed ac3 source; their pre-existing unseeded ring outcomes differ between independent generation runs and are not presented as whole-fixture byte parity.

Earlier local red cases were retained: one-second RAF subtraction tails, downward-rounded quote display, and unsettled synthetic achievement/card setup. The fixes did not alter historical upgrade prices, grant fields, or previously published CI outcomes. Native CI remains the next independent gate.

# Building-template authority regression

This fixture preserves the exact pre-repair candidate panel reconstructed by the
author from the reversible hardening patch. It is **not** a released Git version
or a claim that a browser test ran before the repair was written. The manifest
records the original six candidate files and their before/after SHA-256 hashes.
The fixture panel, patch, and current panel/presenter/CSS hashes are checked before
bundling. All transitive runtime inputs and served artifact hashes are recorded.

Run after installing the repository's already-locked dependencies:

    node scripts/prepare-building-authority.mjs --source . --output building-authority-build
    python -m http.server 4177 --bind 127.0.0.1 --directory building-authority-build

While that independent HTTP server runs, execute in another terminal:

    python scripts/browser-building-authority.py --url http://127.0.0.1:4177/ --output building-authority-evidence

The default output is `building-authority-build`, outside the production `dist`.
Preparation rejects output inside production `dist`; the harness must never ship
with the app. Archive `building-authority-build` and `building-authority-evidence`
as test artifacts only. The production publisher should continue using only `dist`.
Use `--source OTHER_CHECKOUT` when testing the exact repaired source before it is
integrated into the harness checkout. Use `--url` for a different HTTP server.
The browser worker has a 150-second independent watchdog and process-group cleanup.

The suite deliberately expects stale actions to succeed in the vulnerable
baseline, and records those unsafe action counts separately from check results.
The repaired component must emit zero stale actions while genuine keyboard Enter
still creates a template. Both variants use the same real domain reducers and
real browser DOM, and only the exact panel source differs.

Real pause/resume/pause is the natural semantic A-B-A failure witness. Real
template edits restore content with increasing revisions and must be rejected in
both versions. Replaying an old template state, suppressing payer change events,
observing a synthetic writable mask, and replaying detached controls are explicitly
synthetic adversarial component inputs. Native payer changes are a separate
already-safe control. This is not whole-application, storage, or SaveSession
protection/recovery acceptance; those require the separate integrated suite.

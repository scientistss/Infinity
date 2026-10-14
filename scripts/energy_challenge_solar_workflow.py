"""One solar job and exact lab import-path repair; all old acceptance is bound."""
from pathlib import Path
import hashlib
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = '.github/workflows/p4-original-verify.yml'
BASE_SHA = 'bb7fc33f1b51c5e27324c9df7df2a27a357802ff'
BASE_WORKFLOW_SHA256 = 'a4ac743eb5fd1aeeef36661e1f2d3ac65267755d084848e12bb3592cd5c37742'
VERSION = '0.6.32-alpha.1'
SOLAR_JOB_NAME = 'energy-solar-route'

LAB_IMPORT_BEFORE = "          import importlib.util\n          from pathlib import Path\n          spec = importlib.util.spec_from_file_location('lab_historical_source', 'scripts/browser-lab-blockers.py')"
LAB_IMPORT_AFTER = "          import importlib.util, sys\n          from pathlib import Path\n          sys.path.insert(0, str(Path('scripts').resolve()))\n          spec = importlib.util.spec_from_file_location('lab_historical_source', 'scripts/browser-lab-blockers.py')"


def original_workflow():
    raw=subprocess.check_output(['git','--no-replace-objects','-C',str(ROOT),'show',BASE_SHA+':'+WORKFLOW_PATH])
    assert hashlib.sha256(raw).hexdigest()==BASE_WORKFLOW_SHA256
    return raw.decode()


def exact(body,before,after):
    assert before!=after and body.count(before)==1, before
    return body.replace(before,after,1)


SOLAR_JOB = r'''  energy-solar-route:
    # One uninterrupted fresh-start solar attempt; no finish-ready import acceptance.
    if: github.event_name != 'push' || !contains(github.event.head_commit.message, '[deep-source]')
    runs-on: ubuntu-latest
    timeout-minutes: 15
    outputs:
      common-identity-sha256: ${{ steps.common_identity.outputs.common-sha256 }}
      energy-solar-census-sha256: ${{ steps.solar_census.outputs.energy-solar-census-sha256 }}
      energy-solar-case-count: ${{ steps.solar_census.outputs.energy-solar-case-count }}
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.sha }}
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Exact source and independent continuous solar contracts
        run: |
          python scripts/test_energy_challenge_provenance.py --verify-candidate "$GITHUB_SHA" EnergyChallengeCommittedCandidateTests -v
          python -m unittest discover -s scripts -p 'test_energy_challenge_solar*.py' -v
      - name: Prepare exact clean continuous solar source
        run: |
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          test -z "$(git status --porcelain=v1 --untracked-files=all)"
          git worktree add --detach "$RUNNER_TEMP/energy-solar-current" "$GITHUB_SHA"
          ln -s "$GITHUB_WORKSPACE/node_modules" "$RUNNER_TEMP/energy-solar-current/node_modules"
          test -z "$(git -C "$RUNNER_TEMP/energy-solar-current" status --porcelain=v1 --untracked-files=all)"
      - name: Bind exact source assets and actual Node runtime
        id: common_identity
        run: python scripts/parallel-gate-identity.py --source-root "$RUNNER_TEMP/energy-solar-current"
      - name: Generate clean route transcript and complete independent native replay oracle
        run: |
          (cd "$RUNNER_TEMP/energy-solar-current" && node --import tsx scripts/energy-challenge-natural-fixture.mjs --out "$GITHUB_WORKSPACE/energy-natural") > energy-solar-natural.log 2>&1
          (cd "$RUNNER_TEMP/energy-solar-current" && python scripts/check-energy-challenge-natural.py --fixture "$GITHUB_WORKSPACE/energy-natural" --require-clean)
          (cd "$RUNNER_TEMP/energy-solar-current" && node --import tsx scripts/energy-challenge-solar-oracle.mjs --natural "$GITHUB_WORKSPACE/energy-natural/report.json" --out "$GITHUB_WORKSPACE/energy-solar-oracle") > energy-solar-oracle.log 2>&1
          (cd "$RUNNER_TEMP/energy-solar-current" && python scripts/check-energy-challenge-solar-oracle.py --oracle "$GITHUB_WORKSPACE/energy-solar-oracle/manifest.json" --require-clean)
          (cd "$RUNNER_TEMP/energy-solar-current" && ENERGY_SOLAR_NATURAL="$GITHUB_WORKSPACE/energy-natural/report.json" node --import tsx --test scripts/test-energy-challenge-solar-oracle.mjs)
          test -z "$(git -C "$RUNNER_TEMP/energy-solar-current" status --porcelain=v1 --untracked-files=all)"
      - name: Browser prerequisites
        timeout-minutes: 4
        run: bash scripts/browser-prerequisites.sh
      - name: Mandatory continuous solar route, 600 seconds plus 20-second cleanup
        shell: bash
        run: |
          npm run preview -- --host 127.0.0.1 --port 4173 > energy-solar-preview.log 2>&1 &
          SERVER_PID=$!
          trap 'kill "$SERVER_PID" || true' EXIT
          READY=0
          for i in $(seq 1 30); do
            if curl -fsS http://127.0.0.1:4173/Infinity/release.json > /dev/null; then READY=1; break; fi
            sleep 1
          done
          test "$READY" = 1
          CHROME="$(command -v google-chrome || command -v google-chrome-stable)"
          timeout --signal=TERM --kill-after=20s 600s xvfb-run -a python scripts/browser-energy-challenge-solar.py --url http://127.0.0.1:4173/Infinity/ --natural energy-natural --oracle energy-solar-oracle/manifest.json --expected-sha "$GITHUB_SHA" --expected-version 0.6.32-alpha.1 --runtime-node "$(node --version)" --node "$(command -v node)" --common-identity common-identity.json --chromium "$CHROME" --output energy-solar-evidence
      - name: Reopen every solar original and independently derive the completed route census
        id: solar_census
        run: |
          python scripts/energy_challenge_solar_census.py --expected-sha "$GITHUB_SHA" energy-solar-evidence > energy-solar-census.json
          python -c "import sys,json;sys.path.insert(0,'scripts');from energy_challenge_census import canonical,sha;print('energy-solar-census-sha256='+sha(canonical(json.load(open('energy-solar-census.json')))))" >> "$GITHUB_OUTPUT"
          echo 'energy-solar-case-count=1' >> "$GITHUB_OUTPUT"
      - name: Archive exact readable continuous solar source
        if: always()
        run: git archive --format=zip --prefix=Infinity/ HEAD > energy-solar-source.zip
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: energy-solar-route-${{ github.sha }}
          path: |
            dist
            energy-solar-source.zip
            common-identity.json
            energy-natural
            energy-solar-oracle
            energy-solar-evidence
            energy-solar-census.json
            energy-solar-*.log
          retention-days: 7
          if-no-files-found: error
'''

LEGACY_JOB_PROJECTION = r'''      - name: Validate all twelve jobs and preserve the complete eleven-job census inputs
        id: legacy_job_results
        env:
          JOB_RESULTS: ${{ toJSON(needs) }}
        run: |
          LEGACY_JOBS="$(python scripts/energy_challenge_solar_aggregate.py project-legacy-jobs)"
          test -n "$LEGACY_JOBS"
          printf 'jobs=%s\n' "$LEGACY_JOBS" >> "$GITHUB_OUTPUT"
'''

SOLAR_AGGREGATE_ADDITION = r'''      - name: Download exact same-run continuous solar originals
        uses: actions/download-artifact@v4
        with:
          name: energy-solar-route-${{ github.sha }}
          path: ${{ runner.temp }}/energy-solar-route-artifact
      - name: Independently rederive the uninterrupted solar census and retain the original 68-case proof
        env:
          JOB_RESULTS: ${{ toJSON(needs) }}
        run: python scripts/energy_challenge_solar_aggregate.py aggregate --solar-artifact "$RUNNER_TEMP/energy-solar-route-artifact" --energy-census energy-aggregate-census.json --expected-sha "$GITHUB_SHA" --output energy-solar-aggregate-census.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: energy-solar-aggregate-census-${{ github.sha }}
          path: energy-solar-aggregate-census.json
          retention-days: 7
          if-no-files-found: error
'''


VERIFIED_INPUT_ANCHOR = "          python -m unittest discover -s scripts -p 'test_research_unlock_copy_browser.py' -v\n"
VERIFIED_INPUT_COMMAND = "          python -m unittest discover -s scripts -p 'test_energy_verified_input.py' -v\n"


def expected_workflow(before=None):
    before=original_workflow() if before is None else before
    assert hashlib.sha256(before.encode()).hexdigest()==BASE_WORKFLOW_SHA256
    current=exact(before,LAB_IMPORT_BEFORE,LAB_IMPORT_AFTER)
    current=exact(current,VERIFIED_INPUT_ANCHOR,VERIFIED_INPUT_ANCHOR+VERIFIED_INPUT_COMMAND)
    current=exact(current,'  required-gates:\n',SOLAR_JOB+'\n  required-gates:\n')
    current=exact(current,'energy-controls, energy-lifecycle, energy-migration]\n','energy-controls, energy-lifecycle, energy-migration, energy-solar-route]\n')
    current=exact(current,'Require all eleven jobs and exact source asset runtime and fixture identities','Require all twelve jobs and exact source asset runtime and fixture identities')
    current=exact(current,"'energy-controls', 'energy-lifecycle', 'energy-migration'}, jobs","'energy-controls', 'energy-lifecycle', 'energy-migration', 'energy-solar-route'}, jobs")
    anchor='      - name: Download exact same-run payments artifact\n'
    current=exact(current,anchor,LEGACY_JOB_PROJECTION+anchor)
    for command in ('python scripts/manual_unit_census.py aggregate', 'python scripts/building_batch_census.py aggregate', 'python scripts/energy_challenge_census.py --expected-sha'):
        old='          JOB_RESULTS: ${{ toJSON(needs) }}\n        run: '+command
        new='          JOB_RESULTS: ${{ steps.legacy_job_results.outputs.jobs }}\n        run: '+command
        current=exact(current,old,new)
    return current+SOLAR_AGGREGATE_ADDITION


def assert_workflow(current,before=None):
    assert current==expected_workflow(before), 'Exact additive twelve-job workflow required'


def previous_workflow(current=None):
    local=ROOT/WORKFLOW_PATH
    assert local.is_file() and not local.is_symlink() and not local.stat().st_mode&0o111, 'Ordinary nonexecutable complete workflow required'
    actual=local.read_bytes().decode()
    expected=expected_workflow()
    assert actual==expected, 'Exact additive twelve-job workflow required'
    if current is not None:assert current==expected, 'Unapproved solar workflow mutation'
    return original_workflow()

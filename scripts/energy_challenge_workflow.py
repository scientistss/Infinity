"""Exact additive eleven-job release contract; all eight earlier budgets survive."""
from pathlib import Path
import hashlib
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = '.github/workflows/p4-original-verify.yml'
# The eight-job workflow is unchanged by A's final fixture repair.
BASE_SHA = '166c77fe0fc36ac40eb390804c2a96598870006e'
BASE_WORKFLOW_SHA256 = '41e39450d0be07725dda0e45a90163473008af580c47e5f3381016f053e8eebd'
OLD_VERSION = '0.6.31-alpha.1'
VERSION = '0.6.32-alpha.1'
OLD_JOBS = ('verify','verify-continuation','npc-orbital','scout-rehearsal','lab-blockers','manual-unit-payments','manual-unit-authority','building-batch')
NEW_JOBS = ('energy-controls','energy-lifecycle','energy-migration')
JOB_LANES = dict(zip(NEW_JOBS, ('controls','lifecycle','migrations')))
COUNTS = {'controls':18,'lifecycle':35,'migrations':15}
BUDGETS = {'controls':420,'lifecycle':420,'migrations':240}
PUBLIC_R14 = '64176f94a43564be73c64ce21968d36e2ae329a3'
RESEARCH_GENERATE = 'node --import tsx scripts/research-unlock-copy-fixture.mjs generate --out research-unlock-copy-fixture'
RESEARCH_GENERATE_R14 = RESEARCH_GENERATE + ' --source-root "$RUNNER_TEMP/research-copy-before"'


def original_workflow():
    raw = subprocess.check_output(['git','--no-replace-objects','-C',str(ROOT),'show',BASE_SHA+':'+WORKFLOW_PATH])
    assert hashlib.sha256(raw).hexdigest() == BASE_WORKFLOW_SHA256
    return raw.decode()


def job_block(job, lane):
    # Independent clean source, producer executions, native documents and artifacts
    # are generated in every job. No lane can reuse another lane's acceptance.
    return '''  __JOB__:
    if: github.event_name != 'push' || !contains(github.event.head_commit.message, '[deep-source]')
    runs-on: ubuntu-latest
    timeout-minutes: 15
    outputs:
      common-identity-sha256: ${{ steps.common_identity.outputs.common-sha256 }}
      energy-census-sha256: ${{ steps.energy_census.outputs.energy-census-sha256 }}
      energy-case-count: ${{ steps.energy_census.outputs.energy-case-count }}
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
      - name: Exact challenge source and additive mandatory gate contracts
        run: |
          python scripts/test_energy_challenge_provenance.py --verify-candidate "$GITHUB_SHA" EnergyChallengeCommittedCandidateTests -v
          python -m unittest discover -s scripts -p 'test_energy_challenge_*.py' -v
          node --import tsx --test scripts/test-r16-compatibility.mjs
      - name: Prepare exact clean candidate and immutable public r14 sources
        run: |
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          test -z "$(git status --porcelain=v1 --untracked-files=all)"
          git worktree add --detach "$RUNNER_TEMP/energy-current" "$GITHUB_SHA"
          ln -s "$GITHUB_WORKSPACE/node_modules" "$RUNNER_TEMP/energy-current/node_modules"
          git worktree add --detach "$RUNNER_TEMP/energy-public-r14" __PUBLIC_R14__
          (cd "$RUNNER_TEMP/energy-public-r14" && npm ci) > energy-public-r14-install.log 2>&1
          test -z "$(git -C "$RUNNER_TEMP/energy-current" status --porcelain=v1 --untracked-files=all)"
          test -z "$(git -C "$RUNNER_TEMP/energy-public-r14" status --porcelain=v1 --untracked-files=all)"
      - name: Bind exact source assets and actual Node runtime
        id: common_identity
        run: python scripts/parallel-gate-identity.py --source-root "$RUNNER_TEMP/energy-current"
      - name: Reproduce three clean paid routes, typed boundaries and genuine historical readers
        run: |
          (cd "$RUNNER_TEMP/energy-current" && node --import tsx scripts/energy-challenge-natural-fixture.mjs --out "$GITHUB_WORKSPACE/energy-natural") > energy-natural.log 2>&1
          python scripts/check-energy-challenge-natural.py --fixture energy-natural/report.json --require-clean
          (cd "$RUNNER_TEMP/energy-current" && node --import tsx scripts/energy-challenge-native-branches.mjs --natural "$GITHUB_WORKSPACE/energy-natural" --out "$GITHUB_WORKSPACE/energy-supplements") > energy-supplements.log 2>&1
          python scripts/check-energy-challenge-native-branches.py --fixture energy-supplements/manifest.json --require-clean
          (cd "$RUNNER_TEMP/energy-current" && node --import tsx scripts/energy-challenge-migration-fixtures.mjs generate "$RUNNER_TEMP/energy-public-r14" "$GITHUB_WORKSPACE/energy-migrations") > energy-migrations.log 2>&1
          ENERGY_PUBLIC_R14_SOURCE="$RUNNER_TEMP/energy-public-r14" node --import tsx --test scripts/test-energy-challenge-migration-oracle.mjs
          python scripts/prepare-energy-challenge-native.py --natural energy-natural/report.json --supplements energy-supplements/manifest.json --migrations energy-migrations/manifest.json --expected-sha "$GITHUB_SHA" --runtime-node "$(node --version)" --output energy-plan.json
          test -z "$(git -C "$RUNNER_TEMP/energy-current" status --porcelain=v1 --untracked-files=all)"
          test -z "$(git -C "$RUNNER_TEMP/energy-public-r14" status --porcelain=v1 --untracked-files=all)"
      - name: Browser prerequisites
        timeout-minutes: 4
        run: bash scripts/browser-prerequisites.sh
      - name: Mandatory __COUNT__-case __LANE__ native gate, __SECONDS__ seconds plus 20-second cleanup
        shell: bash
        run: |
          npm run preview -- --host 127.0.0.1 --port 4173 > energy-preview.log 2>&1 &
          SERVER_PID=$!
          trap 'kill "$SERVER_PID" || true' EXIT
          READY=0
          for i in $(seq 1 30); do
            if curl -fsS http://127.0.0.1:4173/Infinity/release.json > /dev/null; then READY=1; break; fi
            sleep 1
          done
          test "$READY" = 1
          CHROME="$(command -v google-chrome || command -v google-chrome-stable)"
          timeout --signal=TERM --kill-after=20s __SECONDS__s xvfb-run -a python scripts/browser-energy-challenge.py --lane __LANE__ --url http://127.0.0.1:4173/Infinity/ --plan energy-plan.json --expected-plan-sha256 "$(sha256sum energy-plan.json | cut -d' ' -f1)" --expected-sha "$GITHUB_SHA" --expected-version __VERSION__ --runtime-node "$(node --version)" --node "$(command -v node)" --public-r14-source "$RUNNER_TEMP/energy-public-r14" --common-identity common-identity.json --chromium "$CHROME" --output energy-evidence
      - name: Reopen raw originals and derive exact completed lane census
        id: energy_census
        run: |
          python scripts/energy_challenge_census.py --expected-sha "$GITHUB_SHA" --lane __LANE__ energy-evidence > energy-census.json
          python -c "import sys,json;sys.path.insert(0,'scripts');from energy_challenge_census import canonical,sha;print('energy-census-sha256='+sha(canonical(json.load(open('energy-census.json')))))" >> "$GITHUB_OUTPUT"
          echo 'energy-case-count=__COUNT__' >> "$GITHUB_OUTPUT"
      - name: Archive exact readable candidate source
        if: always()
        run: git archive --format=zip --prefix=Infinity/ HEAD > energy-source.zip
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: __JOB__-${{ github.sha }}
          path: |
            dist
            energy-source.zip
            common-identity.json
            energy-census.json
            energy-plan.json
            energy-natural
            energy-supplements
            energy-migrations
            energy-evidence
            energy-*.log
          retention-days: 7
          if-no-files-found: error
'''.replace('__JOB__',job).replace('__LANE__',lane).replace('__PUBLIC_R14__',PUBLIC_R14).replace('__COUNT__',str(COUNTS[lane])).replace('__SECONDS__',str(BUDGETS[lane])).replace('__SUPERVISOR__',str(BUDGETS[lane]+20)).replace('__VERSION__',VERSION)

ENERGY_JOBS = ''.join(job_block(job,lane)+'\n' for job,lane in JOB_LANES.items())
AGGREGATE_ADDITION = ''.join('''      - name: Download exact same-run __JOB__ originals
        uses: actions/download-artifact@v4
        with:
          name: __JOB__-${{ github.sha }}
          path: ${{ runner.temp }}/__JOB__-artifact
'''.replace('__JOB__',job) for job in NEW_JOBS) + '''      - name: Reopen all original energy evidence and rederive the disjoint 68-case census
        env:
          JOB_RESULTS: ${{ toJSON(needs) }}
        run: python scripts/energy_challenge_census.py --expected-sha "$GITHUB_SHA" "$RUNNER_TEMP/energy-controls-artifact/energy-evidence" "$RUNNER_TEMP/energy-lifecycle-artifact/energy-evidence" "$RUNNER_TEMP/energy-migration-artifact/energy-evidence" > energy-aggregate-census.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: energy-aggregate-census-${{ github.sha }}
          path: energy-aggregate-census.json
          retention-days: 7
          if-no-files-found: error
'''


def exact(text,before,after):
    assert text.count(before)==1 and before!=after, before
    return text.replace(before,after,1)


def expected_workflow(before=None):
    before = original_workflow() if before is None else before
    assert hashlib.sha256(before.encode()).hexdigest()==BASE_WORKFLOW_SHA256
    assert before.count(OLD_VERSION)==8
    current=before.replace(OLD_VERSION,VERSION)
    current=exact(current,RESEARCH_GENERATE,RESEARCH_GENERATE_R14)
    current=exact(current,'  required-gates:\n',ENERGY_JOBS+'  required-gates:\n')
    current=exact(current,'    needs: ['+', '.join(OLD_JOBS)+']\n','    needs: ['+', '.join((*OLD_JOBS,*NEW_JOBS))+']\n')
    current=exact(current,'Require all eight jobs and exact source asset runtime and fixture identities','Require all eleven jobs and exact source asset runtime and fixture identities')
    current=exact(current,"'manual-unit-authority', 'building-batch'}, jobs","'manual-unit-authority', 'building-batch', 'energy-controls', 'energy-lifecycle', 'energy-migration'}, jobs")
    return current+AGGREGATE_ADDITION

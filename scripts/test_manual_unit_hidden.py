"""Offline contracts for the one raw-CDP hidden case. No Node or browser launch."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'scripts/browser-manual-unit-hidden.mjs'


def body(name, following):
    text = HELPER.read_text()
    return text.split(name, 1)[1].split(following, 1)[0]


class ManualUnitHiddenHelperTests(unittest.TestCase):
    def test_release_identity_requires_current_r16_and_complete_parent_metadata(self):
        source = HELPER.read_text()
        release_check = next(line for line in source.splitlines()
                             if "check('actual release pins exact SHA version" in line)
        expected_revision = int(re.search(r'report\.releaseMetadata\.saveRevision === (\d+)', release_check).group(1))
        self.assertEqual(expected_revision, 16)
        for historical_or_unsupported in (14, 15, 999):
            self.assertNotEqual(expected_revision, historical_or_unsupported)
        current = (ROOT / 'src/game/content.ts').read_text()
        self.assertEqual(expected_revision, int(re.search(r'export const SAVE_REVISION = (\d+);', current).group(1)))
        for required in ('response.status === 200', 'requests.get(response.requestId)?.url === releaseURL',
                         'report.releaseMetadata.sourceSha === input.expectedSha',
                         'report.releaseMetadata.version === input.expectedVersion',
                         'report.releaseMetadata.saveVersion === 9',
                         'Object.keys(report.releaseMetadata.files || {}).length === 62',
                         'isDeepStrictEqual(report.releaseMetadata, input.expectedRelease)'):
            self.assertIn(required, release_check)

    def test_ci_only_guard_precedes_output_and_chrome_start(self):
        source = HELPER.read_text()
        self.assertIn("process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'", source)
        self.assertLess(source.index('CI-only native hidden acceptance'), source.index('await mkdir(output)'))
        self.assertLess(source.index('CI-only native hidden acceptance'), source.index('chrome = spawn('))

    def test_independent_owned_headed_raw_cdp_only(self):
        source = HELPER.read_text()
        self.assertIn('new WebSocket(url)', source)
        self.assertIn("'Target.attachToTarget'", source)
        self.assertIn("'Browser.getVersion'", source)
        self.assertIn("'Chrome/' + input.expectedBrowserVersion", source)
        for forbidden in ('--headless', '--no-sandbox', '--disable-background',
                          'Emulation.setFocusEmulationEnabled', 'Emulation.setPageVisibilityOverride',
                          "from 'playwright'", "from 'puppeteer'", 'dispatchEvent('):
            self.assertNotIn(forbidden, source)

    def test_original_seed_and_adopted_before_state_remain_distinct(self):
        source = HELPER.read_text()
        self.assertIn("key: input.key, value: input.initialRaw", source)
        self.assertIn("key: 'infinity.ui.tab', value: 'overview'", source)
        self.assertIn('ready.initialRaw === input.initialRaw', source)
        self.assertIn("report.beforeSave = await realSave('before-payment', input.beforeState)", source)
        self.assertLess(source.index("realSave('before-payment'"), source.index("await tab('shipyard')"))
        self.assertIn('isDeepStrictEqual(paidEnvelope.state, input.expectedState)', source)
        self.assertIn("realSave('hidden-resume-entire-state', input.expectedState)", source)
        self.assertIn("envelope.schema === 'infinity-original-p4'", source)
        self.assertIn('envelope.version === 9 && envelope.revision === 16', source)

    def test_original_clock_only_zero_advances_visible_and_native_clocks_separate(self):
        source = HELPER.read_text()
        self.assertIn("source: diagnostics(input.key) + '\\n' + input.clockScript", source)
        self.assertEqual(re.findall(r'__npcAdvance\(([^)]*)\)', source), ['0'])
        self.assertIn("!hiddenPhase && (await probe())?.state === 'visible'", source)
        self.assertIn('const date = Date.now.bind(Date), perf = performance.now.bind(performance)', source)
        self.assertIn('noOwnHidden:!Object.hasOwn(document,\'hidden\')', source)
        self.assertIn('noOwnVisibility:!Object.hasOwn(document,\'visibilityState\')', source)
        self.assertNotIn('Date.now=', source)
        self.assertNotIn('Math.random()', source)
        self.assertNotIn("Object.defineProperty(document", source)
        self.assertIn('report.functionalAdvanceCalls.push(row)', source)

    def test_native_clicks_unique_enabled_five_hits_and_settled(self):
        source = HELPER.read_text()
        self.assertIn('rows.length!==1', source)
        self.assertIn('g.points?.length === 5', source)
        self.assertIn('g.points.every(p => p.unoccluded)', source)
        self.assertIn('hittable(g) && !g.disabled', source)
        self.assertIn('identical >= 4 && now - stableHost >= 150', source)
        self.assertIn('now - began <= 1_600', source)
        self.assertIn("type: 'mouseWheel'", source)
        self.assertIn("type: 'mousePressed'", source)
        self.assertIn("type: 'mouseReleased'", source)
        self.assertIn('events.length === 1 && events[0].trusted', source)
        self.assertNotIn('.click()', source)
        self.assertNotIn('scrollIntoView(', source)
        self.assertNotIn('scrollTo(', source)
        self.assertNotIn('.value=', source)

    def test_payment_exactly_once_with_independent_literal_golden(self):
        source = HELPER.read_text()
        self.assertEqual(source.count("await click('[data-bind=\"upay-small_cargo\"]')"), 1)
        self.assertIn("metal: '2000', crystal: '2000', deuterium: '0'", source)
        self.assertIn('String(BigInt(planet.resources[k]) - BigInt(prices[k]))', source)
        self.assertIn('isDeepStrictEqual(paidEnvelope.state, literal)', source)
        self.assertIn('job.jobId === input.beforeState.orders.nextJobId', source)
        self.assertIn('job.count === 1 && job.orderedCount === 1', source)
        self.assertIn("job.source === 'manual' && job.taskId === null", source)
        self.assertIn('literal.orders.nextJobId++; literal.stats.manualActions++', source)
        self.assertIn("filter(e => e.action === 'manual-unit-pay').length === 1", source)
        self.assertIn('report.afterResumeCard.payDisabled', source)

    def test_single_cover_and_resume_are_bounded_and_sequence_correlated(self):
        source = HELPER.read_text()
        self.assertEqual(source.count("cdp.send('Target.activateTarget'"), 2)
        self.assertIn("newWindow: false, background: true", source)
        self.assertIn('gameWindow.windowId === coverWindow.windowId', source)
        self.assertIn("coverBefore.hidden && coverBefore.state === 'hidden'", source)
        self.assertIn("phase('native hidden transition', 5_000", source)
        self.assertIn("phase('native visible resume', 5_000", source)
        self.assertIn('e.seq > gameBefore.seq', source)
        self.assertIn('e.seq > report.hidden.seq', source)
        self.assertIn('report.resumedEvent.seq > report.hiddenEvent.seq', source)
        self.assertIn('report.resumedEvent.nativeMono > report.hiddenEvent.nativeMono', source)
        self.assertIn('report.initial.id === report.hidden.id', source)
        hidden = source.split('hiddenPhase = true;', 1)[1].split('hiddenPhase = false;', 1)[0]
        for forbidden in ('await advance()', 'captureScreenshot', '__npcObserveFrame', 'Date.now()'):
            self.assertNotIn(forbidden, hidden)

    def test_real_document_js_css_v8_and_all62_bodies_are_bound(self):
        source = HELPER.read_text()
        self.assertIn("'Network.getResponseBody'", source)
        self.assertIn("'Debugger.getScriptSource'", source)
        self.assertIn('report.sourceBindings.push(value)', source)
        self.assertIn('document.sha256 === document.expected', source)
        self.assertIn("rows.some(r => r.kind === 'script')", source)
        self.assertIn("rows.some(r => r.kind === 'stylesheet')", source)
        self.assertIn('r.sha256 === r.httpSha256 && r.sha256 === r.expected', source)
        self.assertIn('isDeepStrictEqual(report.releaseMetadata, input.expectedRelease)', source)
        self.assertIn('all.length === 62', source)
        self.assertIn("body: await bytes('release-resource', body)", source)
        self.assertIn('report.inputSha256 = digest(original)', source)

    def test_exclusive_original_evidence_and_failure_live_capture(self):
        source = HELPER.read_text()
        self.assertIn('await mkdir(output);', source)
        self.assertNotIn('mkdir(output, { recursive: true })', source)
        self.assertIn("{ flag: 'wx' }", source)
        self.assertIn('relative(evidenceRoot || dirname(output), path)', source)
        self.assertIn('report.failureSnapshot = await evaluate(', source)
        self.assertIn('html:document.documentElement.outerHTML', source)
        self.assertIn("if (!report.failureSnapshot.hidden && report.failureSnapshot.state === 'visible')", source)
        self.assertLess(source.index('await failureCapture();'), source.index('try { await cleanup(); }'))
        self.assertIn("join(output, 'report.json')", source)
        self.assertIn('workDeadline = started + 39_000, wholeDeadline = started + 45_000', source)

    def test_failure_diagnostics_cannot_grant_running_task_permission(self):
        source = HELPER.read_text()
        self.assertNotIn('diagnosticMode', source)
        self.assertIn('function guard(diagnostic = false)', source)
        self.assertIn('send(method, params = {}, sessionId, diagnostic = false)', source)
        self.assertIn('guard(diagnostic)', source)
        self.assertIn('workAbort.abort()', source)
        self.assertIn('if (stopping) { await rm(createdProfile, { recursive: true, force: true }); guard(); }', source)
        self.assertIn('guard(); // Never launch a browser after a pending setup operation', source)
        self.assertIn("guard(); report.completed = true", source)
        self.assertIn('gameSession, false, true', source)
        outer_failure = source.split("report.failure = { message: String(error), stack: error.stack };", 1)[0]
        self.assertIn('clearTimeout(deadlineTimer); // Do not let the work timer', outer_failure)

    def test_owned_socket_process_group_exit_and_profile_cleanup_are_required(self):
        source = HELPER.read_text()
        self.assertIn('this.socket.close()', source)
        self.assertIn('await cdp.close()', source)
        self.assertIn("groupAlive('SIGTERM')", source)
        self.assertIn("groupAlive('SIGKILL')", source)
        self.assertIn('process.kill(-chrome.pid, signal)', source)
        self.assertIn('exitPromise', source)
        self.assertIn("join(output, 'chrome-owner.json')", source)
        self.assertIn('nodePid: process.pid, parentPid: process.ppid, chromePid: chrome.pid, pgid: chrome.pid', source)
        self.assertIn('await link(ownerPending, ownerPath)', source)
        self.assertLess(source.index('await writeFile(ownerPending'), source.index('await link(ownerPending'))
        self.assertLess(source.index('await link(ownerPending'), source.index('await unlink(ownerPending'))
        self.assertIn('report.cleanup.processExited = !chrome || chromeExited', source)
        self.assertIn('report.cleanup.processGroupGone = !groupAlive(0)', source)
        self.assertIn('report.cleanup.socketClosed && report.cleanup.processExited && report.cleanup.processGroupGone && report.cleanup.profileRemoved', source)


if __name__ == '__main__':
    unittest.main()

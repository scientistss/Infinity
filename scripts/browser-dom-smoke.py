"""Production-bundle DOM smoke tests. Browser navigation is not required.

Uses an explicit in-memory Storage double and a controllable rAF clock. This is
NOT native localStorage, network serving, or a deployed-site end-to-end test.
Install Python playwright and Chromium, build first, then pass a fixture created
with scripts/p4-fixture.ts. Screenshots inline the repository's existing assets.
"""
from pathlib import Path
import argparse
import base64
import json
import mimetypes
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--fixture', required=True)
parser.add_argument('--output', default='dom-evidence')
parser.add_argument('--chromium', default='/usr/bin/chromium')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
fixture = json.loads(Path(args.fixture).read_text())
js = next(dist.glob('assets/*.js')).read_text()
css = next(dist.glob('assets/*.css')).read_text()
assets = {f.name: 'data:' + (mimetypes.guess_type(f.name)[0] or 'application/octet-stream') + ';base64,' + base64.b64encode(f.read_bytes()).decode()
          for f in (dist / 'icons').iterdir() if f.is_file()}
checks = []
errors = []

def check(name, ok):
    if not ok:
        raise AssertionError(name)
    checks.append({'name': name, 'passed': True})

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    page.set_content('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><head></head><body><div id="app"></div></body></html>')
    page.add_style_tag(content=css)
    page.evaluate('''fixture => {
      const data = {'infinity.save.v1':JSON.stringify(fixture),'infinity.ui.tab':'empire'};
      Object.defineProperty(window,'localStorage',{value:{getItem:k=>data[k]??null,setItem:(k,v)=>data[k]=String(v),removeItem:k=>delete data[k],clear:()=>{for(const k in data)delete data[k]}}});
      let clock = 1000, frames = [];
      Object.defineProperty(performance,'now',{value:()=>clock});
      Date.now = () => fixture.savedAt + clock - 1000;
      window.requestAnimationFrame = fn => {frames.push(fn); return frames.length;};
      window.cancelAnimationFrame = () => {};
      window.setInterval = () => 0;
      window.__step = seconds => {clock += seconds * 1000; const current=frames; frames=[]; for(const fn of current)fn(clock);};
    }''', fixture)
    page.add_script_tag(type='module', content=js)
    page.wait_for_selector('[data-tab="empire"]')
    page.evaluate('''assets => {
      for(const img of document.querySelectorAll('img')) {
        const name=img.getAttribute('src').split('/').at(-1);
        img.removeAttribute('srcset'); img.removeAttribute('sizes'); img.loading='eager';
        if(assets[name])img.src=assets[name];
      }
    }''', assets)
    check('all four expansion tabs mounted', page.locator('[data-tab="empire"], [data-tab="galaxy"], [data-tab="fleet"], [data-tab="messages"]').count() == 4)
    check('review fixture has two canonical planets', page.locator('#active-planet option').count() == 2)
    page.screenshot(path=str(output / 'empire-desktop.png'), full_page=True)
    page.locator('#active-planet').select_option('review-colony')
    check('planet selector dispatches to game state', page.evaluate("JSON.parse(localStorage.getItem('infinity.save.v1')).state.activePlanetId") == 'review-colony')
    page.locator('#active-planet').select_option('home')
    page.locator('[data-tab="galaxy"]').click()
    check('galaxy renders fifteen positions', page.locator('.galaxy-row').count() == 15)
    page.locator('#browse-system').fill('100')
    page.locator('[data-action="galaxy-next"]').click()
    check('galaxy navigation wraps at boundary', page.locator('#browse-system').input_value() == '1')
    page.locator('#browse-system').fill('50')
    page.locator('[data-action="galaxy-browse"]').click()
    page.screenshot(path=str(output / 'galaxy-desktop.png'), full_page=True)
    check('desktop does not overflow viewport', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(output / 'galaxy-mobile.png'), full_page=True)
    check('mobile galaxy does not overflow viewport', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.locator('.galaxy-row.empty [data-mission="colonize"]').first.click()
    check('galaxy route fills mission composer', page.locator('#flight-mission').input_value() == 'colonize' and page.locator('[data-tab-panel="fleet"]').is_visible())
    page.locator('#flight-ship-colony_ship').fill('1')
    page.locator('#flight-ship-small_cargo').fill('1')
    page.locator('#flight-metal').fill('2000')
    page.locator('#flight-crystal').fill('1200')
    page.locator('#flight-deuterium').fill('800')
    page.evaluate('window.__step(0.2)')
    check('typing survives simulation render', page.locator('#flight-metal').input_value() == '2000' and page.locator('#flight-ship-colony_ship').input_value() == '1')
    page.locator('[data-action="preview-flight"]').click()
    check('quote displays fuel and one-way time', '往返燃料' in page.locator('#flight-feedback').inner_text())
    page.locator('[data-action="send-fleet"]').click()
    check('dispatch persists an in-flight mission', page.evaluate("JSON.parse(localStorage.getItem('infinity.save.v1')).state.fleets.length") == 1)
    page.evaluate('window.__button = document.querySelector("[data-action=recall-fleet]"); window.__step(0.1)')
    check('recall button retains identity across render', page.evaluate('window.__button === document.querySelector("[data-action=recall-fleet]")'))
    page.screenshot(path=str(output / 'fleet-desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(output / 'fleet-mobile.png'), full_page=True)
    check('mobile fleet composer does not overflow viewport', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    page.set_viewport_size({'width': 1440, 'height': 1000})
    duration = page.evaluate("JSON.parse(localStorage.getItem('infinity.save.v1')).state.fleets[0].duration")
    page.evaluate('(seconds)=>window.__step(seconds)', duration * 2 + 2)
    check('colony arrival updates planet selector', page.locator('#active-planet option').count() == 3)
    page.locator('[data-tab="messages"]').click()
    check('colonization report appears', '已建立' in page.locator('#fleet-messages').inner_text())
    page.screenshot(path=str(output / 'messages-desktop.png'), full_page=True)
    page.locator('[data-tab="save"]').click()
    page.locator('[data-action="save"]').click()
    before = page.evaluate("JSON.parse(localStorage.getItem('infinity.save.v1')).state")
    page.locator('[data-bind="transfer"]').fill('{"version":8,"savedAt":1,"state":{}}')
    page.locator('[data-action="import-text"]').click()
    after = page.evaluate("JSON.parse(localStorage.getItem('infinity.save.v1')).state")
    check('v8 import cannot overwrite the current game', before == after)
    check('no uncaught JavaScript exceptions', not errors)
    browser.close()

report = {'mode': 'isolated production-bundle DOM with in-memory Storage double; no native persistence or deployment claims', 'checks': checks, 'pageErrors': errors}
(output / 'browser-dom-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps({'passed': len(checks), 'pageErrors': errors, 'mode': report['mode']}, ensure_ascii=False))

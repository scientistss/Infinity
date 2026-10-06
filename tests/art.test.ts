import {describe,expect,it} from 'vitest';
import {ART,UNIT_ART,GAME_VERSION,artUrl,icon} from '../src/ui/art';
import manifest from '../src/data/art-manifest.json';
import {UNIT_IDS} from '../src/data/units';
import pkg from '../package.json';
describe('versioned art registry',()=>{
 it('registers 50 hashed crops with safe paths and intrinsic dimensions',()=>{expect(Object.keys(ART)).toHaveLength(50);for(const a of Object.values(ART)){expect(a.file).toMatch(/^art\/v1\/[a-z-]+\.[a-f0-9]{12}\.webp$/);expect(a.bytes).toBeGreaterThan(0);expect(a.file).toContain(a.sha256.slice(0,12));expect(a.width).toBeGreaterThan(0);expect(a.height).toBeGreaterThan(0);expect(a.alt.length).toBeGreaterThan(0);}});
 it('covers all units and uses deployment base, refusing unknown art',()=>{for(const id of UNIT_IDS)expect(ART[UNIT_ART[id]]).toBeDefined();expect(artUrl('metal')).toBe(`${import.meta.env.BASE_URL}${ART.metal.file}`);expect(()=>artUrl('not-an-asset')).toThrow('Unregistered art');expect(artUrl('metal_mine')).toContain(ART['metal-mine'].file);});
 it('escapes attribute text and emits accessible intrinsic image dimensions',()=>{const h=icon('metal','small',{alt:'" onerror="alert(1)',lazy:false});expect(h).toContain('alt="&quot; onerror=&quot;alert(1)"');expect(h).not.toContain('loading="lazy"');expect(h).toContain(`width="${ART.metal.width}"`);expect(h).toContain(`height="${ART.metal.height}"`);expect(icon('metal','',{alt:''})).toContain('aria-hidden="true"');});
 it('uses one release version and honest provenance',()=>{expect(GAME_VERSION).toBe(pkg.version);expect(GAME_VERSION).toBe('0.5.0-alpha.2');expect(manifest.source.provider).toContain('not Google Imagen');});
});

/** Prepared review data only; all reports and trades are created by the actual game rules. */
import { readFileSync } from 'node:fs';
import { deserializeState, importSave, exportSave } from '../src/game/save.ts';
import { activePlanet } from '../src/game/empire.ts';
import { emptyCargo, sendFleet } from '../src/game/fleet.ts';
import { tick } from '../src/game/logic.ts';
import { rollCharge } from '../src/game/deep-space.ts';
let state=deserializeState(importSave(readFileSync('deep-fixtures/pirate.json','utf8')).state);
const request=s=>({mission:'charge',target:{...activePlanet(s).coordinates,position:16},ships:{small_cargo:5,light_fighter:30,cruiser:8},cargo:emptyCargo(),speedPercent:100,holdSlots:1});
for(const symbol of ['pirate','merchant']) {
  const sent=sendFleet(state,request(state));if(!sent.ok)throw Error(sent.reason);
  state=tick(sent.state,sent.state.fleets[0].duration);
  let found=false;
  for(let seed=1;seed<20000;seed++) {
    state.deepSpace.seed=seed;
    if(rollCharge(state,state.fleets[0]).rawSymbol===symbol){found=true;break;}
  }
  if(!found)throw Error('No fixture seed');
  state=tick(state,60);
  if(state.fleets.length)state=tick(state,state.fleets[0].remaining+.01);
}
const sent=sendFleet(state,{...request(state),holdSlots:3});if(!sent.ok)throw Error(sent.reason);
state=tick(sent.state,sent.state.fleets[0].duration+5);
process.stdout.write(exportSave(state));

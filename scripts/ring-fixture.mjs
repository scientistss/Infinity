/** Rule-generated showcase, deliberately pre-funded. Not a normal new-game save. */
import { readFileSync } from 'node:fs';
import { deserializeState, importSave, exportSave } from '../src/game/save.ts';
import { tick } from '../src/game/logic.ts';
import { grantRun, revealRun } from '../src/game/arcade.ts';
import { BOARD } from '../src/data/arcade.ts';
let state=deserializeState(importSave(readFileSync('deep-fixtures/merchant.json','utf8')).state);
state=tick(state,120,'offline');
while(state.arcade.runs.length)state=revealRun(state,'manual').state;
for(const symbol of ['metal','crystal','deuterium','dark_matter','drifter','lucky','jackpot']){
 for(let seed=1;seed<10000;seed++){
  const trial=grantRun({...state,arcade:{...state.arcade,seed}},'beacon').state;
  if(BOARD[trial.arcade.runs.at(-1)?.outcome.main.tile]!==symbol)continue;
  state=revealRun(trial,'manual').state;state=tick(state,.01);break;
 }
}
for(let i=0;i<2;i++)state=grantRun(state,'beacon').state;
process.stdout.write(exportSave(state));

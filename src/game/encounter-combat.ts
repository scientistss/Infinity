import { SHIP_IDS, RAPID_FIRE, unitById, type ShipId } from "../data/units";
import { DEEP } from "../data/deep-space";
import { Rng } from "./rng";
import type { ShipCounts } from "./deep-state";
export interface CombatTech { weapons:number; shields:number; armour:number }
export interface BattleRound { round:number; attacker:number; defender:number; attackDamage:number; defendDamage:number }
export interface BattleResult {
  mode:"squadron-v1"; winner:"attacker"|"defender"|"draw"; rounds:BattleRound[];
  attackerBefore:ShipCounts; defenderBefore:ShipCounts; attackerAfter:ShipCounts; defenderAfter:ShipCounts;
}
const count=(s:ShipCounts)=>Object.values(s).reduce((n,v)=>n+(v??0),0);
/** Bounded six-round squadron approximation, NOT OGame's per-ship random-shot simulator.
 * Each round is simultaneous; shields regenerate. Rapid-fire is its geometric expected multiplier.
 * Damage is distributed by surviving target count; residual hull damage persists per ship type.
 * Runtime is proportional to ship TYPES, never total fleet count. */
export function fightEncounter(a:ShipCounts,b:ShipCounts,ta:CombatTech,tb:CombatTech,seed:number):BattleResult {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error("战斗随机种子无效");
  for (const ships of [a,b]) {
    if (!ships || typeof ships !== "object" || Array.isArray(ships)) throw Error("交战舰队格式无效");
    for (const [id,n] of Object.entries(ships)) {
    if(!SHIP_IDS.includes(id as ShipId)||id==="solar_satellite"||!Number.isSafeInteger(n)||n<0||n>1e12) throw Error("交战舰船数量无效");
    }
  }
  for (const t of [ta, tb]) {
    if (!t || typeof t !== "object") throw Error("战斗科技无效");
    for (const key of ["weapons", "shields", "armour"] as const) {
      const value = t[key];
      if (!Number.isInteger(value) || value < 0 || value > 1002) throw Error("战斗科技无效");
    }
  }
  const rng=new Rng(seed), rounds:BattleRound[]=[];
  let sa={...a},sb={...b};
  const hull=(s:ShipCounts,t:CombatTech)=>Object.fromEntries(Object.entries(s).map(([id,n])=>[id,n*unitById(id as ShipId).structure/10*(1+.1*t.armour)]));
  const ha=hull(sa,ta),hb=hull(sb,tb);
  const damage=(s:ShipCounts,target:ShipCounts,t:CombatTech)=>{
    const total=count(target);if(!total)return 0;
    let d=0;
    for(const [id,n] of Object.entries(s)){
      // P(continue)=sum(target fraction*(1-1/RF)); E(shots)=1/(1-P).
      const stop=Object.entries(target).reduce((sum,[v,m])=>sum+m/total/(RAPID_FIRE[id as ShipId][v as ShipId]??1),0);
      d+=n*unitById(id as ShipId).attack*(1+.1*t.weapons)/Math.max(1/1250,stop);
    }
    return d*(.9+.2*rng.next());
  };
  const apply=(s:ShipCounts,h:Record<string,number>,t:CombatTech,d:number)=>{
    const total=count(s);if(!total)return {...s};const result:ShipCounts={};
    for(const [id,n]of Object.entries(s)){
      const unit=unitById(id as ShipId),incoming=d*n/total;
      h[id]=Math.max(0,(h[id]??0)-Math.max(0,incoming-n*unit.shield*(1+.1*t.shields)));
      const survive=Math.min(n,Math.ceil(h[id]!/(unit.structure/10*(1+.1*t.armour))));
      if(survive)result[id as ShipId]=survive;
    }
    return result;
  };
  for(let i=1;i<=DEEP.combatRounds&&count(sa)&&count(sb);i++){
    const ad=damage(sa,sb,ta),bd=damage(sb,sa,tb);
    sa=apply(sa,ha,ta,bd);sb=apply(sb,hb,tb,ad);
    rounds.push({round:i,attacker:count(sa),defender:count(sb),attackDamage:ad,defendDamage:bd});
  }
  return {mode:"squadron-v1",winner:count(sa)&&!count(sb)?"attacker":count(sb)&&!count(sa)?"defender":"draw",
    rounds,attackerBefore:{...a},defenderBefore:{...b},attackerAfter:sa,defenderAfter:sb};
}

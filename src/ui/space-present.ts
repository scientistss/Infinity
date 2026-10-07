import { SPACE, coordinateKey, distance, npcAt, planetProperties, positionBonus, type Coordinates } from "../game/galaxy";
import { quoteFlight, colonyCount, colonyLimit, fleetSlots, reservedColonies, MISSION_LABEL, type FleetRequest } from "../game/fleet";
import { activePlanet } from "../game/empire";
import { HOMEWORLD_ID } from "../game/planet";
import { formatAmount, formatDuration } from "../game/format";
import { big } from "../game/decimal";
import { SHIP_IDS, unitById } from "../data/units";
import type { GameState } from "../game/types";
export function spaceView(state:GameState,cursor:Coordinates,request:FleetRequest) {
  const home=activePlanet(state);
  const quote=quoteFlight(state,request);
  return {
    origin:`${home.name} [${coordinateKey(home.coordinates)}]`,
    slots:`舰队 ${state.fleets.length}/${fleetSlots(state)} · 殖民地 ${colonyCount(state)}/${colonyLimit(state)} · 在途预留 ${reservedColonies(state)}`,
    quote:{ok:quote.ok,text:quote.ok?`单程 ${formatDuration(Math.ceil(quote.duration))} · 往返燃料 ${formatAmount(quote.fuel)} 重氢 · 总货舱 ${formatAmount(quote.capacity)}`:quote.reason},
    rows:Array.from({length:16},(_,i)=>{
      const c={galaxy:cursor.galaxy,system:cursor.system,position:i+1};
      const own=state.planets.find(p=>coordinateKey(p.coordinates)===coordinateKey(c));
      const npc=npcAt(state,c);const deep=c.position===16;
      const reserved=state.fleets.some(f=>f.mission==="colonize"&&!f.returning&&coordinateKey(f.target)===coordinateKey(c));
      const props=own??(deep?null:planetProperties(state.universe.seed,c));
      const bonus=deep?"—":own?.id===HOMEWORLD_ID?"母星基准":`金属 ×${positionBonus(c.position,"metal")} · 晶体 ×${positionBonus(c.position,"crystal")}`;
      return {key:coordinateKey(c),position:c.position,name:deep?"深空 · 星环充能区":own?.name??npc?.name??"未占据行星",kind:deep?"深空预留":own?"己方":npc?"NPC 邻居":reserved?"殖民在途":"空位",properties:props?`${props.tempMax-40}～${props.tempMax} °C · ${props.fieldsMax} 格`:"驻留充能将在下一步开放",bonus,distance:distance(home.coordinates,c),planetId:own?.id??"",canColonize:!deep&&!own&&!npc&&!reserved,canScout:!deep&&!own,canTransport:!!own&&own.id!==home.id};
    }),
    ships:SHIP_IDS.filter(id=>id!=="solar_satellite").map(id=>({id,name:unitById(id).nameZh,count:home.units[id]})),
    fleets:state.fleets.map(f=>({id:f.id,title:`#${f.id} ${MISSION_LABEL[f.mission]} · ${f.returning?"返航":"出航"}`,route:`${state.planets.find(p=>p.id===f.originId)?.name??f.originId} → [${coordinateKey(f.target)}]`,remaining:`${formatDuration(Math.ceil(f.remaining))} 后${f.returning?"入港":"抵达"}`,progress:Math.max(0,Math.min(100,100*(1-f.remaining/f.duration))),canRecall:!f.returning})),
    planets:state.planets.map(p=>({id:p.id,name:p.name,coordinate:coordinateKey(p.coordinates),stock:`金属 ${formatAmount(p.resources.metal)} · 晶体 ${formatAmount(p.resources.crystal)} · 重氢 ${formatAmount(p.resources.deuterium)}`,selected:p.id===home.id,canAbandon:p.id!==HOMEWORLD_ID})),
    messages:state.messages.slice().reverse().map(m=>({id:m.id,text:m.text,time:`游戏 ${formatDuration(Math.floor(m.at))}`})),
    seed:String(state.universe.seed),
    phase:`原版续作 · 银河与舰队 v1 · 宇宙 ${SPACE.galaxies}×${SPACE.systems}×${SPACE.positions}+深空`,
    // Explicit structured text: no unit count is fabricated from a decorative picture.
    zero:formatAmount(big(0)),
  };
}
export type SpaceView = ReturnType<typeof spaceView>;

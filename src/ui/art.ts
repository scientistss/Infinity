/** Hashed, local-only artwork; no remote hotlinks or rasterized labels. */
import manifest from "../data/art-manifest.json";
import pkg from "../../package.json";
import type { UnitId } from "../data/units";
export const GAME_VERSION=pkg.version;
export const ART=manifest.assets;
export type ArtId=keyof typeof ART;
const ALIASES:Record<string,ArtId>={logo:'nav-planet',tech:'research-lab',save:'nav-tasks',achievement:'badge-explorer',protocol_card:'dark-matter',warp_core:'badge-infinity',launch:'colonizer',dark_matter:'dark-matter',ring_machine:'shipyard',robotics_factory:'spaceport',metal_mine:'metal-mine',crystal_mine:'crystal-mine',deuterium_synth:'deuterium-synth',solar_plant:'solar-plant',research_lab:'research-lab'};
export const UNIT_ART:Record<UnitId,ArtId>={small_cargo:'transport',large_cargo:'transport',light_fighter:'frigate',heavy_fighter:'destroyer',cruiser:'cruiser',battleship:'battleship',battlecruiser:'battleship',bomber:'destroyer',destroyer:'destroyer',deathstar:'capital',recycler:'transport',espionage_probe:'scout',solar_satellite:'solar-plant',colony_ship:'colonizer',rocket_launcher:'defense',light_laser:'defense',heavy_laser:'defense',gauss_cannon:'defense',ion_cannon:'defense',plasma_turret:'defense',small_shield_dome:'solar-plant',large_shield_dome:'solar-plant',anti_ballistic_missile:'defense',interplanetary_missile:'defense'};
export function resolveArt(name:string):ArtId {
 const key=(Object.hasOwn(ALIASES,name)?ALIASES[name]:name)!;
 if(!Object.hasOwn(ART,key))throw new Error(`Unregistered art: ${name}`);
 return key as ArtId;
}
export function artUrl(name:string):string{return `${import.meta.env.BASE_URL}${ART[resolveArt(name)].file}`;}
export const escapeAttribute=(s:string):string=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export interface IconOptions{lazy?:boolean;size?:number;alt?:string}
export function icon(name:string,extra='',options:IconOptions={}):string {
 const id=resolveArt(name), a=ART[id], alt=options.alt??a.alt;
 return `<img class="icon icon-${id}${extra?` ${escapeAttribute(extra)}`:''}" data-art="${id}" src="${artUrl(id)}" alt="${escapeAttribute(alt)}" width="${a.width}" height="${a.height}"${options.lazy===false?'':' loading="lazy"'} decoding="async" draggable="false"${alt===''?' aria-hidden="true"':''} />`;
}
interface Scene{title:string;detail:string;art:ArtId;sector:string}
const SCENES:Record<string,Scene>={
 overview:{title:'一个世界，无限可能',detail:'查看产线、能源和队列。每一次建设，都是走向深空的一步。',art:'homeworld',sector:'母星总览'},
 facilities:{title:'让荒芜星球开始运转',detail:'建立资源产线，平衡能源供给，为第一次星际航行做好准备。',art:'homeworld',sector:'行星建设'},
 empire:{title:'从一个世界，到星际网络',detail:'各殖民地独立生产、同步建设；以运输和部署连接你的帝国。',art:'colony',sector:'帝国控制台'},
 galaxy:{title:'下一站，未知星系',detail:'浏览银河、寻找殖民坐标，或派出侦察舰确认周围的世界。',art:'galaxy',sector:'银河导航'},
 fleet:{title:'你的舰队，准备启航',detail:'配置任务、速度与货物。确认燃料和货舱后，下达航行指令。',art:'fleet',sector:'舰队指挥'},
 shipyard:{title:'把资源，变成航行的力量',detail:'批次造船、逐艘交付。从第一艘运输舰到远航殖民船。',art:'fleet',sector:'轨道船坞'},
 defense:{title:'为未来建立防线',detail:'查看防御设施与生产队列。当前版本尚未开放战斗。',art:'orbital',sector:'防御设施'},
 research:{title:'以知识拓展边界',detail:'帝国共享研究成果。发展引擎、能源与天体物理，解锁下一步。',art:'colony',sector:'研究网络'},
 protocol:{title:'让你的规则接管重复劳动',detail:'当触发器满足条件，就执行动作。用协议卡搭建自动化产线。',art:'orbital',sector:'协议矩阵'},
 curvature:{title:'一次重启，更远的旅程',detail:'发射殖民舰是曲率重置，不是银河里的殖民任务。重置前请确认收益与损失。',art:'deep-space',sector:'曲率科技'},
 arcade:{title:'接收来自深空的信标',detail:'结果预掷、赔率公开。跑灯只负责揭晓，不影响游戏规则。',art:'deep-space',sector:'深空星环机'},
 darkmatter:{title:'把稀有资源用在关键处',detail:'暗物质仅由游戏获得。选择加速、补给或生产加成。',art:'deep-space',sector:'暗物质补给'},
 achievements:{title:'记录你的开拓历程',detail:'从第一座矿场到星际扩张，让每一个里程碑留下印记。',art:'galaxy',sector:'开拓者档案'},
 messages:{title:'每一段航程，都有回响',detail:'出发、抵达、返航与侦察报告，都在这里按游戏时间记录。',art:'fleet',sector:'航行日志'},
 save:{title:'保存现在，继续探索',detail:'v8 单星球存档可迁移至 v9。升级前保留原件，导入失败不替换当前进度。',art:'orbital',sector:'存档与版本'}
};
export function heroMarkup():string{return `<aside class="command-hero" aria-label="当前指挥区域" style="--space-art:url('${artUrl('galaxy-banner')}')"><div class="hero-copy"><p class="hero-eyebrow">INFINITY <span>／ 无界航程</span></p><h2 id="hero-title"></h2><p id="hero-detail"></p><div class="hero-meta"><span id="hero-sector"></span><span id="hero-location"></span><span class="release-badge">v${GAME_VERSION}</span></div></div><img id="hero-image" class="hero-image" src="${artUrl('homeworld')}" alt="" aria-hidden="true" width="180" height="254" decoding="async" /></aside>`;}
/** Tab changes only; never reconstruct these nodes during live ticks. */
export function updateHero(root:ParentNode,tab:string):void {
 const scene=SCENES[tab]??SCENES.facilities!;
 for(const[id,v]of [['hero-title',scene.title],['hero-detail',scene.detail],['hero-sector',scene.sector]]){
  const el=root.querySelector(`#${id}`);if(el&&el.textContent!==v)el.textContent=v!;
 }
 const img=root.querySelector<HTMLImageElement>('#hero-image');
 if(img&&img.dataset.scene!==scene.art){const a=ART[scene.art];img.src=artUrl(scene.art);img.width=a.width;img.height=a.height;img.dataset.scene=scene.art;}
}

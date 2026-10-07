/** Presentation-only policies. Never reads or changes the simulation state. */
export const NAV_GROUPS = [
  { label: "经济", tabs: ["overview", "facilities", "research"] },
  { label: "军事", tabs: ["shipyard", "defense", "fleet"] },
  { label: "帝国", tabs: ["empire", "galaxy", "messages"] },
  { label: "自动化", tabs: ["protocol", "curvature", "arcade"] },
  { label: "系统", tabs: ["darkmatter", "achievements", "save"] },
] as const;
export const PAGE_META: Record<string, [string, string]> = {
  overview: ["行星概览", "查看当前星球的产出、能源和运行情况。"],
  facilities: ["行星建设", "建立产线，平衡能源，向下一个世界出发。"],
  research: ["研究网络", "选择技术，查看前置条件与下一步收益。"],
  shipyard: ["轨道船坞", "批次建造，逐艘交付。"],
  defense: ["防御设施", "建设行星防线；当前版本尚未开放战斗。"],
  fleet: ["舰队指挥", "配置任务与货物，确认航程后派遣。"],
  empire: ["帝国总览", "独立生产的世界，共同构成你的帝国。"],
  galaxy: ["银河导航", "选择一个世界，开启下一段航程。"],
  messages: ["航行日志", "出发、抵达与返航，一切有迹可循。"],
  protocol: ["协议控制台", "当触发器满足条件，就执行动作。"],
  curvature: ["曲率科技", "评估重置收益，规划下一次扩张。"],
  arcade: ["深空信标", "揭晓预掷结果，查看公开概率与奖励。"],
  darkmatter: ["暗物质补给", "把稀有资源用在关键之处。"],
  achievements: ["开拓者档案", "记录从第一座矿场开始的旅程。"],
  save: ["存档管理", "保留原件，安全迁移，继续探索。"],
};
export function stageFor(path: string): "trigger" | "condition" | "action" {
  if (path.startsWith("trigger.")) return "trigger";
  if (path.startsWith("action.")) return "action";
  return "condition";
}
export function matchesQuery(name: string, id: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || `${name} ${id}`.toLocaleLowerCase().includes(q);
}
/** Three schematic rings, five selectable positions each; not a physical scale. */
export function orbitalPoint(position: number): { x: number; y: number } {
  const p = Math.min(15, Math.max(1, Math.trunc(Number.isFinite(position) ? position : 1))) - 1;
  const ring = Math.floor(p / 5);
  const angle = (p % 5) * Math.PI * 2 / 5 - Math.PI / 2 + ring * 0.32;
  return { x: 50 + (15 + ring * 13) * Math.cos(angle), y: 50 + (14 + ring * 13) * Math.sin(angle) };
}
export function slotStatus(enabled: boolean, sentence: string, lamp: string): string {
  if (!sentence) return "空槽位";
  if (!enabled) return "已停用";
  return lamp === "green" ? "已执行" : lamp === "red" ? "执行受阻" : "等待条件";
}

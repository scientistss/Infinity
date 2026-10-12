import type { GameState } from "../game/types";

/** Detached display facts only: no saved jobs, prices, timers or action authority. */
export interface LabBlockerItem {
  readonly planetId: string;
  readonly planetName: string;
  readonly coordinates: string;
  readonly jobId: number;
  readonly kind: "upgrade" | "demolition";
  readonly targetLevel: number;
  /** One-based position in the actual building queue; demolition is independent. */
  readonly queuePosition: number | null;
  readonly status: "已付排队" | "已付 · 施工中";
  readonly text: string;
}

export interface LabBlockersModel {
  /** The headline counts affected planets, never the number of queued jobs. */
  readonly planetCount: number;
  readonly jobCount: number;
  readonly summary: string;
  readonly note: string;
  readonly items: readonly LabBlockerItem[];
}

/**
 * One empire traversal per visible research projection, never per technology.
 * buildQueue and demolition contain paid work. Unpaid plans/templates are not
 * blockers. Existing domain interlocks remain the only execution authority.
 */
export function labBlockers(state: GameState): LabBlockersModel {
  const items: LabBlockerItem[] = [];
  let planetCount = 0;
  for (const planet of state.planets) {
    const before = items.length;
    const { galaxy, system, position } = planet.coordinates;
    const coordinates = `[${galaxy}:${system}:${position}]`;
    for (let index = 0; index < planet.buildQueue.length; index++) {
      const job = planet.buildQueue[index]!;
      if (job.building !== "research_lab") continue;
      const queuePosition = index + 1;
      const status = index === 0 && job.totalSeconds > 0 ? "已付 · 施工中" : "已付排队";
      items.push({
        planetId: planet.id, planetName: planet.name, coordinates, jobId: job.jobId,
        kind: "upgrade", targetLevel: job.targetLevel, queuePosition, status,
        text: `${planet.name} ${coordinates} · 升级 → 等级 ${job.targetLevel} · 建造队列第 ${queuePosition} 位 · ${status} · 工作 #${job.jobId}`,
      });
    }
    const demolition = planet.demolition;
    if (demolition?.building === "research_lab") {
      items.push({
        planetId: planet.id, planetName: planet.name, coordinates, jobId: demolition.jobId,
        kind: "demolition", targetLevel: demolition.toLevel, queuePosition: null, status: "已付 · 施工中",
        text: `${planet.name} ${coordinates} · 拆除 → 等级 ${demolition.toLevel} · 独立拆除位 · 已付 · 施工中 · 工作 #${demolition.jobId}`,
      });
    }
    if (items.length > before) planetCount++;
  }
  return {
    planetCount, jobCount: items.length,
    summary: planetCount ? `研究受阻：${planetCount}处实验室施工` : "",
    note: planetCount ? `按星球计，共 ${items.length} 项已付工作（含排队）；以下仅列已付款的升级与拆除。` : "",
    items,
  };
}

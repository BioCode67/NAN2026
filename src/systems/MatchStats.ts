import { eventBus } from './EventBus';

/**
 * 한 판의 전적.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 지금까지 판이 끝나면 "승리!" 와 등수 한 줄이 전부였다. 네 명이 3분 동안
 * 치고받은 결과가 그 한 줄로 요약되면, 방금 무슨 일이 있었는지 남지 않는다.
 *
 * 특히 캐릭터가 스무 명인 게임에서는 **내가 뭘 했는지**가 다음 판의 선택을
 * 만든다. "이 캐릭터로 3,400을 넣었네"와 "가장 많이 쓴 건 강제 종료였네"는
 * 둘 다 다음에 누구를 고를지에 영향을 준다. 그 정보가 없으면 스무 명이
 * 그냥 스무 개의 이름으로 남는다.
 *
 * ── 왜 별도 시스템인가 ────────────────────────────────────────────
 * 전투 로직 안에서 세면 계산 코드 사이에 집계 코드가 섞인다. 이미 모든
 * 사건이 EventBus로 흐르고 있으므로, 여기서는 **듣기만** 한다.
 * 이 파일을 통째로 지워도 게임은 똑같이 돌아간다.
 */

export interface FighterStat {
  /** 상대에게 넣은 주가 총합 */
  dealt: number;
  /** 맞은 총합 */
  taken: number;
  /** 상장폐지시킨 수 */
  kos: number;
  /** 이 판에서 찍은 최고 주가 */
  peakStock: number;
  /** 한 방으로 넣은 최대치 */
  bestHit: number;
  /** 그 한 방의 이름 */
  bestHitName: string;
  /** 맞힌 횟수 */
  hits: number;
  /** 기술별 적중 횟수 */
  byMove: Map<string, number>;
}

const blank = (): FighterStat => ({
  dealt: 0,
  taken: 0,
  kos: 0,
  peakStock: 100,
  bestHit: 0,
  bestHitName: '',
  hits: 0,
  byMove: new Map(),
});

export class MatchStats {
  private readonly rows = new Map<string, FighterStat>();
  private readonly disposers: Array<() => void> = [];
  /** 이 판에서 발동한 프롬프트 기믹 수 */
  private gimmickCount = 0;

  constructor() {
    this.disposers.push(
      eventBus.on('combat:hit', (p) => {
        const a = this.row(p.attackerId);
        const t = this.row(p.targetId);

        a.dealt += p.damage;
        a.hits += 1;
        t.taken += p.damage;

        if (p.damage > a.bestHit) {
          a.bestHit = p.damage;
          a.bestHitName = p.moveName;
        }
        a.byMove.set(p.moveName, (a.byMove.get(p.moveName) ?? 0) + 1);
      }),

      eventBus.on('stock:changed', (p) => {
        const r = this.row(p.fighterId);
        if (p.value > r.peakStock) r.peakStock = p.value;
      }),

      eventBus.on('fighter:ko', (p) => {
        if (p.killerId) this.row(p.killerId).kos += 1;
      }),
    );
  }

  /** 프롬프트 기믹이 하나 발동했다 */
  countGimmick(): void {
    this.gimmickCount += 1;
  }

  get gimmicks(): number {
    return this.gimmickCount;
  }

  get(id: string): FighterStat {
    return this.row(id);
  }

  /** 이 파이터가 가장 많이 맞힌 기술 — 동률이면 먼저 쓴 쪽 */
  favouriteMove(id: string): { name: string; count: number } | null {
    const r = this.row(id);
    let best: { name: string; count: number } | null = null;
    for (const [name, count] of r.byMove) {
      if (!best || count > best.count) best = { name, count };
    }
    return best;
  }

  /** 이 판에서 가장 많이 때린 사람 */
  topDealer(): { id: string; dealt: number } | null {
    let best: { id: string; dealt: number } | null = null;
    for (const [id, r] of this.rows) {
      if (!best || r.dealt > best.dealt) best = { id, dealt: r.dealt };
    }
    return best;
  }

  destroy(): void {
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
  }

  private row(id: string): FighterStat {
    let r = this.rows.get(id);
    if (!r) {
      r = blank();
      this.rows.set(id, r);
    }
    return r;
  }
}

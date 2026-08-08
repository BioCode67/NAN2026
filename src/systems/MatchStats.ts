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

/** 이 판에서 누가 무슨 문장을 썼고, 그것이 무엇이 되었는가 */
export interface PromptEntry {
  /** 사람이 실제로 친 문장 */
  text: string;
  /** 누가 썼는가 */
  who: string;
  /** 그 문장이 걸어 낸 기믹 이름 */
  gimmick: string;
  /** 기믹 아이콘 */
  icon: string;
  /** 기믹 색 */
  color: number;
}

export class MatchStats {
  private readonly rows = new Map<string, FighterStat>();
  private readonly disposers: Array<() => void> = [];
  /**
   * 이 판에 입력된 문장들.
   *
   * ── 왜 세는 것으로 끝내지 않는가 ────────────────────────────────
   * "프롬프트 3회"는 아무 기억도 만들지 않는다. 이 게임에서 판을 뒤집는
   * 것은 횟수가 아니라 **누가 뭐라고 썼는가**다 — "중력을 없애줘" 한 줄로
   * 넷이 다 같이 떠오른 장면이 이 게임의 전부이고, 그 문장은 사람이
   * 그 자리에서 지어낸 것이라 두 번 다시 같은 것이 나오지 않는다.
   * 판이 끝날 때 그 문장들을 그대로 되돌려 주면, 방금 있었던 일이
   * 남는다.
   */
  private readonly promptLog: PromptEntry[] = [];

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

  /** 문장 하나가 기믹이 되었다 */
  logPrompt(entry: PromptEntry): void {
    this.promptLog.push(entry);
  }

  /** 입력된 순서 그대로 */
  get prompts(): readonly PromptEntry[] {
    return this.promptLog;
  }

  get gimmicks(): number {
    return this.promptLog.length;
  }

  get(id: string): FighterStat {
    return this.row(id);
  }

  /**
   * 호스트가 판 끝에 보낸 전적을 통째로 덮어쓴다 (참가자 화면).
   *
   * 참가자 쪽에는 combat:hit 이벤트가 흐르지 않아 전적이 전부 0 이었다 —
   * 3분을 치고받고 "한 대도 못 맞혔다"가 뜨는 표. 스스로 세는 대신
   * 호스트가 센 것을 받는다. peakStock 은 stock:changed 로 이쪽에서도
   * 맞게 세고 있으므로 건드리지 않는다.
   */
  injectRemote(
    id: string,
    r: { dealt: number; taken: number; kos: number; hits: number; bestHit: number; bestHitName: string },
  ): void {
    const row = this.row(id);
    row.dealt = r.dealt;
    row.taken = r.taken;
    row.kos = r.kos;
    row.hits = r.hits;
    row.bestHit = r.bestHit;
    row.bestHitName = r.bestHitName;
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

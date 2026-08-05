import Phaser from 'phaser';
import { STOCK, TIER_LIST } from '../config/gameConfig';
import { StockTier } from '../types';
import type { CharacterConfig } from '../types';
import type { BaseCharacter } from '../characters/BaseCharacter';
import type { EventBus } from './EventBus';

/** 타격 1회의 주가 정산 결과 */
export interface StockTransfer {
  /** 피격자가 실제로 잃은 주가(%) */
  damage: number;
  /** 공격자가 실제로 흡수한 주가(%) */
  absorbed: number;
  /** 흡수 배율이 1을 넘겨 패시브가 발동했는가 */
  passiveTriggered: boolean;
}

/**
 * 주가(%) 시스템.
 *
 * 게임의 체력이자 공격력이며, 승패 조건이다.
 *  - 모든 캐릭터는 100%로 시작
 *  - 타격 성공 시 공격자 상승 / 피격자 하락
 *  - 0% 도달 → 상장폐지(KO), 300% 도달 → 상한가
 *
 * 숫자 계산만 담당하고, 연출은 이벤트를 듣는 쪽이 처리한다.
 */
export class StockSystem {
  private readonly fighters = new Map<string, BaseCharacter>();
  private readonly values = new Map<string, number>();
  private readonly tiers = new Map<string, StockTier>();

  constructor(private readonly bus: EventBus) {}

  /** 파이터 등록 — 시작 주가 100%로 초기화한다 */
  register(fighter: BaseCharacter): void {
    this.fighters.set(fighter.fighterId, fighter);
    this.values.set(fighter.fighterId, STOCK.START);
    this.tiers.set(fighter.fighterId, this.computeTier(STOCK.START));

    fighter.updateGauge(STOCK.START, StockTier.NORMAL);
    fighter.applyTier(StockTier.NORMAL);
    fighter.setPassiveMultiplier(
      this.computePassiveMultiplier(fighter.cfg, STOCK.START),
    );
  }

  /** 현재 주가(%) */
  get(fighterId: string): number {
    return this.values.get(fighterId) ?? STOCK.START;
  }

  /** 현재 떡상 등급 */
  getTier(fighterId: string): StockTier {
    return this.tiers.get(fighterId) ?? StockTier.NORMAL;
  }

  /**
   * 타격 성공 시 주가를 정산한다.
   *
   * - 피격자는 `기본 피해량 × 공격자 공격력 배율`만큼 잃는다.
   * - 공격자는 그 피해량에 자신의 흡수 배율을 곱한 만큼 얻는다.
   *   (기본 배율 1.0 = 명세의 "공격자 +10%, 피격자 -10%")
   */
  applyHit(
    attacker: BaseCharacter,
    target: BaseCharacter,
    baseDamage: number,
  ): StockTransfer {
    // 떡상 등급 배율 × 패시브 배율(변동성 폭발 / 오픈소스)
    const damage = Math.max(
      1,
      Math.round(baseDamage * attacker.getDamageMultiplier()),
    );

    // 아이템(레버리지 등)이 흡수량을 더 얹어준다
    const ratio = this.rollAbsorbRatio(attacker.cfg) + attacker.getAbsorbBonus();
    const absorbed = Math.round(damage * ratio);

    this.setValue(target.fighterId, this.get(target.fighterId) - damage, attacker.fighterId);
    this.setValue(attacker.fighterId, this.get(attacker.fighterId) + absorbed, null);

    return { damage, absorbed, passiveTriggered: ratio > 1 };
  }

  /** 주가 직접 증감 (지속 피해, 도박 스킬 등) */
  add(fighterId: string, delta: number, sourceId: string | null = null): void {
    this.setValue(fighterId, this.get(fighterId) + delta, sourceId);
  }

  /** 장외 추락 등으로 즉시 상장폐지 처리 */
  forceDelist(fighterId: string, killerId: string | null = null): void {
    this.setValue(fighterId, STOCK.MIN, killerId);
  }

  /* ================================================================ */
  /* 내부 계산                                                        */
  /* ================================================================ */

  /** 주가를 확정하고 관련 이벤트를 발행한다 */
  private setValue(
    fighterId: string,
    next: number,
    sourceId: string | null,
  ): void {
    const fighter = this.fighters.get(fighterId);
    if (!fighter || !fighter.alive) return;

    const prev = this.get(fighterId);
    const value = Phaser.Math.Clamp(Math.round(next), STOCK.MIN, STOCK.MAX);
    if (value === prev) return;

    this.values.set(fighterId, value);

    const prevTier = this.getTier(fighterId);
    const tier = this.computeTier(value);

    fighter.updateGauge(value, tier);
    fighter.setPassiveMultiplier(
      this.computePassiveMultiplier(fighter.cfg, value),
    );

    this.bus.emit('stock:changed', {
      fighterId,
      value,
      delta: value - prev,
      tier,
    });

    if (tier !== prevTier) {
      this.tiers.set(fighterId, tier);
      fighter.applyTier(tier);
      this.bus.emit('stock:tier', { fighterId, tier, prevTier });
    }

    // 0% 도달 → 상장폐지
    if (value <= STOCK.MIN) {
      this.bus.emit('fighter:ko', {
        fighterId,
        name: fighter.cfg.name,
        killerId: sourceId,
      });
    }
  }

  /** 주가 → 떡상 등급 */
  private computeTier(value: number): StockTier {
    // TIER_LIST는 min 내림차순이므로 처음 만족하는 등급이 정답이다.
    for (const t of TIER_LIST) {
      if (value >= t.min) return t.tier;
    }
    return StockTier.DELISTED;
  }

  /** 캐릭터 패시브에 따른 흡수 배율을 굴린다 */
  private rollAbsorbRatio(cfg: CharacterConfig): number {
    const p = cfg.passive;
    switch (p.type) {
      // 빌 게이츠맨 — 독점 흡수 (항상 1.5배)
      case 'absorb_flat':
        return p.absorbRatio ?? 1;

      // 스티브 잡스맨 — 현실 왜곡 (30% 확률로 2배)
      case 'absorb_chance':
        return Phaser.Math.FloatBetween(0, 1) < (p.chance ?? 0)
          ? (p.absorbRatio ?? 1)
          : 1;

      // 패니 와이즈맨 — 밈 파워 (1.0~3.0배 랜덤)
      case 'absorb_random':
        return Phaser.Math.FloatBetween(p.minRatio ?? 1, p.maxRatio ?? 1);

      // 공격력 계열 패시브는 흡수량에 관여하지 않는다
      default:
        return 1;
    }
  }

  /** 주가 조건형 패시브(변동성 폭발 / 오픈소스)의 공격력 배율 */
  private computePassiveMultiplier(
    cfg: CharacterConfig,
    value: number,
  ): number {
    const p = cfg.passive;

    // 일론 머스크맨 — 200% 이상이면 공격력 2배
    if (p.type === 'power_when_high') {
      return value >= (p.threshold ?? Number.POSITIVE_INFINITY)
        ? (p.powerMul ?? 1)
        : 1;
    }

    // 리누스 토발즈맨 — 50% 이하면 공격력 1.5배
    if (p.type === 'power_when_low') {
      return value <= (p.threshold ?? Number.NEGATIVE_INFINITY)
        ? (p.powerMul ?? 1)
        : 1;
    }

    return 1;
  }

  /** 씬 종료 시 정리 */
  reset(): void {
    this.fighters.clear();
    this.values.clear();
    this.tiers.clear();
  }
}

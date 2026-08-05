import Phaser from 'phaser';
import { STAGE } from '../config/gameConfig';
import type { AIDifficulty, AIState } from '../types';
import type { BaseCharacter } from '../characters/BaseCharacter';

/** AI가 씬에 위임하는 동작 */
export interface AIActions {
  /** 시그니처 스킬 시전 (부가 효과 처리 포함, 성공 시 true) */
  castSkill: (fighter: BaseCharacter) => boolean;
}

/** 낭떠러지로 판단하는 가장자리 여유 */
const LEDGE_MARGIN = 60;

/**
 * AI 봇 — 유한상태기계(FSM).
 *
 * IDLE → 대기 / CHASE → 추적 / ATTACK → 공격 / EVADE → 회피 / SKILL → 스킬
 *
 * 난이도는 "판단 주기 + 반응 지연 + 회피 확률"로 조절한다.
 * 상태 판단은 decisionInterval마다, 실제 전환은 reactionDelay 뒤에 일어나므로
 * 사람처럼 한 박자 늦게 반응한다.
 */
export class AISystem {
  private state: AIState = 'IDLE';
  private pendingState: AIState = 'IDLE';

  private decisionTimer = 0;
  private reactionTimer = 0;
  /** 연속 공격 방지용 쿨다운 */
  private attackCooldown = 0;

  constructor(
    private readonly self: BaseCharacter,
    private readonly getTarget: () => BaseCharacter | null,
    private readonly difficulty: AIDifficulty,
    private readonly actions: AIActions,
  ) {}

  /** 현재 상태 (디버그 표시용) */
  getState(): AIState {
    return this.state;
  }

  update(_time: number, delta: number): void {
    if (!this.self.alive) return;

    this.decisionTimer -= delta;
    this.reactionTimer -= delta;
    this.attackCooldown -= delta;

    const target = this.getTarget();
    if (!target || !target.alive) {
      this.state = 'IDLE';
      this.self.moveHorizontal(0);
      return;
    }

    /* 낭떠러지 복귀는 FSM보다 우선한다 — 자멸 방지 */
    if (this.recoverFromLedge()) return;

    /* 판단 주기마다 목표 상태를 다시 계산한다 */
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.difficulty.decisionInterval;
      const next = this.decideState(target);
      if (next !== this.pendingState) {
        this.pendingState = next;
        // 회피/스킬처럼 즉각적인 판단은 지연을 절반만 준다
        const urgent = next === 'EVADE' || next === 'SKILL';
        this.reactionTimer = this.difficulty.reactionDelay * (urgent ? 0.5 : 1);
      }
    }

    /* 반응 지연이 끝나면 실제로 상태를 바꾼다 */
    if (this.reactionTimer <= 0 && this.state !== this.pendingState) {
      this.state = this.pendingState;
    }

    this.act(target);
  }

  /* ================================================================ */
  /* 상태 판단                                                        */
  /* ================================================================ */

  private decideState(target: BaseCharacter): AIState {
    const dist = Math.abs(target.x - this.self.x);
    const skill = this.self.cfg.skill;
    // 투사체 스킬은 멀리서도 쓸 수 있다
    const skillRange = skill.projectile ? 520 : skill.range;
    const reach = this.self.cfg.heavy.range;

    // 상대가 공격 모션에 들어갔고 사거리 안이면 회피를 시도한다
    if (
      target.isAttacking() &&
      dist < 150 &&
      Phaser.Math.FloatBetween(0, 1) < this.difficulty.evadeChance
    ) {
      return 'EVADE';
    }

    // 스킬이 준비됐고 사거리에 들어오면 최우선으로 지른다
    if (this.self.isSkillReady() && dist < skillRange + 40) {
      return 'SKILL';
    }

    // 근접 사거리면 공격
    if (dist < reach + 40) {
      return 'ATTACK';
    }

    // 너무 멀면 추적
    if (dist > this.self.cfg.light.range) {
      return 'CHASE';
    }

    return 'IDLE';
  }

  /* ================================================================ */
  /* 상태별 행동                                                      */
  /* ================================================================ */

  private act(target: BaseCharacter): void {
    const dx = target.x - this.self.x;
    const dy = target.y - this.self.y;
    const dist = Math.abs(dx);
    const dir: -1 | 1 = dx >= 0 ? 1 : -1;

    switch (this.state) {
      case 'CHASE': {
        this.self.moveHorizontal(dir);
        // 상대가 위에 있으면 따라 올라간다
        if (dy < -70 && dist < 200) this.self.jump();
        break;
      }

      case 'ATTACK': {
        // 사거리를 유지하며 미세 조정
        if (dist > this.self.cfg.heavy.range) this.self.moveHorizontal(dir);
        else this.self.moveHorizontal(0);

        if (this.attackCooldown <= 0) {
          const useHeavy =
            Phaser.Math.FloatBetween(0, 1) < this.difficulty.heavyRatio;
          const ok = this.self.attack(useHeavy ? 'heavy' : 'light');
          if (ok) {
            // 캐릭터마다 딜레이가 다르므로 자기 공격 데이터로 계산한다
            const atk = useHeavy ? this.self.cfg.heavy : this.self.cfg.light;
            this.attackCooldown =
              atk.startup +
              atk.active +
              atk.recovery +
              this.difficulty.attackCooldown;
          }
        }
        break;
      }

      case 'EVADE': {
        // 반대 방향으로 물러나되 낭떠러지로는 가지 않는다
        const away: -1 | 1 = (dir * -1) as -1 | 1;
        if (this.canStepTo(away)) this.self.moveHorizontal(away);
        else this.self.jump();
        break;
      }

      case 'SKILL': {
        if (this.actions.castSkill(this.self)) {
          this.state = 'CHASE';
          this.pendingState = 'CHASE';
          this.attackCooldown = this.difficulty.attackCooldown;
        } else {
          // 쿨다운 등으로 실패하면 추적으로 되돌린다
          this.state = 'CHASE';
          this.pendingState = 'CHASE';
        }
        break;
      }

      case 'IDLE':
      default: {
        this.self.moveHorizontal(0);
        break;
      }
    }
  }

  /* ================================================================ */
  /* 생존 로직                                                        */
  /* ================================================================ */

  /**
   * 스테이지 밖으로 밀려났으면 중앙으로 복귀한다.
   * @returns 복귀 동작을 수행했으면 true (이번 프레임 FSM은 건너뛴다)
   */
  private recoverFromLedge(): boolean {
    const center = (STAGE.LEFT + STAGE.RIGHT) / 2;
    const outLeft = this.self.x < STAGE.LEFT + LEDGE_MARGIN;
    const outRight = this.self.x > STAGE.RIGHT - LEDGE_MARGIN;
    if (!outLeft && !outRight) return false;

    const dir: -1 | 1 = this.self.x < center ? 1 : -1;
    this.self.moveHorizontal(dir);

    // 지면보다 아래로 떨어졌으면 점프로 복귀 시도
    if (this.self.y > STAGE.GROUND_Y - 20) this.self.jump();

    return true;
  }

  /** 해당 방향으로 이동해도 스테이지를 벗어나지 않는가 */
  private canStepTo(dir: -1 | 1): boolean {
    const next = this.self.x + dir * 90;
    return next > STAGE.LEFT + LEDGE_MARGIN && next < STAGE.RIGHT - LEDGE_MARGIN;
  }
}

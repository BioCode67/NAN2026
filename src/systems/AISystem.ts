import Phaser from 'phaser';
import { STAGE } from '../config/gameConfig';
import type { AIDifficulty, AIState, AttackDir } from '../types';
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

  /**
   * 연속기를 이어치기 위해 남겨둔 추가 입력 횟수.
   *
   * 봇도 몰아쳐야 연속기가 "내가 쓰는 기능"이 아니라
   * "이 게임의 전투 방식"으로 읽힌다.
   */
  private chainLeft = 0;
  private chainIntent: 'light' | 'heavy' = 'light';

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
    const skill = this.self.cfg.moves.skill;
    // 투사체 스킬은 멀리서도 쓸 수 있다
    const skillRange = skill.projectile ? 520 : skill.range;
    const reach = this.self.cfg.moves.heavy.range;

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
    if (dist > this.self.cfg.moves.light.range) {
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
        if (dist > this.self.cfg.moves.heavy.range) this.self.moveHorizontal(dir);
        else this.self.moveHorizontal(0);

        if (this.attackCooldown <= 0) this.swing(dy);
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

  /**
   * 한 번 친다.
   *
   * 연속기를 시작했으면 같은 버튼을 몇 번 더 눌러 이어친다.
   * 링크마다 정확한 타이밍을 계산하지는 않는다 — 판정 중에 누르면 선입력으로
   * 쌓이고, 끝난 직후에 누르면 여운으로 이어지므로 대충 눌러도 성립한다.
   */
  private swing(dy: number): void {
    /* 이어치는 중이면 방향을 섞지 않는다 (방향키가 들어가면 연속기가 끊긴다) */
    if (this.chainLeft > 0) {
      this.chainLeft--;
      if (this.self.attack(this.chainIntent, 'neutral')) {
        this.attackCooldown = 190;
        return;
      }
      // 경직 등으로 실패하면 연속기를 포기한다
      this.chainLeft = 0;
    }

    const intent: 'light' | 'heavy' =
      Phaser.Math.FloatBetween(0, 1) < this.difficulty.heavyRatio
        ? 'heavy'
        : 'light';
    const atkDir = this.pickAttackDir(dy);

    // 실제로 나갈 기술을 먼저 물어봐야 딜레이를 정확히 잴 수 있다
    const atk = this.self.resolveMove(intent, atkDir);
    if (!this.self.attack(intent, atkDir)) return;

    /* 항상 이어치지는 않는다 — 늘 3타가 나오면 읽히고 지겹다 */
    if (atk.chain && Phaser.Math.FloatBetween(0, 1) < 0.65) {
      this.chainIntent = intent;
      this.chainLeft = 2;
      // 판정이 도는 동안 다음 입력을 넣어 선입력으로 쌓는다
      this.attackCooldown = atk.startup + 40;
      return;
    }

    this.chainLeft = 0;
    this.attackCooldown =
      atk.startup + atk.active + atk.recovery + this.difficulty.attackCooldown;
  }

  /**
   * 공격 방향을 고른다.
   *
   * 봇이 중립기만 계속 내면 커맨드 무브를 만든 의미가 플레이어 쪽에만 남는다.
   * 상대 높이를 보고 상단기·하단기를 섞어, 맞는 쪽에서도 기술 종류가 느껴지게 한다.
   *
   * @param dy 상대 Y - 자기 Y (음수면 상대가 위에 있다)
   */
  private pickAttackDir(dy: number): AttackDir {
    const onGround =
      this.self.body.blocked.down || this.self.body.touching.down;

    // 공중에서 상대가 아래에 있으면 급강하 찍기로 마무리를 노린다
    if (!onGround) return dy > 40 ? 'down' : 'neutral';

    // 상대가 머리 위에 있으면 상단기로 쳐올린다
    if (dy < -70) return 'up';

    // 그 외에는 중립기 위주로 두고 가끔 하단기를 섞는다
    const roll = Phaser.Math.FloatBetween(0, 1);
    if (roll < 0.22) return 'down';
    if (roll < 0.34) return 'up';
    return 'neutral';
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

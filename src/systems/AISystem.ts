import Phaser from 'phaser';
import { personaFor, shouldCastSkill } from '../config/aiPersona';
import { FIGHTER, STAGE } from '../config/gameConfig';
import type { AiPersona } from '../config/aiPersona';
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

  /** 이 캐릭터를 어떻게 쓰는가 — 고유 메커니즘에서 따온다 */
  private readonly persona: AiPersona;
  /** 스킬이 준비된 시각. "얼마나 참았나"를 재는 데 쓴다 */
  private skillReadySince = -1;
  /** 이 시각까지 방어를 유지한다 (0이면 방어 중이 아니다) */
  private guardUntil = 0;
  /** 잡혔을 때 마지막으로 몸부림친 시각 */
  private lastMashAt = 0;
  /** 붙잡은 뒤 던지기 전까지 툭툭 칠 횟수 */
  private pummelsLeft = 0;
  /** 다음 잡기를 시도할 수 있는 시각 — 계속 잡으러만 오면 읽힌다 */
  private grabTryAt = 0;
  /** 이 시각까지 강공격 버튼을 붙잡고 모은다 (표준 기질) */
  private chargeUntil = 0;

  constructor(
    private readonly self: BaseCharacter,
    private readonly getTarget: () => BaseCharacter | null,
    private readonly difficulty: AIDifficulty,
    private readonly actions: AIActions,
  ) {
    this.persona = personaFor(self.cfg.signature.id);
  }

  /** 이 봇이 따르는 성격 (테스트·디버그용) */
  getPersona(): AiPersona {
    return this.persona;
  }

  /** 현재 상태 (디버그 표시용) */
  getState(): AIState {
    return this.state;
  }

  update(time: number, delta: number): void {
    if (!this.self.alive) return;

    /* 잡기 관련 상태는 FSM보다 먼저 처리한다 — 다른 행동이 불가능하다 */
    if (this.tickGrab(time)) return;

    this.decisionTimer -= delta;
    this.reactionTimer -= delta;
    this.attackCooldown -= delta;

    this.trackSkillReady(time);

    const target = this.getTarget();
    if (!target || !target.alive) {
      this.state = 'IDLE';
      this.releaseGuard();
      this.self.moveHorizontal(0);
      return;
    }

    /* 낭떠러지 복귀는 FSM보다 우선한다 — 자멸 방지 */
    if (this.recoverFromLedge()) return;

    /* 판단 주기마다 목표 상태를 다시 계산한다 */
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.difficulty.decisionInterval;
      const next = this.decideState(target, time);
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

    this.tickTrait(target, time);
    this.act(target, time);
  }

  /* ================================================================ */
  /* 기질 전용기                                                       */
  /* ================================================================ */

  /**
   * 봇이 **자기 기질로만 되는 것**을 쓴다.
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────────
   * 전용기를 만들어도 봇이 안 쓰면 절반만 존재한다. 사람은 스무 명 중 한 명을
   * 고르고 나머지 열아홉은 **상대로만** 만나기 때문이다. 봇이 전부 똑같이
   * 걸어와 똑같이 때리면, 맞는 쪽에서는 이름과 색만 다른 하나를 스무 번
   * 상대하는 셈이 된다 — 캐릭터를 알아 갈 계기가 아예 안 생긴다.
   *
   * 반대로 활공하는 봇이 머리 위에 떠 있다가 내리꽂으면, 그걸 맞아 본
   * 사람은 그 캐릭터를 골라 보고 싶어진다. 전용기는 여기서 처음으로
   * "구경거리"가 된다.
   *
   * 벽 차기·급강하는 봇이 따로 누를 것이 없다(밀리면 알아서 차고, 떨어지면
   * 알아서 무거워진다). 손이 필요한 것은 활공·표류·표준 셋이다.
   */
  private tickTrait(target: BaseCharacter, time: number): void {
    const onGround =
      this.self.body.blocked.down || this.self.body.touching.down;
    const dx = target.x - this.self.x;
    const dy = target.y - this.self.y;

    switch (this.self.trait) {
      case 'glide': {
        /*
         * 떠 있는 동안 점프를 누른 채로 버티다가, 상대 머리 위에 오면 놓는다.
         *
         * 가로로 멀 때 활공을 유지하는 것이 핵심이다 — 그래야 "따라오다가
         * 위에서 떨어진다"는 그림이 나온다. 붙었을 때까지 활공하면 그냥
         * 느리게 내려오는 봇이 된다.
         */
        if (onGround) {
          this.self.setJumpHeld(false);
          break;
        }
        const above = dy > 30 && Math.abs(dx) < 90;
        this.self.setJumpHeld(!above);
        // 머리 위에 왔다 — 활공을 끊고 내리꽂는다
        if (above && this.attackCooldown <= 0) {
          this.self.setJumpHeld(true);
          if (this.self.attack('heavy', 'down')) {
            this.attackCooldown = this.difficulty.attackCooldown;
          }
          this.self.setJumpHeld(false);
        }
        break;
      }

      case 'drift': {
        // 자원이 안 드는 공중 대시 — 멀면 한 번 써서 거리를 지운다
        if (!onGround && Math.abs(dx) > 200) {
          this.self.dash(dx >= 0 ? 1 : -1);
        }
        break;
      }

      case 'plain':
        /*
         * 모으기로 정한 동안만 버튼을 붙잡는다.
         *
         * 매번 모으면 읽히고 한 번도 안 모으면 기질이 없는 것과 같다.
         * 낼 때 주사위를 굴려 정하므로(swing 참조) 여기서는 그 시각까지
         * 손을 떼지 않는 일만 한다.
         */
        this.self.setHeavyHeld(time < this.chargeUntil);
        break;

      default:
        break;
    }
  }

  /**
   * 잡기 상태 처리.
   *
   * @returns 이번 프레임 FSM을 건너뛰어야 하면 true
   */
  private tickGrab(time: number): boolean {
    /* 잡혔다 — 몸부림친다 */
    if (this.self.isGrabbed()) {
      /*
       * 사람처럼 두드린다.
       *
       * 매 프레임 부르면 최소 간격(55ms)마다 인정돼 봇이 거의 언제나
       * 던져지기 전에 빠져나간다. 잡기가 봇 상대로는 무의미해진다는 뜻이다.
       * 반응 속도에 맞춰 두드리게 하면, 연승으로 봇이 빨라질수록
       * 잡고 던질 여유가 줄어든다 — 난이도가 잡기에도 걸린다.
       */
      const gap = Math.max(120, this.difficulty.reactionDelay * 0.85);
      if (time - this.lastMashAt >= gap) {
        this.lastMashAt = time;
        this.self.struggle();
      }
      return true;
    }

    /* 잡았다 — 툭툭 치다가 던진다 */
    if (this.self.isGrabbing()) {
      if (this.pummelsLeft > 0) {
        if (this.self.pummel()) this.pummelsLeft--;
        return true;
      }
      /*
       * 던지는 방향을 고른다.
       * 낭떠러지가 등 뒤면 뒤로 메쳐 밖으로 넘기고, 아니면 위로 띄워
       * 쫓아 올라간다 — 봇도 공중 연속기를 시도한다.
       */
      const toEdge = Math.min(
        Math.abs(this.self.x - STAGE.LEFT),
        Math.abs(this.self.x - STAGE.RIGHT),
      );
      this.self.throwGrabbed(toEdge < 240 ? 'back' : 'up');
      return true;
    }

    // 잡기 모션(선딜·헛친 후딜) 중에는 아무것도 못 한다
    return this.self.isGrabActive();
  }

  /**
   * 스킬이 준비된 채로 얼마나 흘렀는지 잰다.
   *
   * "지분 4개까지 참는다" 같은 성격은 조건이 영영 안 맞을 수 있다.
   * 얼마나 참았는지를 알아야 적당한 선에서 포기하고 지를 수 있다.
   */
  private trackSkillReady(time: number): void {
    if (!this.self.isSkillReady()) {
      this.skillReadySince = -1;
      return;
    }
    if (this.skillReadySince < 0) this.skillReadySince = time;
  }

  /** 방어를 푼다 (공격·이동 전에 반드시 거친다) */
  private releaseGuard(): void {
    if (this.guardUntil === 0) return;
    this.guardUntil = 0;
    this.self.setGuard(false);
  }

  /* ================================================================ */
  /* 상태 판단                                                        */
  /* ================================================================ */

  private decideState(target: BaseCharacter, time: number): AIState {
    const dist = Math.abs(target.x - this.self.x);
    const skill = this.self.cfg.moves.skill;
    // 투사체 스킬은 멀리서도 쓸 수 있다
    const skillRange = skill.projectile ? 520 : skill.range;
    const reach = this.self.cfg.moves.heavy.range;

    /*
     * 상대가 공격 모션에 들어갔고 사거리 안이면 피하거나 막는다.
     * 잃을 것이 있는 캐릭터(풍선·지분)는 더 자주 반응한다.
     */
    const loaded = this.self.getSignatureStacks() > 0;
    const evadeChance =
      this.difficulty.evadeChance * (loaded ? this.persona.evadeMulWhenLoaded : 1);

    if (
      target.isAttacking() &&
      dist < 150 &&
      Phaser.Math.FloatBetween(0, 1) < evadeChance
    ) {
      return 'EVADE';
    }

    /*
     * 스킬 판단은 캐릭터마다 다르다.
     * 게이츠는 지분을 모으고, 리누스는 훔친 기술이 생겨야 하고,
     * 잡스는 후속 입력 창이 열리면 쿨다운과 무관하게 지른다.
     */
    if (
      shouldCastSkill(this.persona, {
        ready: this.self.isSkillReady(),
        stacks: this.self.getSignatureStacks(),
        windowOpen: this.self.isSignatureWindowOpen(),
        readyForMs: this.skillReadySince < 0 ? 0 : time - this.skillReadySince,
        inRange: dist < skillRange + 40,
      })
    ) {
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

  private act(target: BaseCharacter, time: number): void {
    const dx = target.x - this.self.x;
    const dy = target.y - this.self.y;
    const dist = Math.abs(dx);
    const dir: -1 | 1 = dx >= 0 ? 1 : -1;

    /* 방어 중이면 시간이 끝날 때까지 그대로 버틴다 */
    if (this.guardUntil > 0) {
      if (time < this.guardUntil) {
        this.self.moveHorizontal(0);
        this.self.setGuard(true);
        return;
      }
      this.releaseGuard();
    }

    switch (this.state) {
      case 'CHASE': {
        this.self.moveHorizontal(dir);
        // 상대가 위에 있으면 따라 올라간다
        if (dy < -70 && dist < 200) this.self.jump();
        // 부스터를 가진 캐릭터는 공중에서도 대시로 거리를 좁힌다
        if (this.persona.useAirDash && dist > 220) this.self.dash(dir);
        break;
      }

      case 'ATTACK': {
        // 사거리를 유지하며 미세 조정
        if (dist > this.self.cfg.moves.heavy.range) this.self.moveHorizontal(dir);
        else this.self.moveHorizontal(0);

        if (this.attackCooldown <= 0) {
          // 막고 선 상대는 때려서 못 뚫는다 — 잡아야 한다
          if (!this.tryGrab(target, time)) {
            this.swing(dy, Math.abs(target.x - this.self.x), time);
          }
        }
        break;
      }

      case 'EVADE': {
        /*
         * 막을 것인가 피할 것인가.
         *
         * 리누스에게 방어는 회피가 아니라 공격 준비다 — 막아야 기술을 훔친다.
         * 그래서 성격표의 확률로 갈라, 이 캐릭터만 자주 받아내게 한다.
         */
        if (Phaser.Math.FloatBetween(0, 1) < this.persona.guardChance) {
          this.guardUntil = time + this.persona.guardMs;
          this.self.moveHorizontal(0);
          this.self.setGuard(true);
          break;
        }

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
   * 잡으러 갈 것인가.
   *
   * 막고 선 상대에게는 거의 항상 간다 — 봇이 가드를 못 뚫고 앞에서
   * 헛스윙만 하면 플레이어는 "웅크리고 있으면 안전하다"를 배운다.
   * 그 외에는 가끔만 섞는다. 계속 잡으러 오면 읽히고, 헛치면 크게 손해다.
   */
  private tryGrab(target: BaseCharacter, time: number): boolean {
    if (time < this.grabTryAt) return false;

    const dist = Math.abs(target.x - this.self.x);
    if (dist > FIGHTER.GRAB_RANGE + 34) return false;

    const chance = target.isGuarding() ? 0.8 : 0.12;
    if (Phaser.Math.FloatBetween(0, 1) >= chance) return false;
    if (!this.self.grab()) return false;

    this.pummelsLeft = 2;
    this.grabTryAt = time + 1600;
    this.attackCooldown = FIGHTER.GRAB_STARTUP + FIGHTER.GRAB_ACTIVE + 220;
    return true;
  }

  /**
   * 한 번 친다.
   *
   * 연속기를 시작했으면 같은 버튼을 몇 번 더 눌러 이어친다.
   * 링크마다 정확한 타이밍을 계산하지는 않는다 — 판정 중에 누르면 선입력으로
   * 쌓이고, 끝난 직후에 누르면 여운으로 이어지므로 대충 눌러도 성립한다.
   */
  private swing(dy: number, gap: number, time: number): void {
    // 막은 채로는 못 친다
    this.releaseGuard();

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
    const atkDir = this.pickAttackDir(dy, gap);

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

    /*
     * 표준 기질은 여기서 가끔 모은다.
     *
     * 모을 수 있는 것은 지상 중립 강공격뿐이라 조건을 그대로 맞춘다.
     * 다 모을 때까지 다음 입력을 넣지 않도록 쿨다운도 그만큼 늘린다 —
     * 안 그러면 봇이 모으는 도중에 다시 치려 들어 차지가 매번 끊긴다.
     */
    if (
      this.self.trait === 'plain' &&
      intent === 'heavy' &&
      atkDir === 'neutral' &&
      (this.self.body.blocked.down || this.self.body.touching.down) &&
      Phaser.Math.FloatBetween(0, 1) < 0.4
    ) {
      const hold = Phaser.Math.Between(420, 700);
      this.chargeUntil = time + hold;
      this.attackCooldown += hold;
    }
  }

  /**
   * 공격 방향을 고른다.
   *
   * 봇이 중립기만 계속 내면 커맨드 무브를 만든 의미가 플레이어 쪽에만 남는다.
   * 상대 높이를 보고 상단기·하단기를 섞어, 맞는 쪽에서도 기술 종류가 느껴지게 한다.
   *
   * @param dy 상대 Y - 자기 Y (음수면 상대가 위에 있다)
   */
  private pickAttackDir(dy: number, gap: number): AttackDir {
    const onGround =
      this.self.body.blocked.down || this.self.body.touching.down;

    if (!onGround) {
      // 공중에서 상대가 아래에 있으면 급강하 찍기로 마무리를 노린다
      if (dy > 40) return 'down';
      // 위에 있으면 올려차기로 쫓아 올라간다
      if (dy < -50) return 'up';
      return Phaser.Math.FloatBetween(0, 1) < 0.2 ? 'back' : 'neutral';
    }

    // 상대가 머리 위에 있으면 상단기로 쳐올린다
    if (dy < -70) return 'up';

    /*
     * 거리로 앞·뒤를 고른다.
     *
     * 봇이 방향을 섞지 않으면 커맨드를 스물하나로 늘린 의미가 플레이어
     * 쪽에만 남는다. 맞는 쪽에서도 "이 녀석이 여러 가지를 한다"가 느껴져야
     * 기술이 늘었다는 것이 전달된다. 무작위로 뿌리지 않고 **거리에 맞춰**
     * 고르는 것이 중요하다 — 붙어 있는데 파고드는 기술을 내면 헛치고,
     * 멀리 있는데 물러서며 치면 아무 일도 일어나지 않는다.
     */
    const roll = Phaser.Math.FloatBetween(0, 1);
    if (gap > 130) return roll < 0.55 ? 'forward' : 'neutral';
    if (gap < 60 && roll < 0.3) return 'back';

    if (roll < 0.2) return 'down';
    if (roll < 0.32) return 'up';
    if (roll < 0.46) return 'forward';
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
    this.releaseGuard();
    this.self.moveHorizontal(dir);

    // 지면보다 아래로 떨어졌으면 점프로 복귀 시도
    if (this.self.y > STAGE.GROUND_Y - 20) {
      this.self.jump();
      // 부스터는 이 캐릭터의 유일한 복귀 수단이다 — 장외에서야 값어치가 드러난다
      if (this.persona.useAirDash) this.self.dash(dir);
    }

    return true;
  }

  /** 해당 방향으로 이동해도 스테이지를 벗어나지 않는가 */
  private canStepTo(dir: -1 | 1): boolean {
    const next = this.self.x + dir * 90;
    return next > STAGE.LEFT + LEDGE_MARGIN && next < STAGE.RIGHT - LEDGE_MARGIN;
  }
}

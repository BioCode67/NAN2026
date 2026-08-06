import Phaser from 'phaser';
import { DEPTH, FIGHTER, GAME, IMPACT } from '../config/gameConfig';
import { SPRITE_SHEETS } from '../config/spriteSheets';
import type { AttackConfig } from '../types';
import { sound } from './SoundSystem';
import type { BaseCharacter } from '../characters/BaseCharacter';
import type { EventBus } from './EventBus';
import type { ProjectileSystem } from './ProjectileSystem';
import type { StockSystem } from './StockSystem';

/** 지속 피해(DOT) 상태 */
interface DotState {
  targetId: string;
  sourceId: string;
  /** 1회 틱당 피해량(%) */
  perTick: number;
  /** 다음 틱 시각 */
  nextTickAt: number;
  /** 종료 시각 */
  endAt: number;
}

/** DOT 틱 간격 (ms) */
const DOT_INTERVAL = 1000;
/** 이 시간 안에 다시 맞히면 콤보가 이어진다 (ms) */
const COMBO_WINDOW = 1400;

/**
 * 전투 판정 + 타격감 연출 시스템.
 *
 * 타격 성공 시 명세 순서대로 연출을 실행한다.
 *  1) 히트스탑 → 2) 카메라 쉐이크 → 3) 임팩트 파티클 → 4) 히트 플래시
 *  → 5) 스쿼시&스트레치 → 6) 주가 변동 → 7) 데미지 플로팅
 */
export class CombatSystem {
  private fighters: BaseCharacter[] = [];
  private projectiles?: ProjectileSystem;

  /** 히트스탑 종료 시각 */
  private hitstopUntil = 0;
  private hitstopActive = false;

  private readonly dots: DotState[] = [];

  private readonly impactEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  /** 재사용 사각형 — 매 프레임 할당 방지 */
  private readonly targetRect = new Phaser.Geom.Rectangle();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly stock: StockSystem,
    private readonly bus: EventBus,
  ) {
    this.impactEmitter = scene.add.particles(0, 0, 'spark', {
      speed: { min: 140, max: 460 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 220, max: 500 },
      blendMode: Phaser.BlendModes.ADD,
      gravityY: 420,
      emitting: false,
    });
    this.impactEmitter.setDepth(DEPTH.IMPACT);
  }

  /** 판정 대상 파이터 목록 등록 */
  setFighters(fighters: BaseCharacter[]): void {
    this.fighters = fighters;
  }

  /** 투사체 시스템 연결 (없으면 근접 판정만 수행) */
  setProjectiles(projectiles: ProjectileSystem): void {
    this.projectiles = projectiles;
  }

  /* ================================================================ */
  /* 히트스탑                                                         */
  /* ================================================================ */

  /**
   * 히트스탑 상태를 갱신한다.
   * @returns true면 이번 프레임은 정지 상태 (캐릭터/AI 갱신을 건너뛸 것)
   */
  tickHitstop(time: number): boolean {
    if (!this.hitstopActive) return false;

    if (time >= this.hitstopUntil) {
      this.hitstopActive = false;
      this.scene.physics.world.resume();
      return false;
    }
    return true;
  }

  /** 지정 시간만큼 모든 동작을 정지시킨다 */
  private applyHitstop(ms: number): void {
    this.hitstopUntil = Math.max(this.hitstopUntil, this.scene.time.now + ms);
    if (!this.hitstopActive) {
      this.hitstopActive = true;
      // 물리 정지 — 속도는 보존되므로 재개 시 그대로 날아간다
      this.scene.physics.world.pause();
    }
  }

  /* ================================================================ */
  /* 매 프레임 판정                                                   */
  /* ================================================================ */

  update(time: number, delta = 16): void {
    this.resolveHits();
    this.tickDots(time);
    this.tickCombos(time);
    this.decayKick(delta);
  }

  /* ================================================================ */
  /* 콤보                                                             */
  /* ================================================================ */

  /**
   * 연속 타격 카운터.
   * 짧은 간격으로 계속 맞히면 배율이 붙어, 한 대씩 툭툭 치는 것보다
   * 몰아치는 편이 이득이 되게 만든다.
   */
  private readonly combos = new Map<string, { count: number; until: number }>();

  private bumpCombo(fighterId: string): number {
    const now = this.scene.time.now;
    const cur = this.combos.get(fighterId);
    const count = cur && now < cur.until ? cur.count + 1 : 1;

    this.combos.set(fighterId, { count, until: now + COMBO_WINDOW });
    return count;
  }

  /** 3히트부터 10%씩, 최대 +60% */
  private comboMultiplier(count: number): number {
    if (count < 3) return 1;
    return Math.min(1.6, 1 + (count - 2) * 0.1);
  }

  private tickCombos(time: number): void {
    for (const [id, c] of this.combos) {
      if (time >= c.until) {
        this.combos.delete(id);
        this.fadeComboLabel(id);
      }
    }
    this.followComboLabels();
  }

  /** 현재 콤보 수 (HUD 표시용) */
  getCombo(fighterId: string): number {
    const c = this.combos.get(fighterId);
    if (!c || this.scene.time.now >= c.until) return 0;
    return c.count;
  }

  /** 연타 수에 따라 붙는 칭호 — 몰아칠수록 화면이 반응한다 */
  private comboRank(count: number): { text: string; color: string } {
    if (count >= 12) return { text: '상한가!!', color: '#ffffff' };
    if (count >= 9) return { text: '떡상 중!', color: '#f472b6' };
    if (count >= 6) return { text: '가즈아!', color: '#fb923c' };
    return { text: '', color: '#facc15' };
  }

  /**
   * 연타 카운터 — 매번 새로 띄우지 않고 제자리에서 숫자만 갈아 끼운다.
   *
   * 한 대마다 라벨이 새로 생겨 흩어지면 몇 대를 이었는지 읽히지 않는다.
   * 한 자리에 붙잡아 두고 튕기게 해야 "쌓이고 있다"가 보인다.
   */
  private readonly comboLabels = new Map<
    string,
    { label: Phaser.GameObjects.Text; rank: Phaser.GameObjects.Text }
  >();

  private showCombo(attacker: BaseCharacter, count: number): void {
    let entry = this.comboLabels.get(attacker.fighterId);

    if (!entry) {
      const label = this.scene.add
        .text(0, 0, '', { fontFamily: GAME.FONT, fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(DEPTH.FLOATING);
      label.setStroke('#0b1020', 7);

      const rank = this.scene.add
        .text(0, 0, '', { fontFamily: GAME.FONT, fontSize: '15px', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(DEPTH.FLOATING);
      rank.setStroke('#0b1020', 5);

      entry = { label, rank };
      this.comboLabels.set(attacker.fighterId, entry);
    }

    const { text, color } = this.comboRank(count);
    entry.label.setText(`${count} HIT`);
    entry.label.setFontSize(Math.min(46, 22 + count * 2));
    entry.label.setColor(color);
    entry.label.setAlpha(1);
    entry.rank.setText(text);
    entry.rank.setColor(color);
    entry.rank.setAlpha(1);

    // 숫자가 올라갈 때마다 튕긴다
    this.scene.tweens.killTweensOf(entry.label);
    entry.label.setScale(1.45);
    this.scene.tweens.add({
      targets: entry.label,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
    });
  }

  /** 연타 카운터를 공격자 머리 위에 붙여 둔다 */
  private followComboLabels(): void {
    for (const [id, entry] of this.comboLabels) {
      const owner = this.fighters.find((f) => f.fighterId === id);
      if (!owner) continue;
      // 말풍선(머리 위 -96 ~ -122)보다 확실히 위에 둔다 — 겹치면 둘 다 안 읽힌다
      entry.label.setPosition(owner.x, owner.y - 196);
      entry.rank.setPosition(owner.x, owner.y - 166);
    }
  }

  /** 연타가 끊기면 스르르 사라진다 */
  private fadeComboLabel(fighterId: string): void {
    const entry = this.comboLabels.get(fighterId);
    if (!entry) return;
    this.comboLabels.delete(fighterId);

    this.scene.tweens.killTweensOf(entry.label);
    this.scene.tweens.add({
      targets: [entry.label, entry.rank],
      alpha: 0,
      y: '-=24',
      duration: 260,
      onComplete: () => {
        entry.label.destroy();
        entry.rank.destroy();
      },
    });
  }

  /** 활성 히트박스와 피격자 바디의 교차를 검사한다 */
  private resolveHits(): void {
    for (const attacker of this.fighters) {
      if (!attacker.alive) continue;

      const hitbox = attacker.getHitbox();
      if (!hitbox) continue;

      const atk = attacker.getCurrentAttack();
      if (!atk) continue;

      for (const target of this.fighters) {
        if (target === attacker || !target.alive) continue;
        // 한 번의 공격 모션은 같은 대상을 한 번만 때린다
        if (attacker.hasHit(target.fighterId)) continue;
        if (target.isInvulnerable()) continue;

        const tb = target.body;
        this.targetRect.setTo(tb.x, tb.y, tb.width, tb.height);
        if (
          !Phaser.Geom.Intersects.RectangleToRectangle(hitbox, this.targetRect)
        ) {
          continue;
        }

        attacker.markHit(target.fighterId);
        this.resolveHit(attacker, target, atk, hitbox);
      }
    }

    this.resolveProjectileHits();
  }

  /** 날아가는 탄의 판정 — 근접과 같은 연출 경로를 탄다 */
  private resolveProjectileHits(): void {
    if (!this.projectiles) return;

    for (const pr of this.projectiles.getActive()) {
      const owner = this.fighters.find((f) => f.fighterId === pr.ownerId);
      if (!owner) continue;

      for (const target of this.fighters) {
        if (target.fighterId === pr.ownerId || !target.alive) continue;
        if (pr.hasHit(target.fighterId) || target.isInvulnerable()) continue;

        const tb = target.body;
        this.targetRect.setTo(tb.x, tb.y, tb.width, tb.height);
        if (
          !Phaser.Geom.Intersects.RectangleToRectangle(pr.rect, this.targetRect)
        ) {
          continue;
        }

        pr.markHit(target.fighterId);
        // 넉백 방향은 시전자가 아니라 탄이 날아온 쪽 기준이어야 자연스럽다
        this.resolveHit(owner, target, pr.atk, pr.rect, pr.x);
      }
    }
  }

  /** 타격 1회 처리 — 명세의 7단계 연출을 순서대로 실행한다 */
  private resolveHit(
    attacker: BaseCharacter,
    target: BaseCharacter,
    atk: AttackConfig,
    hitbox: Phaser.Geom.Rectangle,
    fromX: number = attacker.x,
  ): void {
    // 타격 지점 = 히트박스와 피격자 바디가 겹치는 지점
    const hitX = Phaser.Math.Clamp(hitbox.centerX, target.x - 40, target.x + 40);
    const hitY = target.y - 8;

    // 방어 성공 여부는 receiveHit이 상태를 바꾸기 전에 확인해야 한다
    const guarded = target.isGuarding();

    /*
     * 연타 수를 먼저 센다.
     * 히트스탑·타격음·화면 흔들림이 전부 연타 수에 비례해 굵어져야
     * "몰아치고 있다"가 손에 전달된다. 그래서 연출보다 먼저 계산한다.
     */
    const combo = this.bumpCombo(attacker.fighterId);
    // 연타가 쌓일수록 한 대가 무거워진다 (최대 +60%)
    const weight = Math.min(0.6, (combo - 1) * 0.07);
    const finisher = atk.finisher === true && !guarded;

    /* 0) 타격음 — 공격 종류에 따라 두께가, 연타 수에 따라 피치가 달라진다 */
    if (guarded) {
      sound.play('land', 0.9);
    } else if (finisher) {
      sound.play('finisher');
    } else {
      sound.play(
        atk.type === 'light' ? 'hitLight' : atk.type === 'heavy' ? 'hitHeavy' : 'hitSkill',
        Math.min(1, 0.3 + combo * 0.12),
      );
    }

    /* 1) 히트스탑 — 마무리 타는 확실히 한 박자 멈춘다 */
    this.applyHitstop(atk.hitstop * (1 + weight) * (finisher ? 1.5 : 1));

    /* 2) 카메라 쉐이크
       명세의 강도 0.3은 Phaser 기준(뷰포트 비율)으로 과도하므로,
       체감상 동일한 0.008~0.022 범위를 공격 데이터에 넣어 사용한다. */
    this.scene.cameras.main.shake(
      IMPACT.SHAKE_MS,
      atk.shake * (1 + weight) * (finisher ? 1.6 : 1),
    );

    /* 2-b) 카메라 킥 — 때린 방향으로 화면이 밀린다 */
    const dir = target.x >= fromX ? 1 : -1;
    this.kickCamera(dir, atk, finisher);

    /* 3) 임팩트 파티클 + 넉백 방향으로 뻗는 충격선 */
    this.spawnImpact(hitX, hitY, attacker.cfg.colors.accent, atk);
    this.spawnStreaks(hitX, hitY, dir, attacker.cfg.colors.accent, atk, finisher);
    if (finisher) this.flashScreen(attacker.cfg.colors.accent);

    /* 4) 히트 플래시 + 5) 스쿼시 & 스트레치 + 넉백/경직 */
    target.receiveHit(atk, fromX);

    /* 6) 주가 변동 — 방어·아이템·콤보가 모두 반영된다 */
    const baseDamage =
      atk.damage *
      (guarded ? FIGHTER.GUARD_DAMAGE_MUL : 1) *
      target.getDamageTakenMultiplier() *
      this.comboMultiplier(combo);

    const result = this.stock.applyHit(
      attacker,
      target,
      Math.max(1, baseDamage),
    );

    /* 7) 데미지 플로팅 */
    if (guarded) this.floatText(target.x, hitY - 54, 'GUARD!', '#93c5fd');
    this.floatText(hitX, hitY - 30, `-${result.damage}%`, '#ff5a5a');
    // 2타부터 띄운다 — 3타 연속기를 한 번 넣으면 바로 눈에 들어와야 한다
    if (combo >= 2) this.showCombo(attacker, combo);
    this.floatText(
      attacker.x,
      attacker.y - 70,
      `+${result.absorbed}%`,
      result.passiveTriggered ? '#ffd54a' : '#5affa0',
    );

    /* 스킬 부가 효과 */
    if (atk.type === 'skill') {
      this.applySkillHitEffect(attacker, target, atk);
    }

    this.bus.emit('combat:hit', {
      attackerId: attacker.fighterId,
      targetId: target.fighterId,
      damage: result.damage,
      absorbed: result.absorbed,
      attackType: atk.type,
      x: hitX,
      y: hitY,
    });
  }

  /* ================================================================ */
  /* 스킬 특수 효과                                                   */
  /* ================================================================ */

  /**
   * 착지 충격파 — 로켓 드롭이 지면에 꽂힌 순간.
   * 시전자 좌우로 넓게 퍼지며, 멀수록 피해가 줄어든다.
   */
  triggerShockwave(owner: BaseCharacter, atk: AttackConfig): void {
    const dive = atk.divePlunge;
    if (!dive) return;

    /*
     * 같은 충격파 코드를 궁극기(로켓 드롭)와 공중 급강하가 함께 쓴다.
     * 연출 강도를 고정하면 작은 급강하마저 화면이 뒤집히므로 범위에 비례시킨다.
     */
    const power = Phaser.Math.Clamp(dive.shockRange / 420, 0.4, 1);

    sound.play('hitHeavy');
    this.applyHitstop(90 + 60 * power);
    this.scene.cameras.main.shake(180 + 100 * power, 0.014 + 0.016 * power);

    const groundY = owner.y + FIGHTER.BODY_H / 2;

    /*
     * 시트에 폭발 전용 프레임이 있으면 그것으로 터뜨린다.
     * (머스크 시트의 8번 프레임이 캐릭터 없는 폭발이라 여기에 딱 맞는다)
     */
    const sheet = SPRITE_SHEETS[owner.cfg.id];
    const boomFrame = sheet?.explosionFrame;
    if (boomFrame !== undefined && this.scene.textures.exists(sheet!.key)) {
      for (const dir of [-1, 1]) {
        const boom = this.scene.add
          .sprite(owner.x, groundY - 20, sheet!.key, boomFrame)
          .setDepth(DEPTH.IMPACT)
          .setScale(dir * 0.3, 0.3);
        this.scene.tweens.add({
          targets: boom,
          x: owner.x + dir * dive.shockRange * 0.5,
          scaleX: dir * 0.75,
          scaleY: 0.6,
          alpha: 0,
          duration: 440,
          ease: 'Quad.easeOut',
          onComplete: () => boom.destroy(),
        });
      }
    }

    /*
     * 지면을 따라 퍼지는 충격파.
     * 채워진 타원으로 그리면 화면을 덮는 색 덩어리로 보인다 —
     * 테두리만 남긴 납작한 링이라야 "퍼져 나간다"로 읽힌다.
     */
    for (const dir of [-1, 1]) {
      const wave = this.scene.add
        .ellipse(owner.x, groundY - 6, 60, 22)
        .setDepth(DEPTH.IMPACT);
      wave.isFilled = false;
      wave.setStrokeStyle(5, owner.cfg.colors.accent, 0.95);

      this.scene.tweens.add({
        targets: wave,
        x: owner.x + dir * dive.shockRange * 0.7,
        scaleX: 4.5,
        scaleY: 1.6,
        alpha: 0,
        duration: 400,
        ease: 'Cubic.easeOut',
        onComplete: () => wave.destroy(),
      });
    }
    this.impactEmitter.setParticleTint(owner.cfg.colors.accent);
    this.impactEmitter.emitParticleAt(owner.x, groundY, 30);

    /* 지면에 있는 상대에게만 맞는다 — 공중으로 피할 수 있게 */
    for (const target of this.fighters) {
      if (target === owner || !target.alive || target.isInvulnerable()) continue;

      const dx = Math.abs(target.x - owner.x);
      if (dx > dive.shockRange) continue;
      if (Math.abs(target.y - owner.y) > 90) continue;

      // 중심에서 멀수록 약해진다 (최소 40%)
      const falloff = Math.max(0.4, 1 - dx / dive.shockRange);
      const shockAtk: AttackConfig = {
        ...atk,
        damage: dive.shockDamage * falloff,
        knockbackX: 520,
        knockbackY: -620,
        hitstun: 460,
      };

      target.receiveHit(shockAtk, owner.x);
      const result = this.stock.applyHit(
        owner,
        target,
        Math.max(1, shockAtk.damage * target.getDamageTakenMultiplier()),
      );
      this.floatText(target.x, target.y - 40, `-${result.damage}%`, '#ff5a5a');
      this.floatText(owner.x, owner.y - 80, `+${result.absorbed}%`, '#5affa0');
    }
  }

  /**
   * 스킬 시전 순간에 발동하는 효과 (적중 여부와 무관).
   * BattleScene이 스킬 사용 직후 호출한다.
   */
  onSkillCast(caster: BaseCharacter): void {
    const skill = caster.cfg.moves.skill;
    sound.play('skill');

    // 패니 와이즈맨 — 리츠고! : 주가를 걸고 도박한다
    if (skill.effect === 'gamble') {
      const win = Phaser.Math.FloatBetween(0, 1) < 0.5;
      const amount = skill.effectValue ?? 50;
      const delta = win ? amount : -Math.round(amount * 0.6);

      this.stock.add(caster.fighterId, delta, null);
      sound.play(win ? 'gambleWin' : 'gambleLose');
      this.floatText(
        caster.x,
        caster.y - 110,
        win ? `도박 성공! +${delta}%` : `도박 실패… ${delta}%`,
        win ? '#5affa0' : '#ff5a5a',
      );
    }

    this.bus.emit('skill:used', {
      fighterId: caster.fighterId,
      skillName: skill.name,
    });
  }

  /** 스킬이 적중했을 때의 부가 효과 */
  private applySkillHitEffect(
    attacker: BaseCharacter,
    target: BaseCharacter,
    atk: AttackConfig,
  ): void {
    switch (atk.effect) {
      // 리누스 토발즈맨 — 커널 패닉 : 지속 피해
      case 'dot': {
        const now = this.scene.time.now;
        // 같은 대상에 중첩되지 않도록 기존 DOT을 제거하고 새로 건다
        const idx = this.dots.findIndex((d) => d.targetId === target.fighterId);
        if (idx >= 0) this.dots.splice(idx, 1);

        this.dots.push({
          targetId: target.fighterId,
          sourceId: attacker.fighterId,
          perTick: atk.effectValue ?? 4,
          nextTickAt: now + DOT_INTERVAL,
          endAt: now + (atk.effectDuration ?? 5000),
        });
        this.floatText(target.x, target.y - 118, 'KERNEL PANIC', '#38bdf8');
        break;
      }

      // 빌 게이츠맨 — 블루스크린 : 화면 전체를 파랗게 물들인다
      case 'stun': {
        const flash = this.scene.add
          .rectangle(
            this.scene.cameras.main.centerX,
            this.scene.cameras.main.centerY,
            GAME.WIDTH,
            GAME.HEIGHT,
            0x1e5fd0,
            0.55,
          )
          .setDepth(DEPTH.OVERLAY)
          .setScrollFactor(0);

        this.scene.tweens.add({
          targets: flash,
          alpha: 0,
          duration: 420,
          onComplete: () => flash.destroy(),
        });
        break;
      }

      default:
        break;
    }
  }

  /** DOT 틱 처리 */
  private tickDots(time: number): void {
    for (let i = this.dots.length - 1; i >= 0; i--) {
      const dot = this.dots[i]!;

      if (time >= dot.endAt) {
        this.dots.splice(i, 1);
        continue;
      }

      if (time >= dot.nextTickAt) {
        dot.nextTickAt += DOT_INTERVAL;

        const target = this.fighters.find((f) => f.fighterId === dot.targetId);
        if (!target || !target.alive) {
          this.dots.splice(i, 1);
          continue;
        }

        this.stock.add(dot.targetId, -dot.perTick, dot.sourceId);
        this.floatText(
          target.x + Phaser.Math.Between(-16, 16),
          target.y - 60,
          `-${dot.perTick}%`,
          '#38bdf8',
        );
      }
    }
  }

  /* ================================================================ */
  /* 연출 헬퍼                                                        */
  /* ================================================================ */

  /* ---------------------------------------------------------------- */
  /* 카메라 킥                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * 때린 방향으로 화면 전체가 밀렸다 돌아온다.
   *
   * 흔들림(shake)은 사방으로 떨릴 뿐이라 "어느 쪽으로 때렸는지"가 없다.
   * 방향이 있는 밀림이 하나 더 붙어야 주먹에 무게가 실린다.
   * BattleScene의 카메라 보간이 매 프레임 scrollX를 덮어쓰므로,
   * 여기서는 오프셋만 들고 있고 실제 적용은 씬이 더한다.
   */
  /*
   * 수평 성분만 둔다.
   * 카메라에 월드 경계가 걸려 있고 뷰포트 높이가 월드 높이와 같아,
   * 세로 스크롤은 언제나 0으로 잘린다 — 세로 킥은 값만 계산될 뿐 화면에 없다.
   */
  private readonly kick = { x: 0 };

  private kickCamera(dir: number, atk: AttackConfig, finisher: boolean): void {
    const power = (atk.shake / 0.016) * (finisher ? 22 : 11);
    this.kick.x = Phaser.Math.Clamp(this.kick.x + dir * power, -34, 34);
  }

  private decayKick(delta: number): void {
    // 프레임률과 무관하게 같은 속도로 잦아들도록 지수 감쇠
    this.kick.x *= Math.pow(0.002, delta / 1000);
    if (Math.abs(this.kick.x) < 0.2) this.kick.x = 0;
  }

  /** BattleScene이 카메라 위치에 더할 가로 오프셋 */
  getCameraKick(): number {
    return this.kick.x;
  }

  /* ---------------------------------------------------------------- */

  /**
   * 충격선 — 타격 지점에서 넉백 방향으로 뻗는 짧은 선들.
   * 파티클이 사방으로 흩어지는 것과 달리 "밀려나는 방향"을 그린다.
   */
  private spawnStreaks(
    x: number,
    y: number,
    dir: number,
    color: number,
    atk: AttackConfig,
    finisher: boolean,
  ): void {
    const count = finisher ? 7 : atk.type === 'light' ? 3 : 5;
    const reach = finisher ? 200 : 120;

    for (let i = 0; i < count; i++) {
      const spread = Phaser.Math.Between(-30, 30);
      const len = Phaser.Math.Between(reach * 0.4, reach);

      const streak = this.scene.add
        .rectangle(x, y + spread, len, finisher ? 5 : 3, color, 0.9)
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.IMPACT)
        .setBlendMode(Phaser.BlendModes.ADD);
      // 뒤로 뻗을 때는 원점이 오른쪽에 오도록 뒤집는다
      if (dir < 0) streak.setOrigin(1, 0.5);

      this.scene.tweens.add({
        targets: streak,
        x: x + dir * len * 1.1,
        scaleX: 0.2,
        alpha: 0,
        duration: finisher ? 280 : 190,
        ease: 'Cubic.easeOut',
        onComplete: () => streak.destroy(),
      });
    }
  }

  /** 마무리 타 순간의 화면 섬광 — 아주 짧게 한 번만 */
  private flashScreen(color: number): void {
    const cam = this.scene.cameras.main;
    const flash = this.scene.add
      .rectangle(cam.centerX, cam.centerY, GAME.WIDTH, GAME.HEIGHT, color, 0.34)
      .setDepth(DEPTH.OVERLAY - 1)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 170,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  /** 임팩트 파티클 + 링 이펙트 */
  private spawnImpact(
    x: number,
    y: number,
    color: number,
    atk: AttackConfig,
  ): void {
    const heavy = atk.type !== 'light';
    const count = heavy ? IMPACT.PARTICLE_COUNT + 8 : IMPACT.PARTICLE_COUNT;

    this.impactEmitter.setParticleTint(color);
    this.impactEmitter.emitParticleAt(x, y, count);

    // 하얀 섬광 원
    const burst = this.scene.add
      .circle(x, y, heavy ? 26 : 18, 0xffffff, 0.95)
      .setDepth(DEPTH.IMPACT);
    this.scene.tweens.add({
      targets: burst,
      scale: heavy ? 2.6 : 1.9,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => burst.destroy(),
    });

    // 퍼지는 링
    const ring = this.scene.add
      .circle(x, y, 14)
      .setStrokeStyle(4, color, 0.9)
      .setDepth(DEPTH.IMPACT);
    this.scene.tweens.add({
      targets: ring,
      scale: heavy ? 4.2 : 2.8,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /** 떠오르는 숫자 팝업 */
  private floatText(
    x: number,
    y: number,
    text: string,
    color: string,
  ): void {
    const label = this.scene.add
      .text(x, y, text, {
        fontFamily: GAME.FONT,
        fontSize: '22px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.FLOATING);
    label.setStroke('#0b1020', 5);

    this.scene.tweens.add({
      targets: label,
      y: y - 52,
      alpha: 0,
      scale: { from: 1.35, to: 0.95 },
      duration: IMPACT.FLOATING_MS,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  /** 씬 종료 시 정리 */
  reset(): void {
    this.dots.length = 0;
    this.combos.clear();
    this.fighters = [];

    this.comboLabels.forEach(({ label, rank }) => {
      label.destroy();
      rank.destroy();
    });
    this.comboLabels.clear();
    this.kick.x = 0;

    if (this.hitstopActive) {
      this.hitstopActive = false;
      /*
       * 씬이 내려가는 중이라면 물리 월드는 이미 정리돼 null일 수 있다.
       * 히트스탑 도중에 R로 재시작하면 실제로 그 순간을 밟는다 —
       * 그대로 두면 재시작이 예외로 끝난다.
       */
      this.scene.physics?.world?.resume();
    }
  }
}

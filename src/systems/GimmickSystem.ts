import Phaser from 'phaser';
import { DEPTH, GAME, STAGE } from '../config/gameConfig';
import { sound } from './SoundSystem';
import type { GimmickSpec } from '../types';
import type { BaseCharacter } from '../characters/BaseCharacter';
import type { ItemSystem } from './ItemSystem';
import type { RhythmSystem } from './RhythmSystem';
import type { StockSystem } from './StockSystem';

/** 진행 중인 기믹 하나 */
interface ActiveGimmick {
  spec: GimmickSpec;
  /** 만료 시각 (0이면 즉시형이라 여기 들어오지 않는다) */
  endAt: number;
  /** 매 프레임 유지 효과 (바람·용암 등) */
  tick?: (time: number, delta: number) => void;
  /** 끝날 때 되돌리기 */
  cleanup: () => void;
}

/** 씬이 기믹에 넘겨주는 접근 통로 */
export interface GimmickContext {
  fighters: () => BaseCharacter[];
  items: ItemSystem;
  stock: StockSystem;
  rhythm: RhythmSystem;
  /** 공중 발판 표시 객체 (발판 붕괴가 쓴다) */
  platforms: () => Phaser.GameObjects.Rectangle[];
}

/** 용암 피해 간격 */
const LAVA_TICK_MS = 700;

/**
 * 프롬프트 기믹 실행기.
 *
 * 해석된 GimmickSpec을 받아 실제로 판을 바꾸고, 시간이 끝나면 되돌린다.
 * "무엇을 할지"(config/gimmicks.ts)와 "어떻게 할지"(여기)를 나눠 두면
 * 기믹을 추가할 때 카탈로그 한 줄 + 여기 분기 하나로 끝난다.
 *
 * 되돌리기를 각 기믹이 클로저로 들고 있는 이유:
 * 중력·발판·스케일처럼 서로 다른 것을 건드리므로 공통 복원 루틴을 만들 수 없고,
 * 켜는 코드 바로 옆에 끄는 코드가 있어야 빠뜨리지 않는다.
 */
export class GimmickSystem {
  private readonly active: ActiveGimmick[] = [];

  /** 룰이 바꾼 전역 배율 — CombatSystem이 피해 계산에 쓴다 */
  private damageMul = 1;
  /** 시간 배율 (1 = 정상, 2 = 절반 속도) */
  private timeScale = 1;
  /** 좌우 이동 입력 반전 여부 */
  private reversed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: GimmickContext,
  ) {}

  /* ================================================================ */
  /* 조회 — 다른 시스템이 읽어간다                                     */
  /* ================================================================ */

  /** 룰로 인한 피해 배율 (서든데스 등) */
  getDamageMultiplier(): number {
    return this.damageMul;
  }

  /** 1보다 크면 그만큼 느리게 흐른다 */
  getTimeScale(): number {
    return this.timeScale;
  }

  /** 좌우 반전 룰이 켜져 있는가 */
  isReversed(): boolean {
    return this.reversed;
  }

  /** 진행 중인 기믹 목록 (HUD 표시용) */
  getActive(): Array<{ spec: GimmickSpec; endAt: number }> {
    return this.active.map((a) => ({ spec: a.spec, endAt: a.endAt }));
  }

  /* ================================================================ */
  /* 발동                                                             */
  /* ================================================================ */

  /**
   * 기믹을 발동한다.
   * @param prompt 플레이어가 입력한 원문 (연출에 그대로 보여준다)
   */
  activate(spec: GimmickSpec, prompt: string, time: number): void {
    // 같은 기믹이 이미 돌고 있으면 시간만 늘린다 (중첩 적용은 되돌리기가 꼬인다)
    const existing = this.active.find((a) => a.spec.id === spec.id);
    if (existing) {
      existing.endAt = time + spec.duration;
      this.announce(spec, prompt, true);
      return;
    }

    this.announce(spec, prompt, false);
    sound.play('skill');

    const handle = this.run(spec, time);
    if (spec.duration > 0) {
      this.active.push({
        spec,
        endAt: time + spec.duration,
        tick: handle?.tick,
        cleanup: handle?.cleanup ?? (() => {}),
      });
    }
  }

  /** id로 분기해 실제 효과를 건다 */
  private run(
    spec: GimmickSpec,
    time: number,
  ): { tick?: (t: number, d: number) => void; cleanup?: () => void } | void {
    switch (spec.id) {
      /* --- 아이템 (즉시) ------------------------------------------ */
      case 'item_rain':
        this.ctx.items.dropBurst(6);
        return;
      case 'item_bomb':
        this.ctx.items.dropBurst(4, 'bomb');
        return;
      case 'item_heal':
        this.ctx.items.dropBurst(3, 'buyback');
        return;
      case 'item_power':
        this.ctx.items.dropBurst(3, 'stockOption');
        return;

      /* --- 맵 ------------------------------------------------------ */
      case 'map_moon':
        return this.applyGravity(0.42);
      case 'map_storm':
        return this.applyStorm();
      case 'map_lava':
        return this.applyLava(time);
      case 'map_narrow':
        return this.applyNarrow();
      case 'map_blackout':
        return this.applyBlackout();

      /* --- 룰 ------------------------------------------------------ */
      case 'rule_rhythm':
        this.ctx.rhythm.start(time);
        return { cleanup: () => this.ctx.rhythm.stop() };
      case 'rule_sudden':
        this.damageMul = 3;
        return { cleanup: () => (this.damageMul = 1) };
      case 'rule_reverse':
        this.reversed = true;
        return { cleanup: () => (this.reversed = false) };
      case 'rule_giant':
        return this.applyGiant(1.6);
      case 'rule_slow':
        return this.applySlow(1.85);

      default:
        return;
    }
  }

  /* ================================================================ */
  /* 맵 기믹                                                          */
  /* ================================================================ */

  /** 중력을 바꾼다 — 점프가 통째로 달라진다 */
  private applyGravity(mul: number) {
    const world = this.scene.physics.world;
    const before = world.gravity.y;
    world.gravity.y = GAME.GRAVITY * mul;

    return {
      cleanup: () => {
        world.gravity.y = before;
      },
    };
  }

  /** 한쪽으로 계속 미는 강풍 */
  private applyStorm() {
    // 방향은 발동 시 한 번만 정한다 — 매 프레임 바뀌면 그냥 진동이 된다
    const dir = Phaser.Math.Between(0, 1) === 0 ? -1 : 1;
    const push = 260;

    const streaks: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < 14; i++) {
      const s = this.scene.add
        .rectangle(
          Phaser.Math.Between(0, GAME.WORLD_WIDTH),
          Phaser.Math.Between(80, STAGE.GROUND_Y - 40),
          Phaser.Math.Between(40, 130),
          2,
          0x93c5fd,
          0.5,
        )
        .setDepth(DEPTH.STAGE + 2)
        .setBlendMode(Phaser.BlendModes.ADD);
      streaks.push(s);
    }

    return {
      tick: (_t: number, delta: number) => {
        const dt = delta / 1000;
        for (const f of this.ctx.fighters()) {
          if (!f.alive) continue;
          f.body.x += dir * push * dt;
        }
        for (const s of streaks) {
          s.x += dir * 620 * dt;
          if (dir > 0 && s.x > GAME.WORLD_WIDTH) s.x = -100;
          if (dir < 0 && s.x < -100) s.x = GAME.WORLD_WIDTH;
        }
      },
      cleanup: () => streaks.forEach((s) => s.destroy()),
    };
  }

  /** 지면이 불탄다 — 바닥에 서 있으면 주가가 녹는다 */
  private applyLava(time: number) {
    const width = STAGE.RIGHT - STAGE.LEFT;
    const cx = (STAGE.LEFT + STAGE.RIGHT) / 2;

    const glow = this.scene.add
      .rectangle(cx, STAGE.GROUND_Y + 10, width, 26, 0xf97316, 0.75)
      .setDepth(DEPTH.STAGE + 2)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: glow,
      alpha: 0.35,
      duration: 380,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    let nextTick = time + LAVA_TICK_MS;

    return {
      tick: (t: number) => {
        if (t < nextTick) return;
        nextTick = t + LAVA_TICK_MS;

        for (const f of this.ctx.fighters()) {
          if (!f.alive) continue;
          const onGround = f.body.blocked.down || f.body.touching.down;
          // 공중 발판 위는 안전하다 — 도망칠 곳이 있어야 룰이 된다
          if (!onGround || f.y < STAGE.GROUND_Y - 120) continue;

          this.ctx.stock.add(f.fighterId, -4, null);
          this.floatText(f.x, f.y - 40, '-4%', '#f97316');
        }
      },
      cleanup: () => {
        this.scene.tweens.killTweensOf(glow);
        glow.destroy();
      },
    };
  }

  /** 공중 발판이 무너진다 */
  private applyNarrow() {
    const plats = this.ctx.platforms();

    for (const p of plats) {
      p.setVisible(false);
      const body = p.body as Phaser.Physics.Arcade.StaticBody | null;
      if (body) body.enable = false;

      // 무너지는 순간 파편을 뿌려 "사라졌다"를 알린다
      const dust = this.scene.add
        .rectangle(p.x, p.y, p.width, STAGE.PLATFORM_H, 0x93c5fd, 0.7)
        .setDepth(DEPTH.IMPACT);
      this.scene.tweens.add({
        targets: dust,
        y: p.y + 160,
        alpha: 0,
        angle: Phaser.Math.Between(-25, 25),
        duration: 700,
        ease: 'Quad.easeIn',
        onComplete: () => dust.destroy(),
      });
    }

    return {
      cleanup: () => {
        for (const p of plats) {
          p.setVisible(true);
          const body = p.body as Phaser.Physics.Arcade.StaticBody | null;
          if (body) body.enable = true;
        }
      },
    };
  }

  /** 정전 — 자기 주변만 보인다 */
  private applyBlackout() {
    const dark = this.scene.add
      .rectangle(
        GAME.WORLD_WIDTH / 2,
        GAME.HEIGHT / 2,
        GAME.WORLD_WIDTH,
        GAME.HEIGHT,
        0x000000,
        0.86,
      )
      .setDepth(DEPTH.FLOATING - 1);

    /*
     * 가산 합성 원을 파이터마다 하나씩 띄워 그 주변만 밝힌다.
     * (마스크를 쓰면 정확하지만 Phaser에서 카메라 스크롤과 함께 다루기 번거롭고,
     *  이 정도 연출에는 발광 원으로 충분하다)
     */
    const lights = this.ctx.fighters().map(() =>
      this.scene.add
        .circle(0, 0, 130, 0x9bb4ff, 0.16)
        .setDepth(DEPTH.FLOATING - 1)
        .setBlendMode(Phaser.BlendModes.ADD),
    );

    return {
      tick: () => {
        const fs = this.ctx.fighters();
        lights.forEach((light, i) => {
          const f = fs[i];
          if (!f || !f.alive) {
            light.setVisible(false);
            return;
          }
          light.setVisible(true);
          light.setPosition(f.x, f.y);
        });
      },
      cleanup: () => {
        dark.destroy();
        lights.forEach((l) => l.destroy());
      },
    };
  }

  /* ================================================================ */
  /* 룰 기믹                                                          */
  /* ================================================================ */

  /** 전원이 커진다 — 히트박스와 물리 바디까지 함께 커진다 */
  private applyGiant(scale: number) {
    const targets = this.ctx.fighters();
    targets.forEach((f) => f.setSizeScale(scale));

    return {
      cleanup: () => targets.forEach((f) => f.setSizeScale(1)),
    };
  }

  /** 시간이 느려진다 */
  private applySlow(scale: number) {
    const world = this.scene.physics.world;
    this.timeScale = scale;
    world.timeScale = scale;

    return {
      cleanup: () => {
        this.timeScale = 1;
        world.timeScale = 1;
      },
    };
  }

  /* ================================================================ */
  /* 매 프레임                                                        */
  /* ================================================================ */

  update(time: number, delta: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i]!;

      if (time >= a.endAt) {
        a.cleanup();
        this.active.splice(i, 1);
        this.announceEnd(a.spec);
        continue;
      }
      a.tick?.(time, delta);
    }
  }

  /* ================================================================ */
  /* 연출                                                             */
  /* ================================================================ */

  /**
   * 발동 연출.
   * 입력한 문장을 그대로 크게 보여준다 — "내가 쓴 말이 판을 바꿨다"가
   * 전달되지 않으면 이 기능은 그냥 랜덤 이벤트로 읽힌다.
   */
  private announce(spec: GimmickSpec, prompt: string, extended: boolean): void {
    const hex = `#${spec.color.toString(16).padStart(6, '0')}`;
    const cam = this.scene.cameras.main;

    const panel = this.scene.add
      .rectangle(cam.centerX, 250, 760, 150, 0x0b1020, 0.9)
      .setStrokeStyle(3, spec.color)
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0);

    const quoted = prompt ? `“${prompt}”` : '(입력 없음)';
    const text = this.scene.add
      .text(
        cam.centerX,
        250,
        `${quoted}\n\n${spec.icon} ${spec.name}${extended ? ' (연장)' : ''}\n${spec.desc}`,
        {
          fontFamily: GAME.FONT,
          fontSize: '20px',
          color: hex,
          align: 'center',
          lineSpacing: 4,
          fontStyle: 'bold',
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1)
      .setScrollFactor(0);
    text.setStroke('#0b1020', 6);

    for (const obj of [panel, text]) {
      this.scene.tweens.add({
        targets: obj,
        scale: { from: 1.3, to: 1 },
        duration: 280,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.scene.tweens.add({
            targets: obj,
            alpha: 0,
            delay: 1500,
            duration: 380,
            onComplete: () => obj.destroy(),
          });
        },
      });
    }
  }

  private announceEnd(spec: GimmickSpec): void {
    const cam = this.scene.cameras.main;
    const label = this.scene.add
      .text(cam.centerX, 180, `${spec.icon} ${spec.name} 종료`, {
        fontFamily: GAME.FONT,
        fontSize: '18px',
        color: '#7f93bd',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0);

    this.scene.tweens.add({
      targets: label,
      alpha: 0,
      y: label.y - 20,
      duration: 900,
      onComplete: () => label.destroy(),
    });
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const label = this.scene.add
      .text(x, y, text, {
        fontFamily: GAME.FONT,
        fontSize: '18px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.FLOATING);
    label.setStroke('#0b1020', 4);

    this.scene.tweens.add({
      targets: label,
      y: y - 34,
      alpha: 0,
      duration: 520,
      onComplete: () => label.destroy(),
    });
  }

  /** 씬 종료 — 걸어둔 효과를 전부 되돌린다 */
  reset(): void {
    this.active.forEach((a) => a.cleanup());
    this.active.length = 0;
    this.damageMul = 1;
    this.reversed = false;

    // 물리 월드는 씬과 함께 사라지므로 남은 값만 정리한다
    this.timeScale = 1;
  }
}

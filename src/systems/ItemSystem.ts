import Phaser from 'phaser';
import { DEPTH, GAME, STAGE } from '../config/gameConfig';
import { rollItem } from '../config/items';
import type { ItemConfig } from '../config/items';
import { sound } from './SoundSystem';
import type { BaseCharacter } from '../characters/BaseCharacter';
import type { StockSystem } from './StockSystem';

/** 스테이지에 떨어져 있는 아이템 상자 */
interface Drop {
  cfg: ItemConfig;
  root: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Text;
  /** 낙하 속도 */
  vy: number;
  landed: boolean;
  /** 이 시각이 지나면 사라진다 */
  expireAt: number;
  taken: boolean;
}

/** 드랍 간격 (ms) */
const SPAWN_INTERVAL = 9000;
/** 첫 드랍까지 대기 */
const FIRST_SPAWN_DELAY = 6000;
/** 줍지 않으면 사라지는 시간 */
const DROP_LIFESPAN = 14000;
/** 획득 판정 반경 */
const PICKUP_RADIUS = 46;

/**
 * 아이템 시스템.
 *
 * 일정 간격으로 스테이지 위에 아이템이 떨어지고, 닿으면 즉시 발동한다.
 * 아이템 효과는 BaseCharacter의 배율에 곱해지므로
 * 떡상 등급·패시브와 자연스럽게 함께 적용된다.
 */
export class ItemSystem {
  private readonly drops: Drop[] = [];
  private nextSpawnAt = 0;
  private fighters: BaseCharacter[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly stock: StockSystem,
  ) {}

  setFighters(fighters: BaseCharacter[]): void {
    this.fighters = fighters;
  }

  /** 전투 시작 시 호출 — 첫 드랍 타이머를 건다 */
  start(): void {
    this.nextSpawnAt = this.scene.time.now + FIRST_SPAWN_DELAY;
  }

  update(time: number, delta: number): void {
    if (time >= this.nextSpawnAt) {
      this.spawn();
      this.nextSpawnAt = time + SPAWN_INTERVAL;
    }

    this.updateDrops(time, delta);
    this.checkPickups(time);
  }

  /* ================================================================ */
  /* 드랍                                                             */
  /* ================================================================ */

  private spawn(): void {
    const cfg = rollItem(() => Phaser.Math.FloatBetween(0, 1));

    // 스테이지 안쪽에만 떨어뜨린다 (장외로 굴러가면 못 줍는다)
    const x = Phaser.Math.Between(STAGE.LEFT + 120, STAGE.RIGHT - 120);
    const y = -60;

    const box = this.scene.add
      .rectangle(0, 0, 44, 44, 0x0b1020, 0.9)
      .setStrokeStyle(3, cfg.color);
    const glow = this.scene.add.circle(0, 0, 32, cfg.color, 0.25);
    glow.setBlendMode(Phaser.BlendModes.ADD);
    const icon = this.scene.add
      .text(0, 0, cfg.icon, { fontSize: '26px' })
      .setOrigin(0.5);

    const root = this.scene.add
      .container(x, y, [glow, box, icon])
      .setDepth(DEPTH.FIGHTER - 1);

    // 계속 살짝 회전시켜 눈에 띄게 한다
    this.scene.tweens.add({
      targets: box,
      angle: 360,
      duration: 4000,
      repeat: -1,
    });

    this.drops.push({
      cfg,
      root,
      icon,
      vy: 0,
      landed: false,
      expireAt: 0,
      taken: false,
    });
  }

  private updateDrops(time: number, delta: number): void {
    const dt = delta / 1000;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;

      if (d.taken) {
        this.drops.splice(i, 1);
        continue;
      }

      if (!d.landed) {
        d.vy += 900 * dt;
        d.root.y += d.vy * dt;

        // 지면에 닿으면 착지 — 이때부터 소멸 타이머가 돈다
        if (d.root.y >= STAGE.GROUND_Y - 26) {
          d.root.y = STAGE.GROUND_Y - 26;
          d.landed = true;
          d.expireAt = time + DROP_LIFESPAN;

          this.scene.tweens.add({
            targets: d.root,
            y: d.root.y - 10,
            duration: 700,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        }
      } else {
        // 사라지기 2초 전부터 깜빡여 알린다
        if (time > d.expireAt - 2000) {
          d.root.setAlpha(Math.sin(time * 0.02) > 0 ? 1 : 0.3);
        }
        if (time >= d.expireAt) {
          d.root.destroy();
          this.drops.splice(i, 1);
        }
      }
    }
  }

  private checkPickups(time: number): void {
    for (const d of this.drops) {
      if (d.taken || !d.landed) continue;

      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (Phaser.Math.Distance.Between(f.x, f.y, d.root.x, d.root.y) > PICKUP_RADIUS) {
          continue;
        }

        d.taken = true;
        this.grant(f, d.cfg, time);
        this.playPickupFx(d);
        break;
      }
    }
  }

  /* ================================================================ */
  /* 획득                                                             */
  /* ================================================================ */

  private grant(fighter: BaseCharacter, cfg: ItemConfig, time: number): void {
    sound.play('gambleWin');

    // 즉시형 (자사주 매입)
    if (cfg.instantStock) {
      this.stock.add(fighter.fighterId, cfg.instantStock, null);
    }

    // 지속형
    if (cfg.duration > 0 && cfg.mods) {
      fighter.equipItem(cfg, time + cfg.duration);
    }

    this.announce(fighter, cfg);
  }

  private announce(fighter: BaseCharacter, cfg: ItemConfig): void {
    const hex = `#${cfg.color.toString(16).padStart(6, '0')}`;
    const label = this.scene.add
      .text(fighter.x, fighter.y - 120, `${cfg.icon} ${cfg.name}\n${cfg.desc}`, {
        fontFamily: GAME.FONT,
        fontSize: '15px',
        color: hex,
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.FLOATING);
    label.setStroke('#0b1020', 5);

    this.scene.tweens.add({
      targets: label,
      y: label.y - 40,
      alpha: 0,
      duration: 1300,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private playPickupFx(d: Drop): void {
    const burst = this.scene.add
      .circle(d.root.x, d.root.y, 24, d.cfg.color, 0.8)
      .setDepth(DEPTH.IMPACT);
    this.scene.tweens.add({
      targets: burst,
      scale: 3,
      alpha: 0,
      duration: 320,
      onComplete: () => burst.destroy(),
    });

    this.scene.tweens.killTweensOf(d.root);
    this.scene.tweens.add({
      targets: d.root,
      scale: 1.6,
      alpha: 0,
      duration: 220,
      onComplete: () => d.root.destroy(),
    });
  }

  reset(): void {
    this.drops.forEach((d) => {
      this.scene.tweens.killTweensOf(d.root);
      d.root.destroy();
    });
    this.drops.length = 0;
    this.fighters = [];
  }
}

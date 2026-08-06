import Phaser from 'phaser';
import { DEPTH, GAME, STAGE } from '../config/gameConfig';
import { sound } from './SoundSystem';
import type { BaseCharacter } from '../characters/BaseCharacter';
import type { ProjectileSystem } from './ProjectileSystem';

/** 오브가 버티는 체력 — 몇 대는 때려야 깨진다 */
const ORB_HP = 55;
/** 오브 충돌 반지름 */
const ORB_RADIUS = 34;
/** 첫 등장까지 */
const FIRST_SPAWN_DELAY = 13000;
/** 다음 오브까지 */
const SPAWN_INTERVAL = 26000;
/** 이 시간 안에 못 깨면 달아난다 */
const ORB_LIFESPAN = 15000;
/** 같은 공격 모션이 오브를 연타하지 않도록 하는 최소 간격 */
const HIT_COOLDOWN = 220;

/** 떠다니는 프롬프트 오브 하나 */
interface Orb {
  root: Phaser.GameObjects.Container;
  core: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  hp: number;
  /** 사라지는 시각 */
  dieAt: number;
  /** 다음 피격을 받을 수 있는 시각 */
  hittableAt: number;
  /** 8자 궤도 진행값 */
  t: number;
  cx: number;
  cy: number;
  dead: boolean;
}

/**
 * 프롬프트 오브 시스템 — 이 게임의 스매시볼.
 *
 * 일정 시간마다 떠다니는 오브가 나타나고, 때려서 깨뜨린 파이터가
 * **프롬프트 입력 권한**을 얻는다. 입력한 문장은 아이템·맵·룰 중 하나로
 * 해석되어 판을 통째로 바꾼다.
 *
 * 깨는 것 자체가 경쟁이 되도록 만들었다.
 *  - 체력이 있어 한 대로는 안 깨진다 (누가 마지막 타를 넣느냐 싸움)
 *  - 궤도를 그리며 떠다녀 공중전이 강제된다
 *  - 방치하면 달아난다
 */
export class PromptOrbSystem {
  private orb: Orb | null = null;
  private nextSpawnAt = 0;
  private fighters: BaseCharacter[] = [];
  private projectiles?: ProjectileSystem;

  /** 오브가 깨졌을 때 호출 — BattleScene이 프롬프트 입력으로 연결한다 */
  onBreak?: (breaker: BaseCharacter) => void;

  private readonly hitRect = new Phaser.Geom.Rectangle();
  private readonly orbCircle = new Phaser.Geom.Circle(0, 0, ORB_RADIUS);

  constructor(private readonly scene: Phaser.Scene) {}

  setFighters(fighters: BaseCharacter[]): void {
    this.fighters = fighters;
  }

  setProjectiles(projectiles: ProjectileSystem): void {
    this.projectiles = projectiles;
  }

  /** 전투 시작 시 첫 등장 타이머를 건다 */
  start(): void {
    this.nextSpawnAt = this.scene.time.now + FIRST_SPAWN_DELAY;
  }

  /** 지금 오브가 떠 있는가 (HUD 안내용) */
  isActive(): boolean {
    return this.orb !== null && !this.orb.dead;
  }

  update(time: number, delta: number): void {
    if (!this.orb && time >= this.nextSpawnAt) this.spawn(time);
    if (!this.orb) return;

    this.drift(delta);
    this.resolveHits(time);

    // 방치하면 달아난다 — 다음 오브까지 다시 기다려야 한다
    if (this.orb && time >= this.orb.dieAt) this.escape(time);
  }

  /* ================================================================ */
  /* 등장                                                             */
  /* ================================================================ */

  private spawn(time: number): void {
    const cx = Phaser.Math.Between(STAGE.LEFT + 320, STAGE.RIGHT - 320);
    const cy = Phaser.Math.Between(240, 390);

    /* 안쪽 코어 — 가산 합성으로 어두운 배경 위에서 발광한다 */
    const core = this.scene.add.circle(0, 0, ORB_RADIUS, 0xf472b6, 0.95);
    core.setBlendMode(Phaser.BlendModes.ADD);

    const ring = this.scene.add.circle(0, 0, ORB_RADIUS + 12);
    ring.isFilled = false;
    ring.setStrokeStyle(4, 0xffffff, 0.9);

    const label = this.scene.add
      .text(0, 0, 'AI', {
        fontFamily: GAME.FONT,
        fontSize: '20px',
        color: '#0b1020',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const root = this.scene.add
      .container(cx, cy, [core, ring, label])
      .setDepth(DEPTH.FIGHTER + 1);

    /* 등장 연출 — 작게 나타나 크게 부풀었다 제자리로 */
    root.setScale(0);
    this.scene.tweens.add({
      targets: root,
      scale: 1,
      duration: 420,
      ease: 'Back.easeOut',
    });

    /* 링이 계속 맥동해 "때릴 수 있는 것"으로 읽히게 한다 */
    this.scene.tweens.add({
      targets: ring,
      scale: 1.35,
      alpha: { from: 0.9, to: 0.25 },
      duration: 720,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.orb = {
      root,
      core,
      ring,
      label,
      hp: ORB_HP,
      dieAt: time + ORB_LIFESPAN,
      hittableAt: 0,
      t: Phaser.Math.FloatBetween(0, Math.PI * 2),
      cx,
      cy,
      dead: false,
    };

    sound.play('surge');
    this.announce('프롬프트 오브 출현!', '#f472b6');
  }

  /**
   * 8자를 그리며 떠다닌다.
   *
   * 제자리에 떠 있으면 리치 긴 캐릭터가 서서 두들기면 끝이라,
   * 쫓아가서 공중에서 잡아야 하도록 궤도를 준다.
   */
  private drift(delta: number): void {
    const o = this.orb;
    if (!o) return;

    o.t += delta / 1000;
    o.root.x = o.cx + Math.sin(o.t * 0.9) * 240;
    o.root.y = o.cy + Math.sin(o.t * 1.8) * 70;
  }

  /* ================================================================ */
  /* 피격                                                             */
  /* ================================================================ */

  private resolveHits(time: number): void {
    const o = this.orb;
    if (!o || o.dead || time < o.hittableAt) return;

    this.orbCircle.setPosition(o.root.x, o.root.y);

    /* 근접 히트박스 */
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const box = f.getHitbox();
      if (!box) continue;
      if (!Phaser.Geom.Intersects.CircleToRectangle(this.orbCircle, box)) continue;

      this.damage(f, f.getCurrentAttack()?.damage ?? 10, time);
      return;
    }

    /* 투사체 — 원거리 캐릭터도 오브 경쟁에 낄 수 있어야 한다 */
    for (const pr of this.projectiles?.getActive() ?? []) {
      this.hitRect.setTo(pr.rect.x, pr.rect.y, pr.rect.width, pr.rect.height);
      if (!Phaser.Geom.Intersects.CircleToRectangle(this.orbCircle, this.hitRect)) {
        continue;
      }
      const owner = this.fighters.find((f) => f.fighterId === pr.ownerId);
      if (!owner) continue;

      this.damage(owner, pr.atk.damage, time);
      return;
    }
  }

  private damage(by: BaseCharacter, amount: number, time: number): void {
    const o = this.orb;
    if (!o || o.dead) return;

    o.hp -= Math.max(4, amount);
    o.hittableAt = time + HIT_COOLDOWN;

    sound.play('hitLight', 0.9);
    this.scene.cameras.main.shake(90, 0.006);

    /* 맞을수록 붉어지고 격하게 떨린다 — 남은 체력이 눈으로 보인다 */
    const left = Phaser.Math.Clamp(o.hp / ORB_HP, 0, 1);
    o.core.setFillStyle(
      Phaser.Display.Color.GetColor(255, Math.round(70 + 130 * left), Math.round(150 * left)),
      0.95,
    );

    this.scene.tweens.killTweensOf(o.root);
    o.root.setScale(1.3);
    this.scene.tweens.add({
      targets: o.root,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
    });

    if (o.hp <= 0) this.breakOrb(by);
  }

  /* ================================================================ */
  /* 파괴 / 소멸                                                      */
  /* ================================================================ */

  private breakOrb(by: BaseCharacter): void {
    const o = this.orb;
    if (!o || o.dead) return;
    o.dead = true;

    sound.play('gambleWin');
    this.scene.cameras.main.shake(320, 0.02);
    this.burst(o.root.x, o.root.y);

    this.scene.tweens.killTweensOf(o.root);
    this.scene.tweens.killTweensOf(o.ring);
    this.scene.tweens.add({
      targets: o.root,
      scale: 2.4,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => o.root.destroy(),
    });

    this.orb = null;
    this.nextSpawnAt = this.scene.time.now + SPAWN_INTERVAL;

    this.onBreak?.(by);
  }

  /** 아무도 못 깨면 조용히 사라진다 */
  private escape(time: number): void {
    const o = this.orb;
    if (!o) return;
    o.dead = true;

    this.scene.tweens.killTweensOf(o.root);
    this.scene.tweens.killTweensOf(o.ring);
    this.scene.tweens.add({
      targets: o.root,
      y: o.root.y - 220,
      alpha: 0,
      duration: 700,
      ease: 'Quad.easeIn',
      onComplete: () => o.root.destroy(),
    });

    this.orb = null;
    this.nextSpawnAt = time + SPAWN_INTERVAL;
    this.announce('오브가 달아났다…', '#7f93bd');
  }

  /* ================================================================ */
  /* 연출 헬퍼                                                        */
  /* ================================================================ */

  private burst(x: number, y: number): void {
    for (let i = 0; i < 3; i++) {
      const ring = this.scene.add
        .circle(x, y, ORB_RADIUS)
        .setDepth(DEPTH.IMPACT);
      ring.isFilled = false;
      ring.setStrokeStyle(5, 0xf472b6, 0.9);

      this.scene.tweens.add({
        targets: ring,
        scale: 4 + i,
        alpha: 0,
        duration: 420 + i * 130,
        ease: 'Cubic.easeOut',
        onComplete: () => ring.destroy(),
      });
    }
  }

  private announce(text: string, color: string): void {
    const label = this.scene.add
      .text(GAME.WIDTH / 2, 150, text, {
        fontFamily: GAME.FONT,
        fontSize: '30px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0);
    label.setStroke('#0b1020', 7);

    this.scene.tweens.add({
      targets: label,
      scale: { from: 1.6, to: 1 },
      duration: 280,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: label,
          alpha: 0,
          y: label.y - 24,
          delay: 900,
          duration: 300,
          onComplete: () => label.destroy(),
        });
      },
    });
  }

  reset(): void {
    if (this.orb) {
      this.scene.tweens.killTweensOf(this.orb.root);
      this.scene.tweens.killTweensOf(this.orb.ring);
      this.orb.root.destroy();
      this.orb = null;
    }
    this.fighters = [];
  }
}

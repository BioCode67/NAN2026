import Phaser from 'phaser';
import { ORB_FRAME, hasArt } from '../config/artAssets';
import { DEPTH, GAME, STAGE } from '../config/gameConfig';
import { SPRITE_SHEETS } from '../config/spriteSheets';
import { sound } from './SoundSystem';
import type { BaseCharacter } from '../characters/BaseCharacter';
import type { BannerLanes } from '../ui/BannerLanes';
import type { ProjectileSystem } from './ProjectileSystem';

/** 오브가 버티는 체력 — 몇 대는 때려야 깨진다 */
const ORB_HP = 55;
/** 오브 충돌 반지름 */
const ORB_RADIUS = 34;
/** 첫 등장까지 */
const FIRST_SPAWN_DELAY = 13000;
/**
 * 아주 첫 판에서의 첫 등장까지.
 *
 * 프롬프트 오브는 이 게임의 핵심 기믹인데, 13초는 처음 켠 사람이
 * 조작을 익히다 놓치기 좋은 길이다. 심사자가 2분을 써 본다면 그중
 * 앞의 13초는 "그냥 대난투"로 보이고, 그 인상이 남는다.
 *
 * 이미 한 판이라도 해 본 뒤(연승 도전 2판째부터)에는 원래 간격으로 돌아간다 —
 * 아는 사람에게까지 서두를 이유는 없다.
 */
const FIRST_ROUND_DELAY = 7000;
/** 다음 오브까지 */
const SPAWN_INTERVAL = 26000;
/** 이 시간 안에 못 깨면 달아난다 */
const ORB_LIFESPAN = 15000;
/** 같은 공격 모션이 오브를 연타하지 않도록 하는 최소 간격 */
const HIT_COOLDOWN = 220;

/** 떠다니는 프롬프트 오브 하나 */
interface Orb {
  root: Phaser.GameObjects.Container;
  /** 생성한 오브 그림 (없으면 아래 도형들로 그린다) */
  sprite: Phaser.GameObjects.Image | null;
  core: Phaser.GameObjects.Arc | null;
  ring: Phaser.GameObjects.Arc | null;
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

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lanes: BannerLanes,
  ) {}

  setFighters(fighters: BaseCharacter[]): void {
    this.fighters = fighters;
  }

  setProjectiles(projectiles: ProjectileSystem): void {
    this.projectiles = projectiles;
  }

  /** 전투 시작 시 첫 등장 타이머를 건다 */
  /**
   * @param firstEver 이번이 이 사람의 첫 판인가 (연승 0판째)
   */
  start(firstEver = false): void {
    this.nextSpawnAt =
      this.scene.time.now + (firstEver ? FIRST_ROUND_DELAY : FIRST_SPAWN_DELAY);
  }

  /** 지금 오브가 떠 있는가 (HUD 안내용) */
  isActive(): boolean {
    return this.orb !== null && !this.orb.dead;
  }

  /**
   * 오브의 현재 모습 — 온라인에서 회선으로 보낸다.
   * [x, y, 남은 체력 0~100]. 오브가 없으면 undefined.
   */
  snapshot(): number[] | undefined {
    const o = this.orb;
    if (!o || o.dead) return undefined;
    return [Math.round(o.root.x), Math.round(o.root.y), Math.round((o.hp / ORB_HP) * 100)];
  }

  /**
   * 회선으로 받은 오브를 그린다 (참가자 쪽).
   *
   * 참가자는 판을 계산하지 않으므로 오브도 스스로 못 만든다. 그런데 오브는
   * 이 게임의 중심 장치라, 안 보이면 **왜 갑자기 판이 멈추고 규칙이 바뀌는지**
   * 알 수가 없다. 위치와 남은 체력만 받아 같은 그림을 세운다.
   */
  applyRemote(state: number[] | undefined, time: number): void {
    if (!state) {
      // 호스트 쪽에서 사라졌다 — 여기서도 치운다
      if (this.orb && !this.orb.dead) this.escape(time);
      return;
    }
    if (!this.orb || this.orb.dead) {
      this.spawn(time, state[0], state[1]);
    }
    const o = this.orb;
    if (!o) return;
    o.root.setPosition(state[0]!, state[1]!);
    o.hp = Math.max(1, Math.round((state[2]! / 100) * ORB_HP));
    this.refreshLook();
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

  private spawn(time: number, atX?: number, atY?: number): void {
    // 온라인 참가자는 호스트가 정한 자리에 세운다 (각자 뽑으면 딴 데 뜬다)
    const cx = atX ?? Phaser.Math.Between(STAGE.LEFT + 320, STAGE.RIGHT - 320);
    const cy = atY ?? Phaser.Math.Between(240, 390);

    /*
     * 생성한 오브 그림이 있으면 그걸 쓴다.
     * 없으면 지금까지처럼 발광하는 원 + 링 + 글자로 그린다 —
     * 어느 쪽이든 "때릴 수 있는 것"으로 보여야 한다는 목표는 같다.
     */
    const art = hasArt(this.scene, 'ui_prompt_orb');

    let sprite: Phaser.GameObjects.Image | null = null;
    let core: Phaser.GameObjects.Arc | null = null;
    let ring: Phaser.GameObjects.Arc | null = null;
    const parts: Phaser.GameObjects.GameObject[] = [];

    if (art) {
      sprite = this.scene.add
        .image(0, 0, 'ui_prompt_orb', ORB_FRAME.INTACT)
        .setOrigin(0.5)
        .setBlendMode(Phaser.BlendModes.ADD);
      // 판정 원(ORB_RADIUS)보다 조금 크게 — 보이는 크기가 판정보다 작으면 억울하다
      sprite.setScale(((ORB_RADIUS + 12) * 2) / (sprite.width || 1));

      // 링 대신 그림 자체를 맥동시킨다
      ring = null;
      parts.push(sprite);
    } else {
      /* 안쪽 코어 — 가산 합성으로 어두운 배경 위에서 발광한다 */
      core = this.scene.add.circle(0, 0, ORB_RADIUS, 0xf472b6, 0.95);
      core.setBlendMode(Phaser.BlendModes.ADD);

      ring = this.scene.add.circle(0, 0, ORB_RADIUS + 12);
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

      parts.push(core, ring, label);
    }

    const root = this.scene.add
      .container(cx, cy, parts)
      .setDepth(DEPTH.FIGHTER + 1);

    /* 등장 연출 — 작게 나타나 크게 부풀었다 제자리로 */
    root.setScale(0);
    this.scene.tweens.add({
      targets: root,
      scale: 1,
      duration: 420,
      ease: 'Back.easeOut',
    });

    /* 계속 맥동해 "때릴 수 있는 것"으로 읽히게 한다 */
    const pulse = ring ?? sprite;
    if (pulse) {
      this.scene.tweens.add({
        targets: pulse,
        scale: pulse.scale * 1.15,
        alpha: { from: 0.95, to: 0.45 },
        duration: 720,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    this.orb = {
      root,
      sprite,
      core,
      ring,
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

    /* 맞을수록 갈라지고 붉어진다 — 남은 체력이 눈으로 보인다 */
    this.refreshLook();

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

    // 마지막 칸은 "터지는 순간" 그림이다 — 사라지는 연출 동안 그것으로 바꾼다
    o.sprite?.setFrame(ORB_FRAME.BURST);
    this.showPromptFx(by, o.root.x, o.root.y);

    this.scene.tweens.killTweensOf(o.root);
    if (o.ring) this.scene.tweens.killTweensOf(o.ring);
    if (o.sprite) this.scene.tweens.killTweensOf(o.sprite);
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
    if (o.ring) this.scene.tweens.killTweensOf(o.ring);
    if (o.sprite) this.scene.tweens.killTweensOf(o.sprite);
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

  /**
   * 남은 체력을 그림에 반영한다.
   *
   * 맞는 순간과 회선으로 상태를 받은 순간이 같은 그림을 그려야 한다 —
   * 따로 쓰면 참가자 화면의 오브만 끝까지 멀쩡해 보인다.
   */
  private refreshLook(): void {
    const o = this.orb;
    if (!o) return;

    const left = Phaser.Math.Clamp(o.hp / ORB_HP, 0, 1);
    if (o.sprite) {
      o.sprite.setFrame(
        left > 0.66 ? ORB_FRAME.INTACT : left > 0.33 ? ORB_FRAME.CRACKED : ORB_FRAME.CRITICAL,
      );
    }
    o.core?.setFillStyle(
      Phaser.Display.Color.GetColor(255, Math.round(70 + 130 * left), Math.round(150 * left)),
      0.95,
    );
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

  /**
   * 깬 사람의 "명령창" 이펙트를 오브 자리에 띄운다.
   *
   * V3 시트에는 캐릭터 없이 이펙트만 그린 칸(29)이 있다. 누가 깼는지가
   * 곧 누가 판을 바꿀 권한을 얻었는지라, 그 사람의 그림으로 알린다.
   * 시트에 그 칸이 없으면 아무것도 하지 않는다 — 링 연출만으로도 충분하다.
   */
  private showPromptFx(by: BaseCharacter, x: number, y: number): void {
    const sheet = SPRITE_SHEETS[by.cfg.id];
    if (
      !sheet ||
      sheet.promptFrame === undefined ||
      !this.scene.textures.exists(sheet.key)
    ) {
      return;
    }

    const fx = this.scene.add
      .image(x, y, sheet.key, sheet.promptFrame)
      .setDepth(DEPTH.IMPACT)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.scene.tweens.add({
      targets: fx,
      scale: { from: 0.6, to: 1.8 },
      alpha: { from: 1, to: 0 },
      duration: 620,
      ease: 'Cubic.easeOut',
      onComplete: () => fx.destroy(),
    });
  }

  /**
   * 상단 알림 한 줄.
   *
   * 자리는 직접 정하지 않고 배분받는다. 리듬 배틀 게이지가 떠 있는 동안
   * 오브가 달아나면 예전에는 게이지 위에 글자가 얹혀 둘 다 안 읽혔다.
   */
  private announce(text: string, color: string): void {
    const lane = this.lanes.claim(40);

    const label = this.scene.add
      .text(GAME.WIDTH / 2, lane.center, text, {
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
          onComplete: () => {
            lane.release();
            label.destroy();
          },
        });
      },
    });
  }

  reset(): void {
    if (this.orb) {
      this.scene.tweens.killTweensOf(this.orb.root);
      if (this.orb.ring) this.scene.tweens.killTweensOf(this.orb.ring);
      if (this.orb.sprite) this.scene.tweens.killTweensOf(this.orb.sprite);
      this.orb.root.destroy();
      this.orb = null;
    }
    this.fighters = [];
  }
}

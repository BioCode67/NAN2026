import Phaser from 'phaser';
import { DEPTH, FIGHTER, IMPACT } from '../config/gameConfig';
import { SPRITE_SHEETS, animKey, metaKey, resolvePose } from '../config/spriteSheets';
import type { Pose, SheetMeta, SpriteSheetDef } from '../config/spriteSheets';
import { ARM_X, buildFighterArt } from './CharacterArt';
import type { FighterArt } from './CharacterArt';
import type { AttackConfig, CharacterConfig } from '../types';

/**
 * 파이터의 겉모습을 담당하는 뷰.
 *
 * 구현이 두 가지다.
 *  - SpriteView: 스프라이트 시트가 준비된 캐릭터
 *  - ShapeView : 아직 시트가 없어 코드로 그린 도형 아트를 쓰는 캐릭터
 *
 * BaseCharacter는 이 인터페이스만 알면 되므로,
 * 캐릭터별 시트를 추가해도 전투 로직은 손대지 않는다.
 */
export interface FighterView {
  /** visual 컨테이너에 넣을 표시 객체들 */
  readonly parts: Phaser.GameObjects.GameObject[];
  /** 포즈 지정 (같은 포즈 반복 호출은 무시된다) */
  setPose(pose: Pose): void;
  /** 시간 기반 모션 갱신 (도형 아트의 걷기 등) */
  update(time: number, onGround: boolean): void;
  /** 공격 모션 트리거 — 기술마다 팔이 다르게 움직인다 */
  triggerAttack(atk: AttackConfig, durationMs: number): void;
  /** 피격 흰색 점멸 */
  flash(): void;
  /** 상장폐지 — 회색으로 식는다 */
  setDefeated(): void;
  destroy(): void;
}

/* ================================================================== */
/* 스프라이트 시트 기반                                                */
/* ================================================================== */

/**
 * 기술 하나가 몸으로 그리는 궤적.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 15프레임 시트에는 공격 그림이 두 장(약·강)뿐이다. 커맨드는 열넷인데
 * 그림은 둘이라, 상단기도 하단기도 돌진기도 **같은 그림 한 장**이 뜬다.
 * 기술 이름과 피해량만 다르고 보이는 것은 같으니 "계속 같은 동작만 한다"가
 * 된다. 실제로 그렇다.
 *
 * 그래서 그림 대신 **몸의 움직임**으로 가른다. 위로 치는 기술은 몸이 솟구쳐
 * 뒤로 젖혀지고, 내려찍는 기술은 낮게 깔리고, 돌진기는 크게 기울며 잔상을
 * 남긴다. 같은 그림 한 장이어도 전혀 다른 동작으로 읽힌다.
 *
 * 42프레임 시트가 들어오면 이 움직임이 그 그림 위에 그대로 얹혀 더 살아난다.
 * 버리는 작업이 아니다.
 */
interface Motion {
  /** 앞으로(양수) 나가는 거리 — 컨테이너가 방향에 따라 뒤집어 준다 */
  dx: number;
  /** 위(음수) / 아래(양수) */
  dy: number;
  /** 기울기(도). 양수면 앞으로 숙인다 */
  angle: number;
  /** 가로/세로 늘이기 */
  sx: number;
  sy: number;
  /** 한 바퀴 돈다 (회전 기술) */
  spin?: boolean;
  /** 남길 잔상 수 */
  ghosts: number;
}

const NO_MOTION: Motion = { dx: 0, dy: 0, angle: 0, sx: 1, sy: 1, ghosts: 0 };

/**
 * 기술의 성격에서 궤적을 정한다.
 *
 * 캐릭터마다 표를 따로 두지 않는다. 판정이 어디에 서는지(hitAnchor)와
 * 어떤 이펙트를 쓰는지(fx)는 이미 기술마다 정해져 있으므로, 거기서 끌어내면
 * 캐릭터를 추가해도 저절로 따라온다.
 */
function motionFor(atk: AttackConfig): Motion {
  const anchor = atk.hitAnchor ?? 'front';
  const heavy = atk.type !== 'light';

  /* 도는 기술 — 한 바퀴 */
  if (atk.fx === 'spin' || anchor === 'around') {
    return { dx: 0, dy: -4, angle: 0, sx: 1.08, sy: 1.02, spin: true, ghosts: 4 };
  }

  /* 위로 쳐올리는 기술 — 몸이 솟구치며 뒤로 젖혀진다 */
  if (atk.fx === 'rising' || anchor === 'up') {
    return { dx: 2, dy: -24, angle: -24, sx: 0.94, sy: 1.14, ghosts: 3 };
  }

  /* 내려찍는 기술 — 낮게 깔리거나 앞으로 처박는다 */
  if (atk.fx === 'slam' || anchor === 'down') {
    // 공중 급강하는 앞으로 곤두박질친다. 지상 하단기는 몸을 낮춘다
    const dive = atk.slot === 'airDive';
    return dive
      ? { dx: 10, dy: 16, angle: 42, sx: 1.06, sy: 1.06, ghosts: 5 }
      : { dx: 8, dy: 12, angle: 10, sx: 1.14, sy: 0.8, ghosts: 2 };
  }

  /* 돌진기 — 몸을 크게 기울여 밀고 들어간다 */
  if (atk.slot === 'dashAttack') {
    return { dx: 28, dy: 2, angle: 20, sx: 1.16, sy: 0.94, ghosts: 5 };
  }

  /* 스킬 — 크게 젖혔다 내지른다 */
  if (atk.type === 'skill') {
    return { dx: 12, dy: -10, angle: -8, sx: 1.12, sy: 1.08, ghosts: 4 };
  }

  /* 찌르기 — 앞으로 쭉 늘어난다 */
  if (atk.fx === 'thrust') {
    return { dx: 22, dy: 0, angle: 6, sx: 1.18, sy: 0.96, ghosts: heavy ? 3 : 1 };
  }

  /*
   * 연속기는 타마다 각도를 바꾼다.
   * 1타 · 2타 · 3타가 같은 각도로 나가면 세 번 친 것이 아니라
   * 한 번을 세 번 되감은 것으로 보인다.
   */
  switch (atk.chainStep) {
    case 2:
      return { dx: 12, dy: -4, angle: -12, sx: 1.06, sy: 1.04, ghosts: 1 };
    case 3:
      return { dx: 20, dy: 2, angle: 18, sx: 1.14, sy: 0.98, ghosts: 3 };
  }

  return heavy
    ? { dx: 16, dy: -2, angle: 14, sx: 1.1, sy: 1.02, ghosts: 2 }
    : { dx: 9, dy: -2, angle: 7, sx: 1.04, sy: 1.02, ghosts: 0 };
}

class SpriteView implements FighterView {
  readonly parts: Phaser.GameObjects.GameObject[];

  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly def: SpriteSheetDef;
  private current: Pose | null = null;

  /** 공격 전 자세 — 모션이 끝나면 여기로 돌아온다 */
  private readonly homeX = 0;
  private readonly homeY: number;
  private readonly homeScaleX: number;
  private readonly homeScaleY: number;

  constructor(
    private readonly scene: Phaser.Scene,
    def: SpriteSheetDef,
    meta: SheetMeta,
  ) {
    this.def = def;

    // 원점을 발끝(아래 중앙)에 두면 물리 바디 바닥과 정확히 맞물린다
    this.sprite = scene.add.sprite(0, FIGHTER.BODY_H / 2, def.key, 0);
    this.sprite.setOrigin(0.5, 1);

    const scale = def.displayHeight / meta.frameHeight;
    this.sprite.setScale(scale);
    if (def.footOffset) this.sprite.y += def.footOffset;

    // 시트가 왼쪽을 보고 그려졌다면 기본 방향을 뒤집는다
    if (def.facesLeft) this.sprite.setFlipX(true);

    this.homeY = this.sprite.y;
    this.homeScaleX = this.sprite.scaleX;
    this.homeScaleY = this.sprite.scaleY;

    this.parts = [this.sprite];
    this.setPose('idle');
  }

  setPose(pose: Pose): void {
    if (pose === this.current) return;

    // 시트에 없는 포즈는 대체 사슬(상단기 → 기본 약공격 …)을 따라 내려간다
    const resolved = resolvePose(this.def.poses, pose);
    if (!resolved) return;
    this.current = pose;

    if (typeof resolved.frames === 'number') {
      this.sprite.anims.stop();
      this.sprite.setFrame(resolved.frames);
      return;
    }

    // 애니메이션 키는 대체된 포즈 이름으로 등록되어 있다
    const key = animKey(this.def.key, resolved.pose);
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
    else this.sprite.setFrame(resolved.frames[0] ?? 0);
  }

  update(): void {
    // 스프라이트는 Phaser 애니메이션이 알아서 갱신한다
  }

  /**
   * 기술을 몸으로 그린다.
   *
   * 뻗을 때는 빠르게(35%), 돌아올 때는 느리게(65%). 사람이 힘을 쓰는 순서가
   * 그렇고, 그렇게 해야 "쳤다"가 읽힌다. 같은 시간을 반으로 나누면
   * 왔다 갔다 하는 인형처럼 보인다.
   */
  triggerAttack(atk: AttackConfig, durationMs: number): void {
    const m = motionFor(atk);
    if (m === NO_MOTION) return;

    const total = Math.max(180, durationMs);
    const out = total * 0.35;
    const back = total * 0.65;

    const s = this.sprite;
    this.scene.tweens.killTweensOf(s);
    this.resetMotion();

    if (m.ghosts > 0) this.spawnGhosts(m.ghosts, out);

    if (m.spin) {
      // 회전은 되돌아올 것이 없다 — 한 바퀴 돌고 0도에서 끝난다
      s.angle = 0;
      this.scene.tweens.add({
        targets: s,
        angle: 360,
        duration: total,
        ease: 'Cubic.easeOut',
        onComplete: () => this.resetMotion(),
      });
    } else {
      this.scene.tweens.add({
        targets: s,
        x: this.homeX + m.dx,
        y: this.homeY + m.dy,
        angle: m.angle,
        duration: out,
        ease: 'Quad.easeOut',
        onComplete: () => {
          if (!s.active) return;
          this.scene.tweens.add({
            targets: s,
            x: this.homeX,
            y: this.homeY,
            angle: 0,
            duration: back,
            ease: 'Back.easeOut',
          });
        },
      });
    }

    /* 늘어났다 돌아오는 것은 따로 — 각도와 리듬이 달라야 몸이 살아난다 */
    this.scene.tweens.add({
      targets: s,
      scaleX: this.homeScaleX * m.sx,
      scaleY: this.homeScaleY * m.sy,
      duration: out,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /** 공격 전 자세로 되돌린다 */
  private resetMotion(): void {
    const s = this.sprite;
    if (!s.active) return;
    s.setPosition(this.homeX, this.homeY);
    s.setAngle(0);
    s.setScale(this.homeScaleX, this.homeScaleY);
  }

  /**
   * 잔상 — 지나간 자리에 흐릿한 자기 모습을 남긴다.
   *
   * 빠른 동작은 프레임 사이에서 사라진다. 60프레임에서 12프레임짜리 돌진은
   * 눈에 "한 번 번쩍"으로만 남는다. 지나온 자리를 잠깐 남겨 두면
   * 어디서 어디로 갔는지가 보이고, 그게 곧 속도감이 된다.
   *
   * 시트 그림을 그대로 복제하므로 어떤 캐릭터에도 통한다.
   */
  private spawnGhosts(count: number, spanMs: number): void {
    const gap = spanMs / count;

    for (let i = 0; i < count; i++) {
      this.scene.time.delayedCall(gap * i, () => {
        const src = this.sprite;
        if (!src.active) return;

        // 컨테이너 안에 있으므로 화면 기준 위치·크기를 직접 뽑아 온다
        const mat = src.getWorldTransformMatrix();
        const d = mat.decomposeMatrix() as {
          translateX: number;
          translateY: number;
          scaleX: number;
          scaleY: number;
          rotation: number;
        };

        const ghost = this.scene.add
          .image(d.translateX, d.translateY, src.texture.key, src.frame.name)
          .setOrigin(src.originX, src.originY)
          .setScale(d.scaleX, d.scaleY)
          .setRotation(d.rotation)
          .setFlipX(src.flipX)
          .setDepth(DEPTH.FIGHTER - 1)
          .setAlpha(0.38)
          /*
           * 가산 합성(ADD)은 쓰지 않는다. 밝은 캐릭터가 하얗게 날아가
           * 잔상이 아니라 유령 덩어리로 보인다 — 실제로 그렇게 나왔다.
           * 색만 푸르게 눌러 두면 형태가 남아 궤적으로 읽힌다.
           */
          .setTint(0x7aa2e8);

        this.scene.tweens.add({
          targets: ghost,
          alpha: 0,
          duration: 190,
          onComplete: () => ghost.destroy(),
        });
      });
    }
  }

  flash(): void {
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(IMPACT.FLASH_MS, () => {
      if (this.sprite.active) this.sprite.clearTint();
    });
  }

  setDefeated(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.resetMotion();
    this.sprite.anims.stop();
    this.sprite.setTint(0x6b7280);
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.destroy();
  }
}

/* ================================================================== */
/* 코드로 그린 도형 아트 기반                                          */
/* ================================================================== */

class ShapeView implements FighterView {
  readonly parts: Phaser.GameObjects.GameObject[];

  private readonly art: FighterArt;
  private readonly baseColors: number[];
  private readonly armHomeY: number;
  private readonly legHomeY: number;
  private pose: Pose = 'idle';

  constructor(
    private readonly scene: Phaser.Scene,
    cfg: CharacterConfig,
  ) {
    this.art = buildFighterArt(scene, cfg);
    this.baseColors = this.art.flashParts.map((p) => p.fillColor);
    this.armHomeY = this.art.armFront.y;
    this.legHomeY = this.art.legL.y;
    this.parts = this.art.parts;
  }

  setPose(pose: Pose): void {
    this.pose = pose;
  }

  /**
   * 걷기/공중 자세.
   * 지상에서 이동 중이면 다리를 번갈아 흔들고,
   * 공중에서는 다리를 살짝 모아 점프 자세를 만든다.
   */
  update(time: number, onGround: boolean): void {
    const { legL, legR, armBack } = this.art;
    const moving = this.pose === 'walk' || this.pose === 'run' || this.pose === 'dash';

    if (onGround && moving) {
      const swing = Math.sin(time * 0.022) * 4;
      legL.y = this.legHomeY + swing;
      legR.y = this.legHomeY - swing;
      armBack.y = this.armHomeY - swing * 0.5;
      return;
    }

    const lift = onGround ? 0 : 4;
    legL.y = this.legHomeY - lift;
    legR.y = this.legHomeY - lift * 0.5;
    armBack.y = this.armHomeY;
  }

  /**
   * 앞팔을 뻗었다 되돌린다.
   *
   * 뻗는 방향은 히트박스 위치를 그대로 따라간다.
   * 시트가 없는 캐릭터도 상단기·하단기·광역기가 눈으로 구분되어야
   * 커맨드를 나눈 의미가 살아난다.
   */
  triggerAttack(atk: AttackConfig, durationMs: number): void {
    const arm = this.art.armFront;
    const reach = atk.type === 'light' ? 20 : 30;

    /* 히트박스가 놓이는 자리로 팔을 보낸다 */
    let dx = reach;
    let dy = -6;
    switch (atk.hitAnchor ?? 'front') {
      case 'up':
        dx = reach * 0.35;
        dy = -38;
        break;
      case 'down':
        dx = reach * 1.15;
        dy = 22;
        break;
      case 'around':
        // 몸을 돌리는 기술 — 팔을 크게 벌린다
        dx = reach * 1.3;
        dy = 6;
        break;
    }

    /*
     * 손에 든 것도 함께 보낸다.
     *
     * 무기 컨테이너는 팔과 같은 자리에서 시작하므로 목표 좌표도 같다.
     * 팔만 뻗으면 무기가 제자리에 남아 손에서 빠진 것처럼 보인다.
     */
    const targets: Phaser.GameObjects.GameObject[] = [arm];
    const prop = this.art.handProp;
    if (prop) targets.push(prop);

    this.scene.tweens.killTweensOf(targets);
    arm.setPosition(ARM_X, this.armHomeY);
    prop?.setPosition(ARM_X, this.armHomeY);

    this.scene.tweens.add({
      targets,
      x: ARM_X + dx,
      y: this.armHomeY + dy,
      duration: Math.max(60, durationMs * 0.5),
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  flash(): void {
    this.art.flashParts.forEach((p) => p.setFillStyle(0xffffff));
    this.scene.time.delayedCall(IMPACT.FLASH_MS, () => {
      const parts = this.art.flashParts;
      if (!parts[0]?.active) return;
      parts.forEach((p, i) => p.setFillStyle(this.baseColors[i]));
    });
  }

  setDefeated(): void {
    this.art.flashParts.forEach((p) => p.setFillStyle(0x5b6577));
  }

  destroy(): void {
    this.art.parts.forEach((p) => p.destroy());
  }
}

/* ================================================================== */

/**
 * 캐릭터에 맞는 뷰를 만든다.
 * 스프라이트 시트가 등록되어 있고 실제로 로드됐으면 SpriteView,
 * 아니면 도형 아트(ShapeView)로 자동 대체한다.
 */
export function createFighterView(
  scene: Phaser.Scene,
  cfg: CharacterConfig,
): FighterView {
  const def = SPRITE_SHEETS[cfg.id];

  if (def && scene.textures.exists(def.key)) {
    const meta = scene.cache.json.get(metaKey(def.key)) as SheetMeta | undefined;
    if (meta) return new SpriteView(scene, def, meta);
  }

  return new ShapeView(scene, cfg);
}

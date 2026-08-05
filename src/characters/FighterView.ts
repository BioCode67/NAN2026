import Phaser from 'phaser';
import { FIGHTER, IMPACT } from '../config/gameConfig';
import { SPRITE_SHEETS, animKey, metaKey } from '../config/spriteSheets';
import type { Pose, SheetMeta, SpriteSheetDef } from '../config/spriteSheets';
import { ARM_X, buildFighterArt } from './CharacterArt';
import type { FighterArt } from './CharacterArt';
import type { AttackType, CharacterConfig } from '../types';

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
  /** 공격 모션 트리거 */
  triggerAttack(type: AttackType, durationMs: number): void;
  /** 피격 흰색 점멸 */
  flash(): void;
  /** 상장폐지 — 회색으로 식는다 */
  setDefeated(): void;
  destroy(): void;
}

/* ================================================================== */
/* 스프라이트 시트 기반                                                */
/* ================================================================== */

class SpriteView implements FighterView {
  readonly parts: Phaser.GameObjects.GameObject[];

  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly def: SpriteSheetDef;
  private current: Pose | null = null;

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

    this.parts = [this.sprite];
    this.setPose('idle');
  }

  setPose(pose: Pose): void {
    if (pose === this.current) return;

    // 시트에 없는 포즈는 idle로 대체
    const frames = this.def.poses[pose] ?? this.def.poses.idle;
    if (frames === undefined) return;
    this.current = pose;

    if (typeof frames === 'number') {
      this.sprite.anims.stop();
      this.sprite.setFrame(frames);
      return;
    }

    const key = animKey(this.def.key, pose);
    if (this.scene.anims.exists(key)) this.sprite.play(key, true);
    else this.sprite.setFrame(frames[0] ?? 0);
  }

  update(): void {
    // 스프라이트는 Phaser 애니메이션이 알아서 갱신한다
  }

  triggerAttack(): void {
    // 공격 모션은 setPose가 담당한다
  }

  flash(): void {
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(IMPACT.FLASH_MS, () => {
      if (this.sprite.active) this.sprite.clearTint();
    });
  }

  setDefeated(): void {
    this.sprite.anims.stop();
    this.sprite.setTint(0x6b7280);
  }

  destroy(): void {
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

  /** 앞팔을 쭉 뻗었다 되돌린다 */
  triggerAttack(type: AttackType, durationMs: number): void {
    const arm = this.art.armFront;
    this.scene.tweens.killTweensOf(arm);
    arm.setPosition(ARM_X, this.armHomeY);
    this.scene.tweens.add({
      targets: arm,
      x: ARM_X + (type === 'light' ? 20 : 30),
      y: this.armHomeY - 6,
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

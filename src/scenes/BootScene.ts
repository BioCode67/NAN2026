import Phaser from 'phaser';
import { GAME } from '../config/gameConfig';
import { SHEET_DEFS, animKey, metaKey } from '../config/spriteSheets';
import type { Pose, SheetMeta } from '../config/spriteSheets';

/**
 * 리소스 로딩 씬.
 *
 * 아직 외부 에셋이 없으므로 파티클용 텍스처를 코드로 생성한다.
 * (이미지/사운드가 추가되면 preload()에 넣기만 하면 진행바가 자동으로 동작한다)
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'Boot' });
  }

  preload(): void {
    this.buildLoadingUI();

    /*
     * 1단계: 스프라이트 시트 메타데이터.
     * 프레임 크기가 캐릭터마다 다르므로 시트를 로드하기 전에 먼저 읽어야 한다.
     * (메타는 tools/process-sheet.mjs 가 PNG와 함께 생성한다)
     */
    for (const def of SHEET_DEFS) {
      this.load.json(metaKey(def.key), `sprites/${def.key}.json`);
    }
  }

  create(): void {
    this.generateTextures();
    this.loadSpriteSheets();
  }

  /** 2단계: 메타를 읽어 실제 시트를 로드하고 애니메이션을 등록한다 */
  private loadSpriteSheets(): void {
    let queued = 0;

    for (const def of SHEET_DEFS) {
      const meta = this.cache.json.get(metaKey(def.key)) as SheetMeta | undefined;
      if (!meta) {
        console.warn(`[Boot] ${def.key} 메타데이터를 찾지 못해 도형 아트로 대체합니다.`);
        continue;
      }

      this.load.spritesheet(def.key, `sprites/${def.key}.png`, {
        frameWidth: meta.frameWidth,
        frameHeight: meta.frameHeight,
      });
      queued++;
    }

    if (queued === 0) {
      this.scene.start('Select');
      return;
    }

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.registerAnimations();
      this.scene.start('Select');
    });
    this.load.start();
  }

  /** 여러 프레임짜리 포즈만 Phaser 애니메이션으로 등록한다 (단일 프레임은 setFrame으로 충분) */
  private registerAnimations(): void {
    for (const def of SHEET_DEFS) {
      if (!this.textures.exists(def.key)) continue;

      for (const [pose, frames] of Object.entries(def.poses)) {
        if (!Array.isArray(frames) || frames.length < 2) continue;

        const key = animKey(def.key, pose as Pose);
        if (this.anims.exists(key)) continue;

        // 달리기만 반복하고 나머지(스킬 등)는 1회 재생 후 마지막 프레임 유지
        const looping = pose === 'run' || pose === 'walk';

        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(def.key, { frames }),
          frameRate: def.frameRate ?? 9,
          repeat: looping ? -1 : 0,
        });
      }
    }
  }

  /* ---------------------------------------------------------------- */

  /** 로딩 진행바 */
  private buildLoadingUI(): void {
    const cx = GAME.WIDTH / 2;
    const cy = GAME.HEIGHT / 2;

    this.add
      .text(cx, cy - 70, '상장폐지 대난투', {
        fontFamily: GAME.FONT,
        fontSize: '38px',
        color: '#e8eeff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(cx, cy - 28, 'DELISTING BRAWL', {
        fontFamily: GAME.FONT,
        fontSize: '14px',
        color: '#6c86c4',
      })
      .setOrigin(0.5);

    const barW = 420;
    const barH = 14;

    this.add
      .rectangle(cx, cy + 40, barW, barH, 0x1a2440)
      .setStrokeStyle(2, 0x2f3f6b);

    const fill = this.add
      .rectangle(cx - barW / 2 + 2, cy + 40, 0, barH - 4, 0x4ade80)
      .setOrigin(0, 0.5);

    const pct = this.add
      .text(cx, cy + 70, '0%', {
        fontFamily: GAME.FONT,
        fontSize: '13px',
        color: '#8fa6d8',
      })
      .setOrigin(0.5);

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      fill.width = (barW - 4) * value;
      pct.setText(`${Math.round(value * 100)}%`);
    });
  }

  /**
   * 파티클용 텍스처를 코드로 생성한다.
   * 외부 이미지 없이도 임팩트/불꽃 이펙트가 동작하게 하기 위함.
   */
  private generateTextures(): void {
    /* spark — 4각 별 모양 (임팩트 파티클 · 떡상 불꽃) */
    if (!this.textures.exists('spark')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillPoints(
        [
          new Phaser.Geom.Point(8, 0),
          new Phaser.Geom.Point(10, 6),
          new Phaser.Geom.Point(16, 8),
          new Phaser.Geom.Point(10, 10),
          new Phaser.Geom.Point(8, 16),
          new Phaser.Geom.Point(6, 10),
          new Phaser.Geom.Point(0, 8),
          new Phaser.Geom.Point(6, 6),
        ],
        true,
      );
      g.generateTexture('spark', 16, 16);
      g.destroy();
    }

    /* pixel — 1x1 흰색. 선/바 등에 재활용 */
    if (!this.textures.exists('pixel')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 1, 1);
      g.generateTexture('pixel', 1, 1);
      g.destroy();
    }
  }
}

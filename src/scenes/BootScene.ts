import Phaser from 'phaser';
import {
  ART_IMAGES,
  ART_STRIPS,
  prepareOptionalArt,
  probeArt,
  queueOptionalArt,
} from '../config/artAssets';
import { GAME } from '../config/gameConfig';
import { SHEET_DEFS, animKey, applyLayout, metaKey } from '../config/spriteSheets';
import type { Pose, SheetMeta } from '../config/spriteSheets';

/**
 * 리소스 로딩 씬.
 *
 * 여기서 로드하는 것은 전부 **없어도 되는** 것들이다.
 * 캐릭터 시트도 배경도 UI 그림도, 없으면 코드로 그린 도형 아트로 돌아간다.
 * 그래서 로딩 실패를 오류로 다루지 않고 조용히 넘긴다.
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
    void this.loadArt();
  }

  /**
   * 2단계: 실제 그림을 불러온다.
   *
   * 먼저 무엇이 있는지 확인하고(probeArt) 있는 것만 로더에 건다.
   * 없는 것을 걸어도 게임은 돌아가지만 Phaser가 파일마다 console.error를
   * 찍어 콘솔이 빨개진다 — 아직 안 그린 그림은 오류가 아니다.
   */
  private async loadArt(): Promise<void> {
    const available = await probeArt([...ART_IMAGES, ...ART_STRIPS]);

    // 확인하는 사이 씬이 내려갔다면(새로고침 등) 더 진행하지 않는다
    if (!this.scene.isActive()) return;

    queueOptionalArt(this.load, available);
    const queued = available.length + this.queueSpriteSheets();

    if (queued === 0) {
      this.finish();
      return;
    }

    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.finish());
    this.load.start();
  }

  /** 메타가 있는 캐릭터 시트만 로더에 건다. 건 개수를 돌려준다 */
  private queueSpriteSheets(): number {
    let queued = 0;

    for (const def of SHEET_DEFS) {
      const meta = this.cache.json.get(metaKey(def.key)) as SheetMeta | undefined;
      if (!meta) {
        console.warn(`[Boot] ${def.key} 메타데이터를 찾지 못해 도형 아트로 대체합니다.`);
        continue;
      }

      /*
       * 어느 규격인지는 시트 자신이 알려준다.
       * 프레임 수만 보면 되므로, 새 시트를 폴더에 넣는 것만으로 갈아 끼워진다.
       */
      const count = meta.count ?? meta.columns * meta.rows;
      const version = applyLayout(def, count);
      console.info(`[Boot] ${def.key}: ${count}프레임 → ${version} 규격`);

      this.load.spritesheet(def.key, `sprites/${def.key}.png`, {
        frameWidth: meta.frameWidth,
        frameHeight: meta.frameHeight,
      });
      queued++;
    }
    return queued;
  }

  /** 로딩 완료 — 후처리를 끝내고 타이틀로 넘긴다 */
  private finish(): void {
    // 마젠타 제거·띠 자르기는 그림이 다 들어온 지금 한 번만 한다
    prepareOptionalArt(this);
    this.registerAnimations();
    this.scene.start('Title');
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

import Phaser from 'phaser';
import {
  ART_IMAGES,
  ART_STRIPS,
  prepareOptionalArt,
  probeArt,
  queueOptionalArt,
  resolveArtPath,
  jsonExists,
} from '../config/artAssets';
import { probeAudio } from '../config/audioAssets';
import { sound } from '../systems/SoundSystem';
import { GAME } from '../config/gameConfig';
import { SHEET_DEFS, animKey, applyLayout, metaKey } from '../config/spriteSheets';
import type { Pose, SheetMeta, SpriteSheetDef } from '../config/spriteSheets';

/** 그림과 메타가 둘 다 확인된 시트 하나 */
interface SheetSource {
  def: SpriteSheetDef;
  /** 실제로 쓸 그림 경로 (webp 우선) */
  png: string;
  /** 메타(JSON) 경로 */
  meta: string;
}

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
  }

  create(): void {
    this.generateTextures();
    void this.loadArt();
  }

  /**
   * 그림을 불러온다.
   *
   * 먼저 무엇이 있는지 확인하고(probeArt) 있는 것만 로더에 건다.
   * 없는 것을 걸어도 게임은 돌아가지만 Phaser가 파일마다 console.error를
   * 찍어 콘솔이 빨개진다 — 아직 안 그린 그림은 오류가 아니다.
   *
   * ── 왜 두 번에 나눠 부르는가 ──────────────────────────────────
   * 시트는 프레임 크기가 캐릭터마다 달라서, 그림을 걸기 전에 메타(JSON)를
   * 먼저 읽어야 한다. 그래서 1차로 메타와 배경류를, 2차로 시트를 건다.
   *
   * 스무 명 전원을 SPRITE_SHEETS 에 등록해 두었으므로(아직 안 그린 사람이
   * 대부분이다), 메타 역시 있는 것만 골라 걸어야 콘솔이 조용하다.
   */
  private async loadArt(): Promise<void> {
    /*
     * 소리 파일도 그림과 같이 찾는다.
     *
     * 소리는 Phaser 로더를 안 태운다 — AudioContext 가 첫 사용자 입력
     * 뒤에야 생기므로, 로더가 만든 것과 우리 ctx 가 서로 다른 세계에 있다.
     * 바이트만 받아 두고 ctx 가 생기는 순간 디코드하는 편이 단순하다.
     */
    const [available, sheets, audio] = await Promise.all([
      probeArt([...ART_IMAGES, ...ART_STRIPS]),
      this.findSheets(),
      probeAudio(),
    ]);

    if (audio.bgm.length || audio.sfx.length) {
      console.info(
        `[Boot] 소리 파일 — 곡 ${audio.bgm.length}개 · 효과음 ${audio.sfx.length}개 (나머지는 합성)`,
      );
      void sound.loadFiles(audio.bgm, audio.sfx);
    }

    // 확인하는 사이 씬이 내려갔다면(새로고침 등) 더 진행하지 않는다
    if (!this.scene.isActive()) return;

    queueOptionalArt(this.load, available);
    for (const s of sheets) this.load.json(metaKey(s.def.key), s.meta);

    if (!available.length && !sheets.length) {
      this.finish();
      return;
    }

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (!this.scene.isActive()) return;
      if (this.queueSpriteSheets(sheets) === 0) {
        this.finish();
        return;
      }
      this.load.once(Phaser.Loader.Events.COMPLETE, () => this.finish());
      // COMPLETE 처리 중에 다시 start 하면 로더가 꼬인다 — 한 틱 뒤로 미룬다
      this.time.delayedCall(0, () => this.load.start());
    });
    this.load.start();
  }

  /**
   * 그림과 메타가 **둘 다** 있는 시트만 골라낸다.
   *
   * 그림은 webp가 있으면 그쪽을 쓴다. 시트도 한 장에 1MB가 넘어
   * 배경과 같은 이유로 가벼운 판을 우선한다.
   */
  private async findSheets(): Promise<SheetSource[]> {
    const found = await Promise.all(
      SHEET_DEFS.map(async (def) => {
        const meta = `sprites/${def.key}.json`;
        const [png, hasMeta] = await Promise.all([
          resolveArtPath(`sprites/${def.key}.png`),
          jsonExists(meta),
        ]);
        return png && hasMeta ? { def, png, meta } : null;
      }),
    );
    return found.filter((s): s is SheetSource => s !== null);
  }

  /** 메타를 읽어 규격을 정하고 시트를 로더에 건다. 건 개수를 돌려준다 */
  private queueSpriteSheets(sheets: SheetSource[]): number {
    let queued = 0;

    for (const { def, png } of sheets) {
      const meta = this.cache.json.get(metaKey(def.key)) as SheetMeta | undefined;
      if (!meta) continue;

      /*
       * 어느 규격인지는 시트 자신이 알려준다.
       * 프레임 수와 묶음 번호만 보므로, 새 시트를 폴더에 넣는 것만으로 갈아 끼워진다.
       */
      const count = meta.count ?? meta.columns * meta.rows;
      const version = applyLayout(def, count, meta.batches);
      console.info(`[Boot] ${def.key}: ${count}프레임 → ${version} 규격`);

      this.load.spritesheet(def.key, png, {
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

        // 반복 동작만 돌리고 나머지(공격·스킬)는 1회 재생 후 마지막 프레임 유지
        const looping =
          pose === 'run' ||
          pose === 'walk' ||
          pose === 'idle' ||
          pose === 'taunt' ||
          pose === 'win';

        /*
         * 반복 동작은 느리게 돈다.
         *
         * 대기 두 장(들숨·날숨)을 공격과 같은 9fps 로 돌리면 숨쉬기가 아니라
         * 몸 떨림으로 보인다. 사람이 숨 쉬는 속도는 초당 반 번쯤이다.
         */
        const slow: Partial<Record<string, number>> = { idle: 1.6, taunt: 4, walk: 7, win: 3 };

        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(def.key, { frames }),
          frameRate: slow[pose] ?? def.frameRate ?? 9,
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

import Phaser from 'phaser';
import { addBackdrop, hasArt } from '../config/artAssets';
import { DEPTH, GAME } from '../config/gameConfig';
import { CHARACTER_ORDER } from '../config/characters';
import { MOVE_SLOTS } from '../config/gameConfig';
import { STAGES } from '../config/stages';
import { PadMenu } from '../systems/InputFrame';
import { sound } from '../systems/SoundSystem';

/**
 * 로고가 차지할 최대 크기 — 어떤 비율로 생성되든 여기에 맞춰 줄인다.
 * 폭만 재면 정사각형에 가깝게 나온 로고가 화면을 세로로 다 덮어버린다.
 */
const LOGO_MAX_W = 760;
const LOGO_MAX_H = 260;
const LOGO_Y = 250;

/**
 * 타이틀 씬 — 게임 시작 화면.
 *
 * 하는 일은 적다. 로고를 보여주고 아무 키나 누르면 캐릭터 선택으로 넘어간다.
 * 그런데도 따로 둔 이유는 두 가지다.
 *
 *  1. 첫 화면이 캐릭터 카드 다섯 장이면, 플레이어는 이 게임이 무엇인지
 *     모른 채 고르기부터 시작한다. 제목을 한 번 보여주고 넘어가야 한다.
 *  2. 오디오. 브라우저는 사용자 입력 전에 소리를 못 낸다. 여기서 아무 키나
 *     누르는 그 입력이 곧 오디오 잠금 해제라, 선택 화면부터 소리가 난다.
 *
 * 그림(ui_title_bg / ui_title_logo)이 없으면 글자로 그린 화면이 대신 뜬다.
 */
export class TitleScene extends Phaser.Scene {
  private leaving = false;
  private pads = new PadMenu();

  constructor() {
    super({ key: 'Title' });
  }

  create(): void {
    this.leaving = false;

    this.buildBackground();
    this.buildLogo();
    this.buildPrompt();
    this.buildFooter();
    this.bindInput();

    /*
     * 제목 화면은 첫 입력보다 먼저 뜨므로 이 시점에는 아직 소리를 켤 수 없다.
     * SoundSystem이 요청을 기억했다가 unlock 되는 순간 틀어 준다.
     * 선택 화면도 같은 menu 곡이라, 넘어가도 곡이 끊기지 않고 이어진다.
     */
    sound.startBgm('menu');

    this.cameras.main.fadeIn(420, 0, 0, 0);
  }

  /* ================================================================ */

  private buildBackground(): void {
    const art = addBackdrop(this, 'ui_title_bg', GAME.WIDTH, GAME.HEIGHT);
    if (art) {
      art.setDepth(DEPTH.BG);
      // 그림이 밝게 나와도 글자가 묻히지 않도록 어둡게 한 겹 덮는다
      this.add
        .rectangle(0, 0, GAME.WIDTH, GAME.HEIGHT, 0x040814, 0.35)
        .setOrigin(0)
        .setDepth(DEPTH.BG + 1);
      return;
    }

    /* 그림이 없을 때 — 코드로 그린 야경 */
    const KEY = 'title-bg';
    if (!this.textures.exists(KEY)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);

      /*
       * 하늘은 잘게 썬 그라데이션으로.
       *
       * 밴드 4장이면 경계선이 그대로 보여 계단무늬가 된다 — 첫 화면에서
       * 그 줄무늬 하나로 "프로그래머 아트"로 읽힌다. 36장이면 경계가
       * 사람 눈에서 사라지고, 같은 generateTexture 안이라 비용은 같다.
       */
      const STRIPS = 36;
      const top = Phaser.Display.Color.ValueToColor(0x05070f);
      const bottom = Phaser.Display.Color.ValueToColor(0x1a2748);
      for (let i = 0; i < STRIPS; i++) {
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(
          top,
          bottom,
          STRIPS - 1,
          i,
        );
        g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
        g.fillRect(0, i * (GAME.HEIGHT / STRIPS), GAME.WIDTH, GAME.HEIGHT / STRIPS + 1);
      }

      // 빌딩 실루엣 — 아래쪽에 낮게 깔아 가운데를 비운다.
      // 하늘 밴드보다 확실히 어두워야 실루엣으로 읽힌다
      g.setAlpha(0.9);
      g.fillStyle(0x04060d, 1);
      for (let x = 0; x < GAME.WIDTH; x += 58) {
        const h = Phaser.Math.Between(90, 240);
        g.fillRect(x, GAME.HEIGHT - h, 50, h);
      }

      // 창문 불빛
      g.setAlpha(0.35);
      for (let i = 0; i < 220; i++) {
        g.fillStyle(Phaser.Math.Between(0, 1) ? 0x4ade80 : 0xef4444, 1);
        g.fillRect(
          Phaser.Math.Between(0, GAME.WIDTH),
          Phaser.Math.Between(GAME.HEIGHT - 220, GAME.HEIGHT - 10),
          5,
          5,
        );
      }

      g.generateTexture(KEY, GAME.WIDTH, GAME.HEIGHT);
      g.destroy();
    }

    this.add.image(0, 0, KEY).setOrigin(0).setDepth(DEPTH.BG);
    this.addEmbers();
  }

  /**
   * 도시 야경 위로 느리게 떠오르는 불티.
   *
   * 이 화면에서 움직이는 것이 로고 숨쉬기와 글자 깜빡임뿐이었다 —
   * 심사가 처음 보는 5초가 거의 정지 화면이었다는 뜻이다. 주가 전광판의
   * 초록·빨강을 그대로 쓴 불티가 올라가면 화면이 살아 있고 주제도 남는다.
   */
  private addEmbers(): void {
    if (!this.textures.exists('spark')) return;
    this.add
      .particles(0, 0, 'spark', {
        x: { min: 0, max: GAME.WIDTH },
        y: GAME.HEIGHT + 10,
        lifespan: { min: 7000, max: 12000 },
        speedY: { min: -34, max: -14 },
        speedX: { min: -6, max: 6 },
        scale: { start: 0.34, end: 0 },
        alpha: { start: 0.55, end: 0 },
        quantity: 1,
        frequency: 420,
        tint: [0x4ade80, 0xef4444, 0xffd54a],
      })
      .setDepth(DEPTH.BG + 1);
  }

  private buildLogo(): void {
    let logo: Phaser.GameObjects.GameObject;

    if (hasArt(this, 'ui_title_logo')) {
      const img = this.add.image(GAME.WIDTH / 2, LOGO_Y, 'ui_title_logo');
      const src = img.texture.getSourceImage();
      // 화면을 넘지 않게 줄이기만 한다 (작게 나온 로고를 억지로 키우지는 않는다)
      img.setScale(
        Math.min(1, LOGO_MAX_W / (src.width || 1), LOGO_MAX_H / (src.height || 1)),
      );
      logo = img.setDepth(DEPTH.HUD);
    } else {
      const title = this.add
        .text(GAME.WIDTH / 2, LOGO_Y - 18, '상장폐지 대난투', {
          fontFamily: GAME.FONT,
          fontSize: '76px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.HUD);
      title.setStroke('#0b1020', 12);
      title.setShadow(0, 6, '#b91c1c', 18, false, true);

      this.add
        .text(GAME.WIDTH / 2, LOGO_Y + 42, 'DELISTING BRAWL', {
          fontFamily: GAME.FONT,
          fontSize: '20px',
          color: '#f87171',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.HUD);

      logo = title;
    }

    /* 아주 느리게 숨 쉬듯 — 정지 화면으로 보이지 않게 */
    this.tweens.add({
      targets: logo,
      scale: { from: 1, to: 1.03 },
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private buildPrompt(): void {
    const label = this.add
      .text(GAME.WIDTH / 2, 460, '아무 키나 눌러 시작', {
        fontFamily: GAME.FONT,
        fontSize: '24px',
        color: '#facc15',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);
    label.setStroke('#0b1020', 7);

    this.tweens.add({
      targets: label,
      alpha: { from: 1, to: 0.25 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private buildFooter(): void {
    this.add
      .text(
        GAME.WIDTH / 2,
        524,
        '혼자서 봇 셋과 · 한 키보드로 둘이 (F2) · 넷 너머로 넷이서 (F3) · 프롬프트를 입력해 판을 바꾼다',
        { fontFamily: GAME.FONT, fontSize: '16px', color: '#8fa6d8' },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);

    /*
     * 규모는 칩 네 개로 말한다.
     *
     * 처음 켠 사람은 이 화면에서 "얼마나 만든 게임인가"를 판단하는데,
     * 그 숫자들이 조작 안내와 똑같은 저채도 한 줄로 깔려 있었다 —
     * 이 게임 최대의 세일즈 포인트가 각주처럼 읽혔다.
     */
    const chips: Array<[string, string]> = [
      [`${CHARACTER_ORDER.length}`, '캐릭터'],
      [`${MOVE_SLOTS.length * CHARACTER_ORDER.length}`, '기술'],
      [`${STAGES.length}`, '무대'],
      ['4', '동시 대전'],
    ];
    chips.forEach(([num, label], i) => {
      const cx = GAME.WIDTH / 2 - 240 + i * 160;
      const cy = 578;
      const box = this.add
        .rectangle(cx, cy, 148, 54, 0x121a30, 0.92)
        .setStrokeStyle(1, 0x2f3f6b)
        .setDepth(DEPTH.HUD);
      const n = this.add
        .text(cx, cy - 9, num, {
          fontFamily: GAME.FONT,
          fontSize: '25px',
          color: '#ffd54a',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.HUD);
      const l = this.add
        .text(cx, cy + 16, label, {
          fontFamily: GAME.FONT,
          fontSize: '12px',
          color: '#8fa6d8',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.HUD);
      // 하나씩 떠오른다 — 첫 화면에 리듬이 생긴다
      [box, n, l].forEach((o) => o.setAlpha(0));
      this.tweens.add({
        targets: [box, n, l],
        alpha: 1,
        y: '-=8',
        delay: 250 + i * 110,
        duration: 320,
        ease: 'Quad.easeOut',
      });
    });

    this.add
      .text(
        GAME.WIDTH / 2,
        634,
        'A/D 이동 · SPACE 점프 · J 약공격 · K 강공격 · L 스킬 · S 방어 · U 잡기',
        { fontFamily: GAME.FONT, fontSize: '14px', color: '#5d739f' },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);
  }

  /* ================================================================ */

  private bindInput(): void {
    this.input.keyboard?.on('keydown', () => this.start());
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => this.start());
  }

  /** 패드의 아무 버튼으로도 시작한다 — "아무 키나"에 패드도 포함이다 */
  override update(): void {
    if (this.pads.poll(this.input.gamepad).any) this.start();
  }

  private start(): void {
    if (this.leaving) return;
    this.leaving = true;

    sound.play('uiConfirm');
    this.cameras.main.fadeOut(280, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Select');
    });
  }
}

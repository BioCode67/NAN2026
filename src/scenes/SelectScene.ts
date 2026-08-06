import Phaser from 'phaser';
import { buildFighterArt } from '../characters/CharacterArt';
import { CHARACTERS, CHARACTER_ORDER } from '../config/characters';
import { CHAIN_STRINGS, DEPTH, GAME, MOVE_COMMANDS } from '../config/gameConfig';
import { sound } from '../systems/SoundSystem';
import type { BattleSceneData, CharacterConfig, CharacterId } from '../types';

/** AI 봇 수 — 명세의 1P vs 3AI */
const AI_COUNT = 3;

/** 캐릭터 카드 규격 */
const CARD_W = 196;
const CARD_H = 268;
const CARD_GAP = 24;
const CARD_Y = 300;

interface CharacterCard {
  id: CharacterId;
  root: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Rectangle;
  glow: Phaser.GameObjects.Rectangle;
}

/**
 * 캐릭터 선택 씬.
 *
 * 좌우 방향키(또는 A/D)로 고르고 Enter/Space/클릭으로 확정한다.
 * 확정 시 남은 캐릭터 중 하나가 AI 상대로 배정된다.
 */
export class SelectScene extends Phaser.Scene {
  private cards: CharacterCard[] = [];
  private selectedIndex = 0;
  private confirmed = false;

  private nameText!: Phaser.GameObjects.Text;
  private taglineText!: Phaser.GameObjects.Text;
  private passiveText!: Phaser.GameObjects.Text;
  private skillText!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  private quoteText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'Select' });
  }

  create(): void {
    this.confirmed = false;
    this.cards = [];

    this.buildBackground();
    this.buildHeader();
    this.buildCards();
    this.buildInfoPanel();
    this.buildFooter();
    this.bindInput();

    this.select(0, true);
    this.cameras.main.fadeIn(320, 0, 0, 0);
  }

  /* ================================================================ */
  /* 화면 구성                                                        */
  /* ================================================================ */

  /** 정적 배경은 텍스처로 구워 매 프레임 재분할 비용을 없앤다 */
  private buildBackground(): void {
    const KEY = 'select-bg';

    if (!this.textures.exists(KEY)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x0b1020, 1);
      g.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

      // 배경 장식 — 흐릿한 주가 차트
      g.setAlpha(0.12);
      g.lineStyle(3, 0x4ade80, 1);
      let y = 520;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= GAME.WIDTH; x += 40) {
        y = Phaser.Math.Clamp(y + Phaser.Math.Between(-34, 26), 180, 640);
        g.lineTo(x, y);
      }
      g.strokePath();

      g.generateTexture(KEY, GAME.WIDTH, GAME.HEIGHT);
      g.destroy();
    }

    this.add.image(0, 0, KEY).setOrigin(0).setDepth(DEPTH.BG);
  }

  private buildHeader(): void {
    this.add
      .text(GAME.WIDTH / 2, 62, '상장폐지 대난투', {
        fontFamily: GAME.FONT,
        fontSize: '46px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#1e3a8a', 12, false, true);

    this.add
      .text(GAME.WIDTH / 2, 100, 'DELISTING BRAWL', {
        fontFamily: GAME.FONT,
        fontSize: '15px',
        color: '#6c86c4',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME.WIDTH / 2, 140, '파이터를 선택하세요', {
        fontFamily: GAME.FONT,
        fontSize: '18px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);
  }

  private buildCards(): void {
    const total =
      CHARACTER_ORDER.length * CARD_W + (CHARACTER_ORDER.length - 1) * CARD_GAP;
    const startX = (GAME.WIDTH - total) / 2 + CARD_W / 2;

    CHARACTER_ORDER.forEach((id, i) => {
      const cfg = CHARACTERS[id];
      const x = startX + i * (CARD_W + CARD_GAP);

      const glow = this.add
        .rectangle(0, 0, CARD_W + 12, CARD_H + 12, cfg.colors.accent, 0.35)
        .setVisible(false);

      const frame = this.add
        .rectangle(0, 0, CARD_W, CARD_H, 0x141c33)
        .setStrokeStyle(3, 0x2f3f6b);

      /* SD 아바타 — 전투 씬과 동일한 아트를 재사용한다 */
      const art = buildFighterArt(this, cfg);
      const avatar = this.add.container(0, -34, art.parts).setScale(1.3);

      const name = this.add
        .text(0, 42, cfg.name, {
          fontFamily: GAME.FONT,
          fontSize: '19px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);

      const real = this.add
        .text(0, 66, cfg.realName, {
          fontFamily: GAME.FONT,
          fontSize: '12px',
          color: '#7f93bd',
        })
        .setOrigin(0.5);

      const passiveTag = this.add
        .text(0, 98, cfg.passive.name, {
          fontFamily: GAME.FONT,
          fontSize: '13px',
          color: '#0b1020',
          backgroundColor: `#${cfg.colors.accent.toString(16).padStart(6, '0')}`,
          padding: { x: 10, y: 4 },
          fontStyle: 'bold',
        })
        .setOrigin(0.5);

      const root = this.add
        .container(x, CARD_Y, [glow, frame, avatar, name, real, passiveTag])
        .setDepth(DEPTH.HUD);

      /* 마우스 조작 */
      frame
        .setInteractive({ useHandCursor: true })
        .on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.select(i))
        .on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
          this.select(i);
          this.confirm();
        });

      this.cards.push({ id, root, frame, glow });
    });
  }

  private buildInfoPanel(): void {
    // 연속기 + 커맨드 목록이 들어가면서 패널을 위로 올리고 키웠다
    const panelY = 470;

    this.add
      .rectangle(GAME.WIDTH / 2, panelY + 78, 980, 200, 0x141c33, 0.85)
      .setStrokeStyle(2, 0x2f3f6b)
      .setDepth(DEPTH.HUD - 1);

    this.nameText = this.add
      .text(GAME.WIDTH / 2 - 460, panelY, '', {
        fontFamily: GAME.FONT,
        fontSize: '24px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setDepth(DEPTH.HUD);

    this.taglineText = this.add
      .text(GAME.WIDTH / 2 - 460, panelY + 32, '', {
        fontFamily: GAME.FONT,
        fontSize: '14px',
        color: '#8fa6d8',
      })
      .setDepth(DEPTH.HUD);

    this.passiveText = this.add
      .text(GAME.WIDTH / 2 - 460, panelY + 60, '', {
        fontFamily: GAME.FONT,
        fontSize: '14px',
        color: '#cbd5e1',
        wordWrap: { width: 900 },
      })
      .setDepth(DEPTH.HUD);

    this.skillText = this.add
      .text(GAME.WIDTH / 2 - 460, panelY + 86, '', {
        fontFamily: GAME.FONT,
        fontSize: '14px',
        color: '#cbd5e1',
        wordWrap: { width: 900 },
      })
      .setDepth(DEPTH.HUD);

    /*
     * 커맨드 목록.
     * 캐릭터마다 기술 이름이 전부 다르므로, 여기서 미리 보여주지 않으면
     * 플레이어가 W+K / S+K 같은 입력이 있다는 사실 자체를 모른 채 끝난다.
     */
    this.movesText = this.add
      .text(GAME.WIDTH / 2 - 460, panelY + 112, '', {
        fontFamily: GAME.FONT,
        fontSize: '13px',
        color: '#8fa6d8',
        wordWrap: { width: 940 },
        lineSpacing: 4,
      })
      .setDepth(DEPTH.HUD);

    this.quoteText = this.add
      .text(GAME.WIDTH / 2 + 460, panelY, '', {
        fontFamily: GAME.FONT,
        fontSize: '16px',
        color: '#facc15',
        fontStyle: 'italic',
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH.HUD);
  }

  private buildFooter(): void {
    this.add
      .text(
        GAME.WIDTH / 2,
        676,
        '← → / A D : 선택      Enter · Space · 클릭 : 결정      (나머지 3명이 AI로 참전)',
        {
          fontFamily: GAME.FONT,
          fontSize: '15px',
          color: '#6c86c4',
        },
      )
      .setOrigin(0.5);
  }

  /* ================================================================ */
  /* 입력                                                             */
  /* ================================================================ */

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (!kb) return;

    kb.on('keydown-LEFT', () => this.move(-1));
    kb.on('keydown-A', () => this.move(-1));
    kb.on('keydown-RIGHT', () => this.move(1));
    kb.on('keydown-D', () => this.move(1));
    kb.on('keydown-ENTER', () => this.confirm());
    kb.on('keydown-SPACE', () => this.confirm());
  }

  private move(delta: number): void {
    if (this.confirmed) return;
    const next = Phaser.Math.Wrap(
      this.selectedIndex + delta,
      0,
      CHARACTER_ORDER.length,
    );
    if (next !== this.selectedIndex) sound.play('uiMove');
    this.select(next);
  }

  /* ================================================================ */
  /* 선택 / 확정                                                      */
  /* ================================================================ */

  private select(index: number, immediate = false): void {
    if (this.confirmed) return;
    this.selectedIndex = index;

    this.cards.forEach((card, i) => {
      const active = i === index;
      card.glow.setVisible(active);
      card.frame.setStrokeStyle(3, active ? 0xffffff : 0x2f3f6b);

      const scale = active ? 1.07 : 0.94;
      const y = active ? CARD_Y - 10 : CARD_Y;

      if (immediate) {
        card.root.setScale(scale);
        card.root.y = y;
        card.root.setAlpha(active ? 1 : 0.7);
      } else {
        this.tweens.add({
          targets: card.root,
          scale,
          y,
          alpha: active ? 1 : 0.7,
          duration: 160,
          ease: 'Quad.easeOut',
        });
      }
    });

    this.updateInfo(CHARACTERS[CHARACTER_ORDER[index]!]);
  }

  private updateInfo(cfg: CharacterConfig): void {
    this.nameText.setText(cfg.name);
    this.taglineText.setText(`"${cfg.tagline}"`);
    this.passiveText.setText(`[패시브] ${cfg.passive.name} — ${cfg.passive.desc}`);
    const skill = cfg.moves.skill;
    this.skillText.setText(
      `[스킬 L] ${skill.name} — 피해 ${skill.damage}% · 쿨다운 ${(
        (skill.cooldown ?? 0) / 1000
      ).toFixed(0)}초`,
    );

    /*
     * 연속기는 "같은 버튼을 이어 누르는" 것이라 커맨드 목록과 성격이 달라
     * 화살표로 이어 붙여 한 줄로 따로 보여준다.
     */
    const chains = CHAIN_STRINGS.map(
      (c) =>
        `${c.keys} ${c.slots.map((slot) => cfg.moves[slot].name).join(' → ')}`,
    ).join('      ');

    // 스킬은 위 줄에서 이미 설명했으므로 커맨드 목록에서는 뺀다
    this.movesText.setText(
      `[연속기] ${chains}\n[커맨드] ` +
        MOVE_COMMANDS.filter((c) => c.slot !== 'skill')
          .map((c) => `${c.keys} ${cfg.moves[c.slot].name}`)
          .join('  ·  '),
    );

    this.quoteText.setText(`“${cfg.quotes.intro[0] ?? ''}”`);
  }

  private confirm(): void {
    if (this.confirmed) return;
    this.confirmed = true;
    sound.play('uiConfirm');

    const playerId = CHARACTER_ORDER[this.selectedIndex]!;

    // 1P vs 3AI — 남은 4명 중 3명을 무작위로 뽑는다
    const others = Phaser.Utils.Array.Shuffle(
      CHARACTER_ORDER.filter((id) => id !== playerId),
    );
    const aiIds = others.slice(0, AI_COUNT);

    const card = this.cards[this.selectedIndex]!;
    this.tweens.add({
      targets: card.root,
      scale: 1.2,
      duration: 140,
      yoyo: true,
      ease: 'Quad.easeOut',
    });

    const data: BattleSceneData = { playerId, aiIds };
    this.cameras.main.fadeOut(280, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Battle', data);
    });
  }
}

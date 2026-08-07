import Phaser from 'phaser';
import { addBackdrop } from '../config/artAssets';
import { buildCardArt } from '../characters/CharacterArt';
import { CHARACTERS, CHARACTER_ORDER } from '../config/characters';
import { CHAIN_STRINGS, DEPTH, GAME, MOVE_COMMANDS } from '../config/gameConfig';
import { sound } from '../systems/SoundSystem';
import type { BattleSceneData, CharacterConfig, CharacterId } from '../types';

/** AI 봇 수 — 명세의 1P vs 3AI */
const AI_COUNT = 3;

/** 카드가 놓일 수 있는 영역 — 머리말 아래, 설명 패널 위 */
const GRID = { top: 158, bottom: 424, width: 1190, gap: 14 };
/** 카드 한 장의 최대 크기 (다섯 명일 때의 크기) */
const CARD_MAX_W = 196;
/** 카드 가로:세로 비율 */
const CARD_RATIO = 268 / 196;
/** 이 수를 넘으면 카드에서 설명을 빼고 얼굴만 남긴다 */
const COMPACT_FROM = 8;

/** 한 줄에 놓을 최대 장수 — 이보다 많으면 줄을 나눈다 */
const MAX_COLS = 10;

/**
 * 로스터 크기에 맞춰 격자를 짠다.
 *
 * 다섯 명일 때는 한 줄에 크게 늘어놓으면 됐다. 스무 명이 되면 그 방식으로는
 * 화면 밖으로 나간다. 열 수를 먼저 정하고, 남는 폭을 나눠 카드 크기를 줄인다.
 *
 * 카드가 작아지면 패시브 이름 같은 글자는 읽히지 않으므로 아예 뺀다.
 * 어차피 고른 캐릭터의 설명은 아래 패널에 전부 나온다 —
 * 격자는 "누가 있는지"를 보여주는 자리고, 패널이 "어떤 캐릭터인지"를 맡는다.
 */
function layoutRoster(n: number) {
  const cols = Math.min(n, MAX_COLS);
  const rows = Math.ceil(n / cols);

  const byWidth = (GRID.width - GRID.gap * (cols - 1)) / cols;
  const byHeight = (GRID.bottom - GRID.top - GRID.gap * (rows - 1)) / rows / CARD_RATIO;

  const w = Math.min(CARD_MAX_W, byWidth, byHeight);
  return { cols, rows, w, h: w * CARD_RATIO, compact: n >= COMPACT_FROM };
}

/**
 * 상대 셋을 고른다.
 *
 * ── 왜 그냥 무작위로 뽑지 않는가 ──────────────────────────────────
 * 다섯 명일 때는 고유 메커니즘도 다섯 종이라, 아무나 뽑아도 셋이 전부 달랐다.
 * 스무 명이 되면서 메커니즘 하나를 네 명이 나눠 쓴다. 이제 무작위로 뽑으면
 * 열 판 중 두어 판은 봇 셋이 같은 메커니즘으로 나오고, 그러면 이름과 색만
 * 다른 셋을 상대하게 된다 — 로스터를 스무 명으로 늘린 이유가 사라진다.
 *
 * 그래서 메커니즘이 겹치지 않는 쪽을 먼저 집는다. 캐릭터 자체는 여전히
 * 무작위이므로 매 판 얼굴은 달라지고, 싸우는 방식만 매번 셋으로 갈린다.
 * (플레이어가 고른 메커니즘도 피한다 — 자기 거울상을 상대하는 재미는 적다)
 */
function pickOpponents(playerId: CharacterId): CharacterId[] {
  const pool = Phaser.Utils.Array.Shuffle(
    CHARACTER_ORDER.filter((id) => id !== playerId),
  );

  const used = new Set<string>([CHARACTERS[playerId]!.signature.id]);
  const picked: CharacterId[] = [];

  for (const id of pool) {
    if (picked.length >= AI_COUNT) break;
    const sig = CHARACTERS[id]!.signature.id;
    if (used.has(sig)) continue;
    used.add(sig);
    picked.push(id);
  }

  // 메커니즘 종류보다 자리가 많으면(로스터가 작을 때) 남은 자리는 그냥 채운다
  for (const id of pool) {
    if (picked.length >= AI_COUNT) break;
    if (!picked.includes(id)) picked.push(id);
  }

  return picked;
}
/**
 * 카드 안 아바타가 차지하는 세로 크기.
 *
 * 시트마다 캐릭터를 칸 안 어디에 그려 뒀는지가 다르다 —
 * 리누스는 현수막을, 패니는 도끼를 들고 있어 칸 아래쪽까지 찬다.
 * 칸 높이를 그대로 키우면 그 소품이 이름표를 덮으므로,
 * 가장 아래까지 찬 시트를 기준으로 잡는다.
 */
const AVATAR_H = 126;

interface CharacterCard {
  id: CharacterId;
  root: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Rectangle;
  glow: Phaser.GameObjects.Rectangle;
  /** 이 카드가 원래 있어야 할 자리 — 고르면 살짝 떠오르므로 기준이 필요하다 */
  homeY: number;
}

/**
 * 캐릭터 선택 씬.
 *
 * 좌우 방향키(또는 A/D)로 고르고 Enter/Space/클릭으로 확정한다.
 * 확정 시 남은 캐릭터 중 하나가 AI 상대로 배정된다.
 */
export class SelectScene extends Phaser.Scene {
  private cards: CharacterCard[] = [];
  /** 한 줄에 놓인 카드 수 — 위아래 이동 폭이 된다 */
  private cols = 1;
  private selectedIndex = 0;
  private confirmed = false;
  /** 이 시각 전의 입력은 앞 화면에서 넘어온 것이다 */
  private readyAt = 0;

  private nameText!: Phaser.GameObjects.Text;
  private taglineText!: Phaser.GameObjects.Text;
  private passiveText!: Phaser.GameObjects.Text;
  private signatureText!: Phaser.GameObjects.Text;
  private skillText!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  private quoteText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'Select' });
  }

  create(): void {
    this.confirmed = false;
    this.cards = [];

    /*
     * 화면이 뜨자마자 들어오는 입력은 무시한다.
     *
     * 타이틀에서 "아무 키나" 눌러 넘어오는데, 그 키를 놓기 전에 선택 화면이
     * 뜨면 같은 Enter가 여기서 "결정"으로 한 번 더 먹는다. 그러면 캐릭터를
     * 고르기도 전에 첫 번째 캐릭터로 전투가 시작된다.
     */
    this.readyAt = this.time.now + 260;

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
    /* 생성한 배경 그림이 있으면 그걸 쓴다 */
    const art = addBackdrop(this, 'ui_select_bg', GAME.WIDTH, GAME.HEIGHT);
    if (art) {
      art.setDepth(DEPTH.BG);
      // 카드와 설명 패널이 위에 올라가므로 배경을 한 겹 눌러 둔다
      this.add
        .rectangle(0, 0, GAME.WIDTH, GAME.HEIGHT, 0x040814, 0.4)
        .setOrigin(0)
        .setDepth(DEPTH.BG + 1);
      return;
    }

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
    const n = CHARACTER_ORDER.length;
    const g = layoutRoster(n);
    this.cols = g.cols;

    const rowW = (count: number) => count * g.w + (count - 1) * GRID.gap;
    const gridH = g.rows * g.h + (g.rows - 1) * GRID.gap;
    const top = GRID.top + (GRID.bottom - GRID.top - gridH) / 2;

    CHARACTER_ORDER.forEach((id, i) => {
      const cfg = CHARACTERS[id];
      const row = Math.floor(i / g.cols);
      const col = i % g.cols;

      // 마지막 줄이 덜 찼으면 그 줄만 가운데로 모은다
      const inRow = Math.min(g.cols, n - row * g.cols);
      const startX = (GAME.WIDTH - rowW(inRow)) / 2 + g.w / 2;

      const x = startX + col * (g.w + GRID.gap);
      const y = top + row * (g.h + GRID.gap) + g.h / 2;

      const glow = this.add
        .rectangle(0, 0, g.w + 12, g.h + 12, cfg.colors.accent, 0.35)
        .setVisible(false);

      const frame = this.add
        .rectangle(0, 0, g.w, g.h, 0x141c33)
        .setStrokeStyle(3, 0x2f3f6b);

      /* 아바타 — 시트가 있으면 전투에서 실제로 보게 될 그림을 그대로 쓴다 */
      const avatarH = Math.min(AVATAR_H, g.h * (g.compact ? 0.66 : 0.47));
      const avatar = buildCardArt(this, cfg, avatarH).setPosition(
        0,
        g.compact ? -g.h * 0.1 : -g.h * 0.18,
      );

      const parts: Phaser.GameObjects.GameObject[] = [glow, frame, avatar];

      const name = this.add
        .text(0, g.h * (g.compact ? 0.33 : 0.16), cfg.name, {
          fontFamily: GAME.FONT,
          fontSize: `${Math.max(10, Math.round(g.w * 0.097))}px`,
          color: '#ffffff',
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: g.w - 8 },
        })
        .setOrigin(0.5);
      parts.push(name);

      /*
       * 카드가 작아지면 이 글자들은 읽히지 않는다. 읽히지 않는 글자는
       * 정보가 아니라 얼룩이므로 뺀다 — 어차피 아래 패널에 전부 나온다.
       */
      if (!g.compact) {
        parts.push(
          this.add
            .text(0, g.h * 0.25, cfg.realName, {
              fontFamily: GAME.FONT,
              fontSize: '12px',
              color: '#7f93bd',
            })
            .setOrigin(0.5),
          this.add
            .text(0, g.h * 0.37, cfg.passive.name, {
              fontFamily: GAME.FONT,
              fontSize: '13px',
              color: '#0b1020',
              backgroundColor: `#${cfg.colors.accent.toString(16).padStart(6, '0')}`,
              padding: { x: 10, y: 4 },
              fontStyle: 'bold',
            })
            .setOrigin(0.5),
        );
      }

      const root = this.add.container(x, y, parts).setDepth(DEPTH.HUD);

      /* 마우스 조작 */
      frame
        .setInteractive({ useHandCursor: true })
        .on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.select(i))
        .on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
          this.select(i);
          this.confirm();
        });

      this.cards.push({ id, root, frame, glow, homeY: y });
    });
  }

  private buildInfoPanel(): void {
    // 고유 메커니즘 줄이 늘면서 패널을 한 번 더 키웠다
    const panelY = 452;

    this.add
      .rectangle(GAME.WIDTH / 2, panelY + 92, 980, 226, 0x141c33, 0.85)
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

    /*
     * 고유 메커니즘.
     *
     * 이 게임에서 캐릭터를 고르는 진짜 이유가 여기 있다 —
     * 패시브는 숫자만 다르지만, 이건 조작 방식 자체가 다르다.
     * 그래서 패시브보다 눈에 띄게 강조색으로 둔다.
     */
    this.signatureText = this.add
      .text(GAME.WIDTH / 2 - 460, panelY + 86, '', {
        fontFamily: GAME.FONT,
        fontSize: '14px',
        color: '#facc15',
        wordWrap: { width: 900 },
        fontStyle: 'bold',
      })
      .setDepth(DEPTH.HUD);

    /*
     * 고유 메커니즘은 두 줄이라 다음 줄과 26px 간격으로는 겹친다.
     * 아래 두 줄을 그만큼 내렸다.
     */
    this.skillText = this.add
      .text(GAME.WIDTH / 2 - 460, panelY + 126, '', {
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
      .text(GAME.WIDTH / 2 - 460, panelY + 152, '', {
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
        `← → ↑ ↓ / A D W S : 선택      Enter · Space · 클릭 : 결정      ` +
          `(총 ${CHARACTER_ORDER.length}명 — 고유 메커니즘이 서로 다른 ${AI_COUNT}명이 AI로 참전)`,
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

    /* 줄이 여러 개면 위아래로도 다녀야 한다 */
    kb.on('keydown-UP', () => this.move(-this.cols));
    kb.on('keydown-W', () => this.move(-this.cols));
    kb.on('keydown-DOWN', () => this.move(this.cols));
    kb.on('keydown-S', () => this.move(this.cols));
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
      const y = active ? card.homeY - 10 : card.homeY;

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
    const sig = cfg.signature;
    this.signatureText.setText(
      `[고유] ${sig.icon} ${sig.name} — ${sig.desc}\n         ${sig.how}`,
    );

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
    if (this.confirmed || this.time.now < this.readyAt) return;
    this.confirmed = true;
    sound.play('uiConfirm');

    const playerId = CHARACTER_ORDER[this.selectedIndex]!;

    const aiIds = pickOpponents(playerId);

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

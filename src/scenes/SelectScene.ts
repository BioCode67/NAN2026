import Phaser from 'phaser';
import { addBackdrop } from '../config/artAssets';
import { buildCardArt } from '../characters/CharacterArt';
import { CHARACTERS, CHARACTER_ORDER } from '../config/characters';
import { pickOpponents } from '../config/matchup';
import { CHAIN_STRINGS, DEPTH, GAME, MOVE_COMMANDS, MOVE_SLOTS } from '../config/gameConfig';
import { PadMenu } from '../systems/InputFrame';
import { sound } from '../systems/SoundSystem';
import { MAX_PLAYERS, net } from '../systems/NetSystem';
import {
  closeNetOverlay,
  isNetOverlayOpen,
  openLobby,
  showError,
  showStatus,
  showWaiting,
} from '../ui/NetOverlay';
import { pickStage } from '../config/stages';
import type { BattleSceneData, CharacterConfig, CharacterId, MoveSlot } from '../types';

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
  /** 온라인에서 이 캐릭터를 고른 사람 표시 (1P·2P…) */
  claim?: Phaser.GameObjects.Text;
}

/** 자리 색 — 전투 화면과 같은 순서·같은 색을 쓴다 */
const SEAT_COLORS = ['#38bdf8', '#f472b6', '#a78bfa', '#facc15'];

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
  /** 상세 보기 오버레이 (열려 있을 때만 존재한다) */
  private detail?: Phaser.GameObjects.Container;
  /** 게임패드 메뉴 조작 — 누가 눌러도 움직인다 */
  private pads = new PadMenu();

  private nameText!: Phaser.GameObjects.Text;
  private taglineText!: Phaser.GameObjects.Text;
  private passiveText!: Phaser.GameObjects.Text;
  private signatureText!: Phaser.GameObjects.Text;
  private skillText!: Phaser.GameObjects.Text;
  private movesText!: Phaser.GameObjects.Text;
  /** 설명 패널 왼쪽의 캐릭터 색 띠 */
  private infoAccent?: Phaser.GameObjects.Rectangle;
  private quoteText!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private modeLabel!: Phaser.GameObjects.Text;

  /** 2인 대전인가 (F2로 켠다) */
  private twoPlayer = false;
  /** 2인 대전에서 1P가 이미 고른 캐릭터 (null이면 아직 1P 차례) */
  private p1Id: CharacterId | null = null;

  /* --- 온라인 1:1 ------------------------------------------------- */
  /** 회선이 연결된 상태인가 */
  private online = false;
  /** 내가 고른 캐릭터 (보냈다) */
  private myPick: CharacterId | null = null;


  constructor() {
    super({ key: 'Select' });
  }

  create(): void {
    this.confirmed = false;
    this.cards = [];
    this.detail = undefined;
    this.twoPlayer = false;
    this.p1Id = null;
    this.online = false;
    this.myPick = null;
    closeNetOverlay();

    /*
     * 화면이 뜨자마자 들어오는 입력은 무시한다.
     *
     * 타이틀에서 "아무 키나" 눌러 넘어오는데, 그 키를 놓기 전에 선택 화면이
     * 뜨면 같은 Enter가 여기서 "결정"으로 한 번 더 먹는다. 그러면 캐릭터를
     * 고르기도 전에 첫 번째 캐릭터로 전투가 시작된다.
     *
     * 260ms 로 뒀더니 가끔 새어 들어왔다. 타이틀의 페이드아웃이 280ms 인데
     * 그 사이에 눌린 키가 이쪽에 도착하기 때문이다. 페이드보다 확실히 길게 둔다 —
     * 화면이 뜨자마자 0.5초는 아무도 결정을 누르지 않는다.
     */
    this.readyAt = this.time.now + 480;
    // 패드도 같은 문제를 갖는다 — 넘어올 때 누른 그 버튼이 아직 눌려 있다
    this.pads.prime();

    // 제목 화면과 같은 곡 — 이미 돌고 있으면 그대로 이어진다
    sound.startBgm('menu');

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

    this.prompt = this.add
      .text(GAME.WIDTH / 2, 140, '파이터를 선택하세요', {
        fontFamily: GAME.FONT,
        fontSize: '18px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);
  }

  /**
   * 지금 누가 고르는 중인지 알린다.
   *
   * 2인 대전은 한 화면에서 번갈아 고른다. 지금이 누구 차례인지 크게 쓰지
   * 않으면 옆 사람이 남의 캐릭터를 정해 버린다 — 실제로 그렇게 된다.
   */
  private refreshPrompt(): void {
    if (this.online) {
      const picks = net.lobby.picks;
      const total = Math.max(picks.length, 2);
      const done = picks.filter(Boolean).length;
      const waiting = !!this.myPick && done < total;

      this.markClaims(picks);

      /*
       * 누가 무엇을 골랐는지 이름으로 보여준다.
       *
       * 전에는 "2/3명 선택 완료"라는 숫자뿐이었다. 넷이 모여 각자 고르는
       * 이 순간이 판에서 제일 들뜨는 때인데, 숫자만 보면 **혼자 기다리는
       * 화면**이 된다. 누가 누구를 집었는지 보이면 그때부터 서로를 의식한다 —
       * "쟤 저거 골랐네"가 곧 다음 판의 이야기가 된다.
       */
      const line = picks
        .slice(0, total)
        .map((id, i) => `${i + 1}P ${id ? CHARACTERS[id].name : '고르는 중…'}`)
        .join('   ·   ');

      this.prompt.setText(
        waiting ? `${line}   (${done}/${total})` : `온라인 ${total}인 대전 — ${line}`,
      );
      this.prompt.setColor(waiting ? '#facc15' : '#4ade80');
      return;
    }
    this.markClaims([]);
    if (!this.twoPlayer) {
      this.prompt.setText('파이터를 선택하세요');
      this.prompt.setColor('#cbd5e1');
      return;
    }
    const first = this.p1Id === null;
    this.prompt.setText(first ? '1P — 파이터를 선택하세요' : '2P — 파이터를 선택하세요');
    this.prompt.setColor(first ? '#38bdf8' : '#f472b6');
  }

  /**
   * 카드 위에 "누가 집었는지"를 붙인다.
   *
   * 목록에서 이름 줄만 바뀌면 눈이 안 간다. 고른 캐릭터 카드에 그 사람의
   * 자리 색으로 딱지가 붙으면, 판이 시작되기 전에 이미 누가 어디 있는지
   * 화면에서 읽힌다.
   */
  private markClaims(picks: readonly (CharacterId | null)[]): void {
    const owner = new Map<CharacterId, number>();
    picks.forEach((id, slot) => {
      if (id && !owner.has(id)) owner.set(id, slot);
    });

    for (const card of this.cards) {
      const slot = owner.get(card.id);
      if (slot === undefined) {
        card.claim?.destroy();
        card.claim = undefined;
        continue;
      }
      const label = `${slot + 1}P`;
      const color = SEAT_COLORS[slot] ?? SEAT_COLORS[0]!;
      if (card.claim) {
        card.claim.setText(label).setColor(color);
        continue;
      }
      card.claim = this.add
        .text(0, -card.frame.height / 2 + 10, label, {
          fontFamily: GAME.FONT,
          fontSize: '13px',
          color,
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      card.claim.setStroke('#0b1020', 4);
      card.root.add(card.claim);
    }
  }

  /**
   * 2인 대전을 켜고 끈다.
   *
   * 별도 메뉴 화면을 두지 않았다. 선택 화면에 이미 있는 것을 그대로 쓰면
   * 화면 하나와 그 사이 전환을 통째로 안 만들어도 되고, 켜는 순간 눈앞의
   * 카드가 그대로 1P 차례로 바뀌니 설명도 필요 없다.
   */
  private toggleTwoPlayer(): void {
    if (this.confirmed || this.detail || isNetOverlayOpen()) return;
    // 온라인 중에는 로컬 모드를 못 바꾼다 (상대와 판이 달라진다)
    if (this.online) return;

    this.twoPlayer = !this.twoPlayer;
    this.p1Id = null;
    sound.play('uiConfirm');
    this.refreshPrompt();
    this.modeLabel.setText(this.modeText());
    this.modeLabel.setColor(this.twoPlayer ? '#f472b6' : '#6c86c4');
  }

  private modeText(): string {
    if (this.online) return `🌐 온라인 대전  ·  연결됨 (빈자리는 봇)`;
    return this.twoPlayer
      ? '👥 2인 대전  ·  사람 둘 + 봇 둘   (F2 : 1인으로 · F3 : 온라인)'
      : '🎮 1인 플레이  ·  나 + 봇 셋   (F2 : 2인 대전 · F3 : 온라인 넷이서)';
  }

  /* ================================================================ */
  /* 온라인 1:1                                                        */
  /* ================================================================ */

  /**
   * 온라인 대전을 연다.
   *
   * 연결이 맺어지면 **양쪽이 동시에** 자기 캐릭터를 고른다. 번갈아 고르게
   * 하면 먼저 고른 쪽이 상대를 보고 맞춰 고를 수 있어 불공평하고,
   * 기다리는 시간도 두 배가 된다.
   */
  private async startOnline(): Promise<void> {
    if (this.confirmed || this.detail || this.online) return;

    const choice = await openLobby();
    if (choice.kind === 'cancel') return;

    try {
      if (choice.kind === 'localHost') {
        await net.connectLocal('host');
        await this.waitInLobby('DEMO');
      } else if (choice.kind === 'localGuest') {
        showStatus('방을 연 창을 찾는 중…');
        await net.connectLocal('guest');
      } else if (choice.kind === 'host') {
        showStatus('방을 여는 중…');
        const code = await net.host();
        await this.waitInLobby(code);
      } else {
        showStatus('연결하는 중…', choice.code);
        await net.join(choice.code);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '연결에 실패했습니다.';
      net.close();
      showError(msg, () => {
        /* 로컬 플레이는 그대로 할 수 있다 — 온라인만 못 켠 것이다 */
      });
      return;
    }

    closeNetOverlay();
    this.online = true;
    this.twoPlayer = false;
    this.p1Id = null;
    sound.play('uiConfirm');
    this.refreshPrompt();
    this.modeLabel.setText(this.modeText());
    this.modeLabel.setColor('#4ade80');

    /*
     * 이 씬이 사라지면 회선에서 손을 뗀다.
     *
     * 처리기는 하나짜리 회선 객체에 꽂히고 그 객체는 씬보다 오래 산다.
     * 전투로 넘어간 뒤에도 여기 처리기가 남아 있으면, 로비 소식이 올 때마다
     * **이미 지워진 화면 요소**를 만지다 예외가 난다. 그 예외는 회선이
     * 자리를 정리하던 도중에 튀어나와 정리를 통째로 멈춘다 —
     * 나간 사람의 자리가 판에 그대로 남는 원인이었다.
     *
     * 내가 꽂은 것과 같은 함수일 때만 뗀다. 다음 씬이 이미 자기 것을 꽂았다면
     * 그건 남의 것이므로 건드리면 안 된다.
     */
    const onLobby = () => {
      this.refreshPrompt();
      this.tryStartOnline();
    };
    net.onLobby = onLobby;
    this.events.once('shutdown', () => {
      if (net.onLobby === onLobby) net.onLobby = undefined;
    });
    net.onStart = (d) => {
      // 참가자는 호스트가 정한 대로 따라 들어간다
      this.launch({
        playerId: d.chars[0]!,
        humanIds: d.chars,
        netSlot: net.slot,
        aiIds: d.bots,
        stageId: d.stageId,
        duel: true,
        netRole: 'guest',
      });
    };
    net.onClose = (reason) => {
      if (this.confirmed) return;
      this.online = false;
      this.myPick = null;
      showError(reason, () => this.scene.restart());
    };
  }

  /**
   * 호스트가 사람을 받는 동안 기다린다.
   *
   * 몇 명이 들어와 있는지 계속 보여주고, 호스트가 "이 인원으로 시작"을
   * 누르면 그 순간의 인원으로 확정한다. 자동으로 넷을 채울 때까지 기다리면
   * 셋이 모여도 영영 시작을 못 한다 — 빈자리는 봇이 채우면 된다.
   */
  private waitInLobby(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const panel = showWaiting(
        code,
        () => {
          net.close();
          reject(new Error('방을 닫았습니다.'));
        },
        () => resolve(),
      );
      net.onLobby = () => panel.setCount(net.playerCount);
      panel.setCount(net.playerCount);
    });
  }

  /** 전원이 골랐으면 호스트가 판을 연다 */
  private tryStartOnline(): void {
    if (!this.online || this.confirmed) return;
    if (net.role !== 'host') return;

    /*
     * 들어와 있는 사람이 **전부** 골라야 시작한다.
     *
     * 한 명이라도 고르는 중인데 시작하면 그 사람은 남이 정해 준 캐릭터로
     * 싸우게 된다. 기다리는 쪽에는 "누가 고르는 중"인지 화면에 뜬다.
     */
    const picks = net.lobby.picks.slice(0, net.playerCount);
    if (picks.length < 2 || picks.some((p) => !p)) return;

    const chars = picks as CharacterId[];

    /*
     * 빈자리는 봇이 채운다. 어느 봇이 나올지는 호스트가 정해 알려준다 —
     * 각자 뽑으면 같은 자리에 다른 캐릭터가 서고, 번호로 주고받는 상태가
     * 엉뚱한 사람에게 붙는다.
     */
    const stage = pickStage();
    const bots = pickOpponents(chars[0]!, MAX_PLAYERS - chars.length, [], chars.slice(1));

    const d = { chars, bots, stageId: stage.id };
    net.sendStart(d);
    this.launch({
      playerId: chars[0]!,
      humanIds: chars,
      netSlot: 0,
      aiIds: bots,
      stageId: stage.id,
      duel: true,
      netRole: 'host',
    });
  }

  /** 화면을 넘긴다 (한 곳에서만 전환하도록 모아 둔다) */
  private launch(data: BattleSceneData): void {
    if (this.confirmed) return;
    this.confirmed = true;
    closeNetOverlay();
    this.cameras.main.fadeOut(280, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Battle', data);
    });
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

      /*
       * 카드 아래 캐릭터 색 줄.
       *
       * 스무 장이 전부 같은 남색이라 격자가 벽돌담처럼 보였다 — 로스터의
       * 다양함이 이 게임의 자랑인데 첫눈에는 단색 스무 칸이었다. 압축
       * 모드에서 패시브 배지가 빠지면 색이 통째로 사라지는 문제도 이 줄이
       * 막는다.
       */
      const stripe = this.add.rectangle(
        0,
        g.h / 2 - 3,
        g.w - 6,
        6,
        cfg.colors.accent,
        0.9,
      );

      /* 아바타 — 시트가 있으면 전투에서 실제로 보게 될 그림을 그대로 쓴다 */
      const avatarH = Math.min(AVATAR_H, g.h * (g.compact ? 0.66 : 0.47));
      const avatar = buildCardArt(this, cfg, avatarH).setPosition(
        0,
        g.compact ? -g.h * 0.1 : -g.h * 0.18,
      );

      const parts: Phaser.GameObjects.GameObject[] = [glow, frame, stripe, avatar];

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

    /*
     * 패널 왼쪽의 캐릭터 색 세로 띠.
     * 980px 사각형 하나에 글줄 일곱이 전부 같은 자리에서 시작하는 글자
     * 벽이라, 캐릭터를 넘겨도 패널이 바뀐 느낌이 없었다. 띠 색 하나가
     * "지금 이 사람 것"을 말해 준다.
     */
    this.infoAccent = this.add
      .rectangle(GAME.WIDTH / 2 - 490 + 3, panelY + 92, 6, 226, 0xffffff)
      .setDepth(DEPTH.HUD);

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
    /*
     * 모드 줄을 조작 안내보다 위에, 더 크게 둔다.
     * 2인 대전이 있다는 사실 자체를 모르면 없는 기능이나 마찬가지다.
     */
    this.modeLabel = this.add
      .text(GAME.WIDTH / 2, 650, this.modeText(), {
        fontFamily: GAME.FONT,
        fontSize: '17px',
        color: '#6c86c4',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(
        GAME.WIDTH / 2,
        680,
        `← → ↑ ↓ / A D W S : 선택      Enter · Space · 클릭 : 결정      ` +
          `TAB · I : 기술 ${MOVE_SLOTS.length}개 자세히      F2 : 2인 대전      F3 : 온라인 넷이서      (총 ${CHARACTER_ORDER.length}명)`,
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

    /*
     * 상세 보기.
     *
     * TAB 은 브라우저가 먼저 가로채 포커스를 캔버스 밖으로 옮긴다.
     * addCapture 로 이 키만 게임 쪽에 묶어 둬야 눌린다.
     * I(정보)도 함께 받는다 — TAB 을 캔버스가 먹는 것을 불편해하는 사람이 있고,
     * 키 하나가 막혀도 기능 전체가 사라지지 않는 편이 낫다.
     */
    kb.addCapture('TAB');
    kb.on('keydown-F2', () => this.toggleTwoPlayer());
    kb.on('keydown-F3', () => void this.startOnline());
    kb.on('keydown-TAB', () => this.toggleDetail());
    kb.on('keydown-I', () => this.toggleDetail());
    kb.on('keydown-ESC', () => this.closeDetail());
  }

  /**
   * 게임패드 — 십자키·스틱으로 다니고 A로 고른다.
   *
   * 키보드와 같은 함수를 부르므로 잠금(확정됨·상세 열림·로비 열림)도
   * 똑같이 걸린다. Y는 상세 보기, B는 닫기다.
   */
  override update(): void {
    const taps = this.pads.poll(this.input.gamepad);
    if (taps.left) this.move(-1);
    if (taps.right) this.move(1);
    if (taps.up) this.move(-this.cols);
    if (taps.down) this.move(this.cols);
    if (taps.ok) this.confirm();
    if (taps.info) this.toggleDetail();
    if (taps.back) this.closeDetail();
  }

  /* ================================================================ */
  /* 상세 보기                                                        */
  /* ================================================================ */

  /**
   * 이 캐릭터의 커맨드 열네 개를 통째로 펼친다.
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────
   * 아래 설명 패널은 커맨드를 한 줄로 이어 붙여 보여준다. 다섯 명일 때는
   * 그걸로 됐지만, 이 게임의 가장 큰 자산이 **스무 명 × 열네 개 = 280개의
   * 서로 다른 기술 이름**이 된 지금은 그 한 줄이 자산을 감추고 있다.
   *
   * 처음 보는 사람은 "공격 몇 개 있겠지"로 지나가고, 실제로 열네 개가
   * 전부 다른 이름이라는 것을 영영 모른 채 게임을 닫는다.
   * 표로 펼쳐야 비로소 보인다.
   */
  private toggleDetail(): void {
    if (this.detail) {
      this.closeDetail();
      return;
    }
    if (this.confirmed) return;

    const cfg = CHARACTERS[CHARACTER_ORDER[this.selectedIndex]!];
    const accent = `#${cfg.colors.accent.toString(16).padStart(6, '0')}`;
    sound.play('uiMove');

    const parts: Phaser.GameObjects.GameObject[] = [];

    parts.push(
      // 완전히 덮는다 — 아래 카드가 비치면 표의 글자가 그 위에서 읽히지 않는다
      this.add.rectangle(0, 0, GAME.WIDTH, GAME.HEIGHT, 0x060a16, 1).setOrigin(0),
    );

    parts.push(
      this.add
        .text(GAME.WIDTH / 2, 54, `${cfg.name}  —  ${cfg.realName}`, {
          fontFamily: GAME.FONT,
          fontSize: '34px',
          color: accent,
          fontStyle: 'bold',
        })
        .setOrigin(0.5),
      this.add
        .text(GAME.WIDTH / 2, 92, `"${cfg.tagline}"`, {
          fontFamily: GAME.FONT,
          fontSize: '16px',
          color: '#9fb3dd',
        })
        .setOrigin(0.5),
    );

    /* 두 축 — 늘 유리한 것(패시브)과 다루는 법(고유 메커니즘) */
    parts.push(
      this.add.text(120, 132, `[패시브] ${cfg.passive.name}`, {
        fontFamily: GAME.FONT,
        fontSize: '17px',
        color: '#e8eeff',
        fontStyle: 'bold',
      }),
      this.add.text(120, 158, cfg.passive.desc, {
        fontFamily: GAME.FONT,
        fontSize: '15px',
        color: '#9fb3dd',
        wordWrap: { width: 500 },
      }),
      this.add.text(720, 132, `[고유] ${cfg.signature.icon} ${cfg.signature.name}`, {
        fontFamily: GAME.FONT,
        fontSize: '17px',
        color: accent,
        fontStyle: 'bold',
      }),
      this.add.text(720, 158, `${cfg.signature.desc}\n${cfg.signature.how}`, {
        fontFamily: GAME.FONT,
        fontSize: '15px',
        color: '#9fb3dd',
        lineSpacing: 4,
        wordWrap: { width: 520 },
      }),
    );

    /*
     * 커맨드 열네 개 — 두 단으로 나눠 한 화면에 담는다.
     *
     * MOVE_COMMANDS 에는 연속기 후속타(J→J, J→J→J, K→K)가 빠져 있다.
     * 그건 "다른 입력"이 아니라 "같은 입력을 이어서"라서 조작 안내에서는
     * 따로 다루는 것이 맞지만, **기술 목록**에서 빼면 열네 개 중 셋이
     * 통째로 사라진다. 여기서는 전부 보여야 하므로 이어 붙인다.
     */
    const CHAIN_ROWS: Array<{ slot: MoveSlot; keys: string }> = [
      { slot: 'light2', keys: 'J → J' },
      { slot: 'light3', keys: 'J → J → J' },
      { slot: 'heavy2', keys: 'K → K' },
    ];

    const rows = [...MOVE_COMMANDS, ...CHAIN_ROWS].map((c) => ({
      keys: c.keys,
      move: cfg.moves[c.slot],
    }));
    const half = Math.ceil(rows.length / 2);
    const TOP = 330;
    // 커맨드가 스물하나로 늘면서 한 단이 열 줄이 됐다 — 줄 간격을 좁혀 담는다
    const ROW_H = 30;

    parts.push(
      this.add
        .text(GAME.WIDTH / 2, TOP - 36, `커맨드 ${rows.length}개 — 이름이 전부 다르다`, {
          fontFamily: GAME.FONT,
          fontSize: '15px',
          color: '#6c86c4',
        })
        .setOrigin(0.5),
    );

    rows.forEach((r, i) => {
      const col = i < half ? 0 : 1;
      const y = TOP + (i % half) * ROW_H;
      const x = 120 + col * 620;

      parts.push(
        this.add.text(x, y, r.keys, {
          fontFamily: GAME.FONT,
          fontSize: '15px',
          color: '#ffd54a',
          fontStyle: 'bold',
        }),
        this.add.text(x + 120, y, r.move.name, {
          fontFamily: GAME.FONT,
          fontSize: '16px',
          color: '#e8eeff',
        }),
        // 수치는 옅게 — 이름이 주인공이고 숫자는 곁들이다
        this.add
          .text(x + 470, y, `${r.move.damage}`, {
            fontFamily: GAME.FONT,
            fontSize: '14px',
            color: '#54608a',
          })
          .setOrigin(1, 0),
      );
    });

    /*
     * 삼각형을 한 줄로 알린다.
     *
     * 커맨드 목록은 "무엇을 낼 수 있는가"만 알려준다. 언제 무엇을 내야
     * 하는가는 이 세 줄의 관계에서 나오고, 그건 목록만 봐서는 안 보인다.
     */
    parts.push(
      this.add
        .text(
          GAME.WIDTH / 2,
          GAME.HEIGHT - 78,
          '공격은 가드에 막히고 · 가드는 잡기(U)에 뚫리고 · 잡기는 공격에 진다',
          { fontFamily: GAME.FONT, fontSize: '16px', color: '#c084fc' },
        )
        .setOrigin(0.5),
      this.add
        .text(GAME.WIDTH / 2, GAME.HEIGHT - 44, 'TAB · I · ESC : 닫기', {
          fontFamily: GAME.FONT,
          fontSize: '16px',
          color: '#8fa6d8',
        })
        .setOrigin(0.5),
    );

    this.detail = this.add.container(0, 0, parts).setDepth(DEPTH.OVERLAY);
  }

  private closeDetail(): void {
    this.detail?.destroy();
    this.detail = undefined;
  }

  private move(delta: number): void {
    // 로비가 떠 있으면 뒤에서 카드가 같이 움직이면 안 된다
    if (this.confirmed || this.detail || isNetOverlayOpen()) return;
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
      /*
       * 고른 카드의 빛은 숨을 쉰다.
       * 정지된 밝은 사각형은 "선택됨 상태"로만 읽히는데, 맥동이 있으면
       * "지금 여기"로 읽힌다 — 화면에서 시선이 돌아올 자리가 생긴다.
       */
      this.tweens.killTweensOf(card.glow);
      if (active) {
        card.glow.setAlpha(0.35);
        this.tweens.add({
          targets: card.glow,
          alpha: { from: 0.22, to: 0.5 },
          duration: 700,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
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
    // 패널 색이 캐릭터를 따라간다
    this.infoAccent?.setFillStyle(cfg.colors.accent);
    this.nameText.setColor(
      `#${cfg.colors.accent.toString(16).padStart(6, '0')}`,
    );
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

    /*
     * 마무리 갈래 — 같은 연타인데 마지막에 어디를 누르느냐로 끝이 달라진다.
     *
     * 커맨드 목록에 넣으면 "또 다른 키"처럼 보인다. 실제로는 이미 아는 두
     * 버튼의 쓰임이 늘어난 것이라, 연속기 바로 밑에 붙여야 그렇게 읽힌다.
     */
    const branches =
      `J J 다음에 ↑ ${cfg.moves.lightUp.name} · ↓ ${cfg.moves.lightDown.name}` +
      ` · 앞 ${cfg.moves.lightFwd.name} · 뒤 ${cfg.moves.lightBack.name}`;

    /*
     * 커맨드 전체 목록은 여기 안 적는다.
     *
     * 열넷일 때도 빽빽했는데 스물하나가 되면서 패널을 넘쳐 하단 안내와
     * 겹쳤다 — 읽히지 않는 글자는 정보가 아니라 얼룩이다. 대표 여섯만
     * 보여주고 나머지는 상세 보기(TAB)가 맡는다.
     */
    const featured: MoveSlot[] = [
      'lightFwd',
      'lightBack',
      'heavyUp',
      'heavyDown',
      'dashSlide',
      'airDive',
    ];
    this.movesText.setText(
      `[연속기] ${chains}\n[마무리 갈래] ${branches}\n[기술 ${MOVE_SLOTS.length}개 중] ` +
        featured.map((slot) => `${cfg.moves[slot].name}`).join(' · ') +
        '  …  (TAB 전체 보기)',
    );

    this.quoteText.setText(`“${cfg.quotes.intro[0] ?? ''}”`);
  }

  private confirm(): void {
    // 상세를 보다가 Enter를 누르면 "닫기"로 읽히는 것이 자연스럽다
    if (this.detail) {
      this.closeDetail();
      return;
    }
    if (this.confirmed || this.time.now < this.readyAt) return;
    if (isNetOverlayOpen()) return;

    const picked = CHARACTER_ORDER[this.selectedIndex]!;
    const card = this.cards[this.selectedIndex]!;
    this.tweens.add({
      targets: card.root,
      scale: 1.2,
      duration: 140,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
    sound.play('uiConfirm');

    /*
     * 온라인은 양쪽이 동시에 고른다 — 내 선택을 보내고 상대를 기다린다.
     */
    if (this.online) {
      if (this.myPick) return;
      this.myPick = picked;
      net.sendPick(picked);
      this.refreshPrompt();
      this.tryStartOnline();
      return;
    }


    /*
     * 2인 대전은 한 번 더 고른다.
     *
     * 화면을 따로 만들지 않고 같은 화면에서 차례만 넘긴다. 1P가 고른 뒤
     * 곧바로 2P 차례가 되므로, 두 사람이 같은 자리에서 번갈아 누르면 된다.
     * 다음 입력이 곧장 결정으로 먹지 않도록 여기서도 잠깐 잠근다 —
     * Enter를 꾹 누르고 있으면 둘 다 같은 캐릭터가 되어 버린다.
     */
    if (this.twoPlayer && this.p1Id === null) {
      this.p1Id = picked;
      this.readyAt = this.time.now + 320;
      this.refreshPrompt();
      return;
    }

    this.confirmed = true;

    const playerId = this.p1Id ?? picked;
    const player2Id = this.p1Id ? picked : undefined;

    /*
     * 사람이 늘면 봇이 줄어든다 — 판에 서는 인원은 넷 그대로다.
     * 다섯이 뒤엉키면 화면에서 자기 캐릭터를 놓친다.
     */
    const botCount = AI_COUNT - (player2Id ? 1 : 0);
    const aiIds = pickOpponents(playerId, botCount, [], player2Id ? [player2Id] : []);

    const data: BattleSceneData = { playerId, player2Id, aiIds };
    this.cameras.main.fadeOut(280, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Battle', data);
    });
  }
}

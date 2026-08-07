import Phaser from 'phaser';
import { DEFAULT_STAGE_ART, addBackdrop, hasArt } from '../config/artAssets';
import { STAGE_BY_ID, pickStage } from '../config/stages';
import type { StageConfig, StageId } from '../config/stages';
import { CHARACTERS } from '../config/characters';
import { pickOpponents } from '../config/matchup';
import { carryOverStock, streakDifficulty, streakTitle } from '../config/streak';
import {
  AI_MEDIUM,
  DEPTH,
  FIGHTER,
  GAME,
  STAGE,
  STOCK,
  TIERS,
} from '../config/gameConfig';
import { BaseCharacter, resetQuoteThrottle } from '../characters/BaseCharacter';
import { buildPortrait } from '../characters/CharacterArt';
import { AI_PROMPTS, readPrompt } from '../config/gimmicks';
import { AISystem } from '../systems/AISystem';
import { CombatSystem } from '../systems/CombatSystem';
import { eventBus } from '../systems/EventBus';
import { GimmickSystem } from '../systems/GimmickSystem';
import { ItemSystem } from '../systems/ItemSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';
import { PromptOrbSystem } from '../systems/PromptOrbSystem';
import { RhythmSystem } from '../systems/RhythmSystem';
import { sound } from '../systems/SoundSystem';
import { MatchStats } from '../systems/MatchStats';
import { StockSystem } from '../systems/StockSystem';
import { BannerLanes } from '../ui/BannerLanes';
import { closePromptOverlay, openPromptOverlay } from '../ui/PromptOverlay';
import { StockTier } from '../types';
import type { AIDifficulty, AttackDir, BattleSceneData } from '../types';

/** HUD 한 칸(파이터 1명분) */
interface FighterHud {
  fighter: BaseCharacter;
  percent: Phaser.GameObjects.Text;
  tierLabel: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
  skillBar: Phaser.GameObjects.Rectangle;
  skillLabel: Phaser.GameObjects.Text;
  itemIcon: Phaser.GameObjects.Text;
  /** 캐릭터 고유 자원 표시 (지분·부스터·풍선…) */
  sigLabel: Phaser.GameObjects.Text;
}

/** HUD 패널 규격 — 4명이 한 줄에 들어가야 한다 */
const HUD_PANEL_W = 296;
const HUD_PANEL_H = 78;
const HUD_GAP = 16;
const HUD_Y = 624;
/** 주가 진행바 길이 */
const HUD_BAR_W = 186;

/**
 * 전투 씬 — 게임의 본체.
 *
 * 담당:
 *  - 스테이지/파이터 생성, 입력 처리, 시스템 구동 순서 관리
 *  - 장외 판정, 승패 판정, HUD 표시
 *
 * 주가 계산은 StockSystem, 타격 판정/연출은 CombatSystem, 봇은 AISystem이 맡는다.
 */
export class BattleScene extends Phaser.Scene {
  private battleData!: BattleSceneData;
  /** 이번 판의 무대 — 발판 배치 · 중력 · 색 · 배경이 여기서 나온다 */
  private stage!: StageConfig;
  /**
   * 바로 앞 판의 무대.
   *
   * 씬 인스턴스는 재시작해도 살아 있으므로 여기에 남는다. 같은 곳이 두세 번
   * 연달아 나오면 "맵이 여러 개"라는 사실 자체가 전달되지 않는다.
   */
  private lastStageId?: StageId;

  private ground!: Phaser.GameObjects.Rectangle;
  private platforms: Phaser.GameObjects.Rectangle[] = [];
  /** 발판의 겉모습 — 판정 사각형과 함께 켜고 끈다 */
  private platformSkins: Phaser.GameObjects.GameObject[] = [];
  /** 생성한 스테이지 그림 레이어 (없으면 보이지 않는다) */
  private bgArt?: Phaser.GameObjects.Image;
  /** 배경 위에 까는 어둠 막 — 밝은 그림 위에서도 캐릭터가 읽히게 한다 */
  private bgScrim?: Phaser.GameObjects.Image;
  /** 맵 기믹이 요청한 배경들 — 맨 위가 지금 보이는 것 */
  private stageArtStack: string[] = [];
  private fighters: BaseCharacter[] = [];
  private player!: BaseCharacter;
  private ais: AISystem[] = [];

  private stock!: StockSystem;
  private combat!: CombatSystem;
  private projectiles!: ProjectileSystem;
  private items!: ItemSystem;
  private orbs!: PromptOrbSystem;
  private gimmicks!: GimmickSystem;
  private rhythm!: RhythmSystem;
  /** 이 판의 전적 — 결과 화면에서 보여준다 */
  private stats!: MatchStats;
  /** 지금까지 이긴 판 수 */
  private streak = 0;
  /** 결과 화면에서 SPACE 가 다음 판으로 이어지는가 (이겼을 때만) */
  private canContinue = false;
  /** 이번 판의 봇 난이도 — 연승이 쌓이면 판단이 빨라진다 */
  private difficulty: AIDifficulty = AI_MEDIUM;

  /** 프롬프트 입력 중 — 전투를 멈추고 조작을 막는다 */
  private prompting = false;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private huds: FighterHud[] = [];
  private muteLabel!: Phaser.GameObjects.Text;
  /** 연속기 안내 — 지금 이어 칠 수 있는 다음 타를 알려준다 */
  private chainHint!: Phaser.GameObjects.Text;
  /** 방금 낸 기술 이름 */
  private moveName!: Phaser.GameObjects.Text;
  /** 진행 중인 프롬프트 기믹 표시 */
  private gimmickHud!: Phaser.GameObjects.Text;
  /**
   * 상단 중앙 배너 자리 배분.
   * 기믹 배너 · 리듬 게이지 · 오브 알림이 서로 겹치지 않게 나눠 쓴다.
   */
  private banners!: BannerLanes;
  /** 지금 떠 있는 중앙 안내 — 새 안내가 오면 겹치지 않게 치운다 */
  private announceLabel?: Phaser.GameObjects.Text;
  /** 화면에 고정되는 HUD 레이어 (카메라 스크롤을 따라가지 않는다) */
  private hudLayer!: Phaser.GameObjects.Container;
  /** 더블탭 대시 판정용 */
  private lastTapDir: -1 | 0 | 1 = 0;
  private lastTapAt = 0;

  private paused = false;
  private pauseOverlay?: Phaser.GameObjects.Container;

  /** 전투 진행 중인가 (인트로/결과 화면에서는 false) */
  private battleActive = false;
  /** EventBus 구독 해제 함수들 */
  private disposers: Array<() => void> = [];
  /** 상장폐지된 순서 — 등수 계산에 쓴다 */
  private koOrder: string[] = [];

  constructor() {
    super({ key: 'Battle' });
  }

  create(data: BattleSceneData): void {
    this.battleData = data;
    this.fighters = [];
    this.ais = [];
    this.huds = [];
    this.platforms = [];
    this.platformSkins = [];
    this.stageArtStack = [];
    this.announceLabel = undefined;
    this.disposers = [];
    this.koOrder = [];
    this.battleActive = false;
    this.canContinue = false;
    this.streak = data.streak ?? 0;
    resetQuoteThrottle();

    // 앞 판의 집계가 남아 있으면 두 판이 합산된다
    this.stats?.destroy();
    this.stats = new MatchStats();

    this.stage =
      (data.stageId && STAGE_BY_ID[data.stageId as StageId]) || pickStage(this.lastStageId);
    this.lastStageId = this.stage.id;
    // 중력은 무대가 정한다. 맵 기믹이 잠시 덮어써도 끝나면 이 값으로 돌아온다
    this.physics.world.gravity.y = GAME.GRAVITY * this.stage.gravityMul;

    this.buildBackground();
    this.buildStage();
    this.spawnFighters();
    this.setupSystems();
    this.buildHud();
    this.bindInput();
    this.bindEvents();
    this.playIntro();

    sound.startBgm('battle');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    // 월드가 화면보다 넓다 — 카메라가 월드 밖을 비추지 않도록 경계를 준다
    this.cameras.main.setBounds(0, 0, GAME.WORLD_WIDTH, GAME.HEIGHT);
    this.physics.world.setBounds(0, 0, GAME.WORLD_WIDTH, GAME.HEIGHT);
    this.cameras.main.fadeIn(280, 0, 0, 0);
  }

  /* ================================================================ */
  /* 스테이지 구성                                                    */
  /* ================================================================ */

  /**
   * 배경은 한 번만 그려 텍스처로 굽는다.
   *
   * Graphics 객체는 매 프레임 명령 목록을 다시 삼각형으로 분할하므로,
   * 캔들 수십 개 + 꺾은선을 그대로 두면 정적인 그림에 매 프레임 비용을 낸다.
   * 구운 뒤에는 이미지 1장 = 드로우콜 1회로 끝난다.
   *
   * 생성한 스테이지 그림(public/bg/stage_*.png)이 있으면 이 위에 덮어 깐다.
   * 도형 배경은 지우지 않고 남겨 둔다 — 맵 기믹으로 갈아 끼울 그림이
   * 아직 없을 때 그 아래에서 받쳐 주는 바닥이 된다.
   */
  private buildBackground(): void {
    const KEY = 'battle-bg';

    if (!this.textures.exists(KEY)) {
      const W = GAME.WORLD_WIDTH;
      const g = this.make.graphics({ x: 0, y: 0 }, false);

      // 하늘 — 아래로 갈수록 밝아지는 4단 그라데이션
      const bands = [0x070b18, 0x0b1020, 0x131c36, 0x1b2748];
      bands.forEach((color, i) => {
        g.fillStyle(color, 1);
        g.fillRect(0, i * (GAME.HEIGHT / 4), W, GAME.HEIGHT / 4);
      });

      // 캔들스틱 실루엣
      g.setAlpha(0.1);
      for (let x = 30; x < W; x += 46) {
        const h = Phaser.Math.Between(30, 150);
        const cy = Phaser.Math.Between(240, 470);
        const up = Phaser.Math.Between(0, 1) === 1;
        g.fillStyle(up ? 0x4ade80 : 0xef4444, 1);
        g.fillRect(x, cy - h / 2, 16, h);
        g.fillRect(x + 6, cy - h / 2 - 14, 4, h + 28);
      }

      // 주가 꺾은선 — 게임 테마를 드러내는 장식
      g.setAlpha(0.16);
      g.lineStyle(4, 0x4ade80, 1);
      let y = 420;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= W; x += 48) {
        y = Phaser.Math.Clamp(y + Phaser.Math.Between(-42, 30), 120, 520);
        g.lineTo(x, y);
      }
      g.strokePath();

      g.generateTexture(KEY, W, GAME.HEIGHT);
      g.destroy();
    }

    this.add.image(0, 0, KEY).setOrigin(0).setDepth(DEPTH.BG);

    /*
     * 스테이지 그림 레이어.
     *
     * 항상 만들어 두고 텍스처만 갈아 끼운다. 기믹이 걸릴 때마다 이미지를
     * 새로 만들면 페이드가 겹칠 때 이전 장이 남아 두 장이 포개진다.
     */
    this.bgArt = this.add
      .image(0, 0, 'pixel')
      .setOrigin(0)
      .setDepth(DEPTH.BG + 1)
      /*
       * 시차(視差) — 배경은 월드보다 천천히 흐른다.
       *
       * 같은 속도로 흐르면 배경이 발판에 붙어 있는 벽지처럼 보인다.
       * 0.55배로 늦추면 그림이 뒤로 물러나 앉아 공간에 깊이가 생긴다.
       * 그림 폭이 월드 폭(1920)이라 카메라가 끝까지 가도 빈자리가 생기지 않는다.
       */
      .setScrollFactor(0.55)
      .setVisible(false);

    this.buildStageScrim();
    this.applyStageArt(true);
  }

  /**
   * 배경 위에 얹는 어둠 막.
   *
   * 생성한 배경은 밝기가 제각각이다. 밝은 그림이 오면 그 위의 캐릭터·발판이
   * 묻혀 어디가 밟을 수 있는 곳인지 안 보인다. 프롬프트에 "어둡게"라고 적어
   * 뒀지만 매번 지켜지지는 않는다 — 게임 쪽에서도 받쳐 줘야 한다.
   *
   * 전체를 고르게 덮지 않고 **아래로 갈수록 짙게** 깐다. 전투는 아래쪽에서
   * 벌어지고, 위쪽은 그림을 보여 주는 자리이기 때문이다.
   * 배경 그림이 없으면(코드로 그린 배경) 만들지 않는다. 이미 어둡다.
   */
  private buildStageScrim(): void {
    const KEY = 'stage-scrim';

    if (!this.textures.exists(KEY)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      const steps = 32;

      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        /*
         * 위 12% → 아래 62%. 곡선을 살짝 눕혀(제곱) 위쪽은 거의 건드리지 않고
         * 아래쪽만 확실히 눌러 준다.
         */
        g.fillStyle(0x050a16, 0.12 + 0.5 * t * t);
        g.fillRect(0, (GAME.HEIGHT / steps) * i, 8, GAME.HEIGHT / steps + 1);
      }
      g.generateTexture(KEY, 8, GAME.HEIGHT);
      g.destroy();
    }

    this.bgScrim = this.add
      .image(0, 0, KEY)
      .setOrigin(0)
      .setDisplaySize(GAME.WIDTH, GAME.HEIGHT)
      .setScrollFactor(0)
      .setDepth(DEPTH.BG + 2)
      .setVisible(false);
  }

  /**
   * 맵 기믹이 도는 동안 배경을 갈아 끼운다.
   * 되돌리는 함수를 돌려주며, 여러 기믹이 겹치면 마지막에 걸린 쪽이 보인다.
   */
  pushStageArt(key: string): () => void {
    this.stageArtStack.push(key);
    this.applyStageArt();

    let popped = false;
    return () => {
      if (popped) return;
      popped = true;
      const i = this.stageArtStack.lastIndexOf(key);
      if (i >= 0) this.stageArtStack.splice(i, 1);
      this.applyStageArt();
    };
  }

  /** 지금 보여야 할 배경 그림을 정해 반영한다 */
  private applyStageArt(immediate = false): void {
    /*
     * 씬이 내려간 뒤에도 불릴 수 있다.
     *
     * 재시작(R)은 맵 기믹이 도는 중에도 눌린다. 그때 GimmickSystem.reset()이
     * 되돌리기를 실행하는데, 그 시점이면 표시 객체는 이미 파괴된 뒤다.
     * (파괴된 GameObject는 scene 참조를 잃는다)
     */
    if (!this.bgArt?.scene) return;

    /*
     * 기믹이 걸려 있으면 그 그림, 아니면 이 무대의 그림.
     * 무대 그림이 아직 없으면(안 그렸으면) 기본 거래소로 떨어진다 —
     * 맵을 늘렸다고 배경이 사라지면 늘리지 않느니만 못하다.
     */
    const wanted = this.stageArtStack[this.stageArtStack.length - 1];
    const key =
      wanted && hasArt(this, wanted)
        ? wanted
        : hasArt(this, this.stage.art)
          ? this.stage.art
          : hasArt(this, DEFAULT_STAGE_ART)
            ? DEFAULT_STAGE_ART
            : null;

    if (!key) {
      this.bgArt.setVisible(false);
      this.bgScrim?.setVisible(false);
      return;
    }
    if (this.bgArt.visible && this.bgArt.texture.key === key) return;

    this.bgArt.setTexture(key);
    this.bgArt.setDisplaySize(GAME.WORLD_WIDTH, GAME.HEIGHT);
    this.bgArt.setVisible(true);
    this.bgScrim?.setVisible(true);

    // 장소가 바뀐 것이 눈에 들어오도록 짧게 밝혔다 가라앉힌다
    this.tweens.killTweensOf(this.bgArt);
    if (immediate) {
      this.bgArt.setAlpha(1);
      return;
    }
    this.bgArt.setAlpha(0);
    this.tweens.add({ targets: this.bgArt, alpha: 1, duration: 260 });
  }

  /**
   * 발판 무늬를 한 번 구워 둔다.
   *
   * 밋밋한 파란 막대는 배경이 도형이던 시절의 것이다. 실제 그림 배경이
   * 들어오자 "게임 오브젝트만 따로 논다"가 눈에 띈다. 거래소답게 전광판
   * 눈금을 새겨 넣으면 같은 세계의 물건으로 읽힌다.
   */
  private stageTexture(key: string, w: number, h: number, tick: number): string {
    if (this.textures.exists(key)) return key;

    const g = this.make.graphics({ x: 0, y: 0 }, false);

    // 몸통 — 위가 밝고 아래로 갈수록 어두운 금속
    const bands = [0x46598f, 0x3a4c80, 0x2e3d6b, 0x25325a];
    bands.forEach((c, i) => {
      g.fillStyle(c, 1);
      g.fillRect(0, (h / bands.length) * i, w, h / bands.length + 1);
    });

    // 전광판 눈금 — 촘촘한 세로선
    g.fillStyle(0x93c5fd, 0.22);
    for (let x = 6; x < w; x += tick) g.fillRect(x, h * 0.45, 2, h * 0.4);

    // 착지선 — 여기가 밟히는 자리다
    g.fillStyle(0xbfdbfe, 1);
    g.fillRect(0, 0, w, 3);
    g.fillStyle(0x60a5fa, 0.85);
    g.fillRect(0, 3, w, 2);

    // 아래 그림자
    g.fillStyle(0x141d38, 1);
    g.fillRect(0, h - 3, w, 3);

    g.generateTexture(key, w, h);
    g.destroy();
    return key;
  }

  private buildStage(): void {
    const width = STAGE.RIGHT - STAGE.LEFT;
    const cx = (STAGE.LEFT + STAGE.RIGHT) / 2;

    /* 판정용 사각형은 그대로 두고 보이는 것만 무늬로 덮는다 */
    this.ground = this.add
      .rectangle(cx, STAGE.GROUND_Y + STAGE.GROUND_H / 2, width, STAGE.GROUND_H, 0x3a4c80)
      .setDepth(DEPTH.STAGE)
      .setVisible(false);
    this.physics.add.existing(this.ground, true);

    this.add
      .image(cx, STAGE.GROUND_Y, this.stageTexture('stage-ground', 64, STAGE.GROUND_H, 9))
      .setOrigin(0.5, 0)
      .setDisplaySize(width, STAGE.GROUND_H)
      .setDepth(DEPTH.STAGE);

    /* 착지선 위로 새어 나오는 빛 — 바닥이 발광하는 물건처럼 보이게 한다 */
    this.add
      .rectangle(cx, STAGE.GROUND_Y - 3, width, 10, this.stage.accent, 0.28)
      .setDepth(DEPTH.STAGE + 1)
      .setBlendMode(Phaser.BlendModes.ADD);

    // 아래로 뻗은 지지대
    this.add
      .rectangle(cx, STAGE.GROUND_Y + STAGE.GROUND_H + 60, width - 120, 120, 0x1c2749)
      .setDepth(DEPTH.STAGE - 1);

    // 장외 경고선
    [STAGE.LEFT, STAGE.RIGHT].forEach((px) => {
      this.add
        .rectangle(px, STAGE.GROUND_Y - 220, 3, 440, 0xef4444, 0.2)
        .setDepth(DEPTH.STAGE);
    });

    this.buildPlatforms();
  }

  /**
   * 공중 발판.
   *
   * 아래에서 점프해 통과하고 위에서만 착지하도록 아래쪽 충돌을 끈다.
   * (막혀 있으면 점프로 올라갈 수 없어 발판이 벽이 되어버린다)
   */
  private buildPlatforms(): void {
    const tex = this.stageTexture('stage-plat', 48, STAGE.PLATFORM_H, 7);

    for (const p of this.stage.platforms) {
      /*
       * 판정은 사각형이 맡고 겉모습은 무늬 이미지가 맡는다.
       * 발판 붕괴 기믹이 이 사각형의 visible을 끄므로, 무늬도 같이 붙여 두고
       * 함께 사라지게 컨테이너로 묶는다.
       */
      const plat = this.add
        .rectangle(p.x, p.y, p.w, STAGE.PLATFORM_H, 0x3a4c80)
        .setDepth(DEPTH.STAGE)
        .setVisible(false);
      this.physics.add.existing(plat, true);

      const body = plat.body as Phaser.Physics.Arcade.StaticBody;
      body.checkCollision.down = false;
      body.checkCollision.left = false;
      body.checkCollision.right = false;

      const skin = this.add
        .image(p.x, p.y - STAGE.PLATFORM_H / 2, tex)
        .setOrigin(0.5, 0)
        .setDisplaySize(p.w, STAGE.PLATFORM_H)
        .setDepth(DEPTH.STAGE);

      const glow = this.add
        .rectangle(p.x, p.y - STAGE.PLATFORM_H / 2 - 2, p.w, 8, this.stage.accent, 0.25)
        .setDepth(DEPTH.STAGE + 1)
        .setBlendMode(Phaser.BlendModes.ADD);

      /*
       * 무늬를 판정 사각형에 매달아 둔다.
       * 발판 붕괴 기믹이 발판을 지울 때, 겉모습만 남아 떠 있으면
       * "있는데 안 밟히는 발판"이 되어 조작이 고장난 것처럼 보인다.
       */
      plat.setData('skins', [skin, glow]);
      this.platformSkins.push(skin, glow);
      this.platforms.push(plat);
    }
  }

  /* ================================================================ */
  /* 파이터 생성                                                      */
  /* ================================================================ */

  private spawnFighters(): void {
    const spawnY = STAGE.GROUND_Y - FIGHTER.BODY_H;
    const total = 1 + this.battleData.aiIds.length;

    /*
     * 연승이 쌓일수록 봇이 빨라진다.
     *
     * 피해량이나 체력이 아니라 **판단 주기와 반응 지연**만 줄인다.
     * 수치를 손대면 "봇이 잘한다"가 아니라 "봇이 치트를 쓴다"로 느껴진다.
     */
    this.difficulty = streakDifficulty(this.streak);

    /*
     * 스테이지 폭을 인원수로 나눠 고르게 배치한다.
     * 플레이어는 맨 왼쪽에서 시작해 오른쪽을 본다.
     */
    const usable = STAGE.RIGHT - STAGE.LEFT - 260;
    const gap = total > 1 ? usable / (total - 1) : 0;
    const startX = STAGE.LEFT + 130;

    this.player = new BaseCharacter(
      this,
      startX,
      spawnY,
      CHARACTERS[this.battleData.playerId],
      'player',
      'P1',
    );
    this.player.facing = 1;
    this.fighters.push(this.player);

    this.battleData.aiIds.forEach((id, i) => {
      const bot = new BaseCharacter(
        this,
        startX + gap * (i + 1),
        spawnY,
        CHARACTERS[id],
        'ai',
        `CPU${i + 1}`,
      );
      bot.facing = -1;
      this.fighters.push(bot);
    });

    /* 지면·발판 충돌 + 파이터 간 밀림 */
    this.fighters.forEach((f) => {
      this.physics.add.collider(f, this.ground);
      this.platforms.forEach((p) => this.physics.add.collider(f, p));
    });
    this.physics.add.collider(this.fighters, this.fighters);
  }

  private setupSystems(): void {
    this.stock = new StockSystem(eventBus);
    this.projectiles = new ProjectileSystem(this);
    this.combat = new CombatSystem(this, this.stock, eventBus);

    this.fighters.forEach((f) => {
      // 연승 도전은 플레이어만 앞 판의 주가를 이어받는다
      this.stock.register(
        f,
        f.side === 'player' ? (this.battleData.startStock ?? STOCK.START) : STOCK.START,
      );
      // 투사체 스킬(빌 게이츠맨의 블루스크린 등) 발사 연결
      f.onSpawnProjectile = (owner, atk) => this.projectiles.spawn(owner, atk);
      // 로켓 드롭 착지 충격파
      f.onShockwave = (owner, atk) => this.combat.triggerShockwave(owner, atk);
    });
    this.combat.setFighters(this.fighters);
    this.combat.setProjectiles(this.projectiles);

    this.items = new ItemSystem(this, this.stock);
    this.items.setFighters(this.fighters);
    // 폭탄은 일반 타격과 같은 경로로 처리해야 넉백·히트스탑이 붙는다
    this.items.onExplode = (x, y, range, damage) =>
      this.combat.triggerBlast(x, y, range, damage);

    /* 프롬프트 기믹 — 이 게임의 스매시볼 */
    this.banners = new BannerLanes();
    this.rhythm = new RhythmSystem(this, this.banners);
    this.gimmicks = new GimmickSystem(this, {
      fighters: () => this.fighters,
      items: this.items,
      stock: this.stock,
      rhythm: this.rhythm,
      platforms: () => this.platforms,
      stageArt: (key) => this.pushStageArt(key),
    });

    this.orbs = new PromptOrbSystem(this, this.banners);
    this.orbs.setFighters(this.fighters);
    this.orbs.setProjectiles(this.projectiles);
    this.orbs.onBreak = (breaker) => void this.runPrompt(breaker);

    // 룰이 바꾼 피해 배율 + 리듬 판정을 전투 계산에 얹는다
    this.combat.setDamageHook((ctx) => {
      let mul = this.gimmicks.getDamageMultiplier();

      const judge = this.rhythm.judge(this.time.now);
      if (judge) {
        mul *= judge.mul;
        this.rhythm.showJudge(ctx.x, ctx.y, judge);
      }
      return mul;
    });

    /* AI 부착 — 플레이어를 추적 대상으로 삼는다 */
    this.fighters
      .filter((f) => f.side === 'ai')
      .forEach((bot) => {
        this.ais.push(
          new AISystem(
            bot,
            () => this.pickAiTarget(bot),
            this.difficulty,
            { castSkill: (f) => this.castSkill(f) },
          ),
        );
      });
  }

  /** AI가 노릴 대상 — 자기 자신을 제외한 가장 가까운 생존자 */
  private pickAiTarget(self: BaseCharacter): BaseCharacter | null {
    let best: BaseCharacter | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const f of this.fighters) {
      if (f === self || !f.alive) continue;
      const d = Math.abs(f.x - self.x);
      if (d < bestDist) {
        bestDist = d;
        best = f;
      }
    }
    return best;
  }

  /* ================================================================ */
  /* 입력                                                             */
  /* ================================================================ */

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (!kb) return;

    /*
     * W는 점프가 아니라 "위" 방향키다.
     *
     * W+J / W+K 로 상단기를 내려면 W를 누른 채 버튼을 눌러야 하는데,
     * W가 점프까지 겸하면 상단기를 낼 때마다 먼저 떠버려 지상 상단기를
     * 낼 방법이 없어진다. 점프는 SPACE와 ↑ 로 나눴다.
     */
    this.keys = kb.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      jump: Phaser.Input.Keyboard.KeyCodes.SPACE,
      jumpAlt: Phaser.Input.Keyboard.KeyCodes.UP,
      light: Phaser.Input.Keyboard.KeyCodes.J,
      heavy: Phaser.Input.Keyboard.KeyCodes.K,
      skill: Phaser.Input.Keyboard.KeyCodes.L,
      taunt: Phaser.Input.Keyboard.KeyCodes.T,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // 스페이스바로 페이지가 스크롤되지 않도록 캡처
    kb.addCapture([
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
    ]);

    kb.on('keydown-R', () => this.scene.start('Battle', this.battleData));
    kb.on('keydown-SPACE', () => this.startNextRound());
    kb.on('keydown-ESC', () => this.scene.start('Select'));
    kb.on('keydown-P', () => this.togglePause());
    kb.on('keydown-M', () => {
      const muted = sound.toggleMute();
      this.muteLabel.setText(muted ? '🔇 M' : '🔊 M');
    });
  }

  private handleInput(): void {
    const p = this.player;
    if (!p.alive) return;

    const JustDown = Phaser.Input.Keyboard.JustDown;
    const left = this.keys.left!.isDown;
    const right = this.keys.right!.isDown;
    const up = this.keys.up!.isDown;
    const down = this.keys.down!.isDown;
    const onGround = p.body.blocked.down || p.body.touching.down;

    /* 공격 방향 — 같은 버튼이라도 W/S를 함께 누르면 다른 기술이 나간다 */
    const dir: AttackDir = up ? 'up' : down ? 'down' : 'neutral';

    /* A/D 더블탭 → 대시 */
    if (JustDown(this.keys.left!) && this.checkDoubleTap(-1)) p.dash(-1);
    if (JustDown(this.keys.right!) && this.checkDoubleTap(1)) p.dash(1);

    /* 조작 반전 룰이 걸려 있으면 좌우가 뒤집힌다 */
    let move: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;
    if (this.gimmicks.isReversed()) move = -move as -1 | 0 | 1;
    p.moveHorizontal(move);

    if (JustDown(this.keys.jump!) || JustDown(this.keys.jumpAlt!)) p.jump();
    if (JustDown(this.keys.light!)) p.attack('light', dir);
    if (JustDown(this.keys.heavy!)) p.attack('heavy', dir);
    if (JustDown(this.keys.skill!)) this.castSkill(p);
    if (JustDown(this.keys.taunt!)) p.taunt();

    /*
     * S — 지상에서는 방어, 공중에서는 급강하.
     *
     * 공격 판정보다 뒤에 둬야 S+J/K 하단기가 방어에 막히지 않는다.
     * (공격 중이면 setGuard가 스스로 방어를 걸지 않는다)
     */
    p.setGuard(down && onGround);
    if (down && !onGround) p.fastFall();
  }

  /** 같은 방향키를 짧은 간격으로 두 번 눌렀는가 */
  private checkDoubleTap(dir: -1 | 1): boolean {
    const now = this.time.now;
    const isDouble =
      this.lastTapDir === dir && now - this.lastTapAt <= FIGHTER.DOUBLE_TAP_MS;

    this.lastTapDir = dir;
    this.lastTapAt = now;
    // 3연타가 연속 대시로 이어지지 않도록 기록을 지운다
    if (isDouble) this.lastTapDir = 0;
    return isDouble;
  }

  /** 일시정지 토글 (P) */
  private togglePause(): void {
    if (!this.battleActive && !this.paused) return;

    this.paused = !this.paused;

    if (this.paused) {
      this.physics.world.pause();
      this.pauseOverlay = this.add
        .container(0, 0, [
          this.add
            .rectangle(0, 0, GAME.WIDTH, GAME.HEIGHT, 0x000000, 0.6)
            .setOrigin(0),
          this.add
            .text(GAME.WIDTH / 2, GAME.HEIGHT / 2 - 20, '일시정지', {
              fontFamily: GAME.FONT,
              fontSize: '52px',
              color: '#ffffff',
              fontStyle: 'bold',
            })
            .setOrigin(0.5),
          this.add
            .text(GAME.WIDTH / 2, GAME.HEIGHT / 2 + 40, 'P : 계속      R : 재시작      ESC : 캐릭터 선택', {
              fontFamily: GAME.FONT,
              fontSize: '17px',
              color: '#8fa6d8',
            })
            .setOrigin(0.5),
        ])
        .setDepth(DEPTH.OVERLAY + 5)
        .setScrollFactor(0);
    } else {
      this.physics.world.resume();
      this.pauseOverlay?.destroy();
      this.pauseOverlay = undefined;
    }
  }

  /**
   * 카메라 — 살아있는 파이터들의 중앙을 따라간다.
   *
   * 줌은 하지 않는다. 스크롤만 하면 HUD에 scrollFactor(0)만 주면 되지만,
   * 줌까지 넣으면 HUD가 함께 확대돼 UI 전용 카메라가 필요해진다.
   * 넓어진 맵을 보여주는 목적에는 스크롤만으로 충분하다.
   */
  private updateCamera(delta: number): void {
    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    for (const f of alive) {
      minX = Math.min(minX, f.x);
      maxX = Math.max(maxX, f.x);
    }

    // 플레이어가 살아있으면 조금 더 플레이어 쪽에 무게를 둔다
    const mid = (minX + maxX) / 2;
    const targetX = this.player.alive ? (mid + this.player.x) / 2 : mid;

    const cam = this.cameras.main;
    const desired = Phaser.Math.Clamp(
      targetX - GAME.WIDTH / 2,
      0,
      GAME.WORLD_WIDTH - GAME.WIDTH,
    );

    // delta 기반 보간 — 프레임률이 달라도 같은 속도로 따라간다
    const t = 1 - Math.pow(0.0015, delta / 1000);
    /*
     * 타격 순간의 카메라 킥을 마지막에 더한다.
     * 보간값에 섞으면 킥이 추적 목표를 끌고 다녀 화면이 붙잡히므로,
     * 추적은 그대로 두고 결과에만 오프셋을 얹는다.
     */
    const kick = this.combat.getCameraKick();
    cam.setScroll(Phaser.Math.Linear(cam.scrollX, desired, t) + kick, 0);
  }

  /** 스킬 시전 — 시전 시 부가 효과(도박 등)까지 처리한다 */
  private castSkill(fighter: BaseCharacter): boolean {
    if (!fighter.useSkill()) return false;
    this.combat.onSkillCast(fighter);
    return true;
  }

  /* ================================================================ */
  /* 이벤트 연결                                                      */
  /* ================================================================ */

  private bindEvents(): void {
    this.disposers.push(
      eventBus.on('fighter:ko', (p) => {
        const victim = this.findFighter(p.fighterId);
        if (!victim || !victim.alive) return;

        victim.kill();
        this.koOrder.push(p.fighterId);
        this.announce(`${p.name} 상장폐지!`, '#ff5a5a', 1400);
        this.cameras.main.shake(340, 0.02);

        const killer = p.killerId ? this.findFighter(p.killerId) : null;
        killer?.say(killer.pickQuote('ko'), 0xffd54a);

        /*
         * 넷 중 둘이 남으면 곡을 한 단 올린다.
         * 여기부터가 실질적인 결승이고, 그 사실을 화면 말고 곡으로도 알린다.
         * (서든데스가 걸려 있으면 이미 2단계이므로 내리지 않는다)
         */
        if (this.fighters.filter((f) => f.alive).length === 2) {
          sound.setIntensity(1);
        }

        this.time.delayedCall(900, () => this.checkBattleEnd());
      }),

      eventBus.on('stock:tier', (p) => {
        const f = this.findFighter(p.fighterId);
        if (!f || !f.alive) return;

        // 떡상 진입 시 명대사 + 상승 연출
        if (p.tier >= StockTier.SURGE_1 && p.tier > p.prevTier) {
          f.say(f.pickQuote('surge'), TIERS[p.tier].color);
          f.pulseSquash(0.8, 1.3, 220);
          sound.play('surge');
        }
      }),

      eventBus.on('combat:hit', (p) => {
        const attacker = this.findFighter(p.attackerId);
        const target = this.findFighter(p.targetId);

        // 위기 상태에서 반격에 성공하면 역전 대사
        // 4명이 동시에 떠들지 않도록 확률을 낮춰 잡았다
        if (
          attacker &&
          this.stock.getTier(p.attackerId) <= StockTier.CRISIS &&
          Phaser.Math.FloatBetween(0, 1) < 0.22
        ) {
          attacker.say(attacker.pickQuote('comeback'), 0xef4444);
        } else if (target && Phaser.Math.FloatBetween(0, 1) < 0.08) {
          target.say(target.pickQuote('hurt'), 0xcbd5e1);
        }
      }),
    );
  }

  private findFighter(id: string): BaseCharacter | null {
    return this.fighters.find((f) => f.fighterId === id) ?? null;
  }

  /* ================================================================ */
  /* 인트로 / 승패                                                    */
  /* ================================================================ */

  private playIntro(): void {
    /*
     * 무대 이름을 먼저 띄운다.
     *
     * 맵이 무작위로 바뀌는데 아무 말이 없으면, 플레이어는 발판이 달라진 것을
     * "왜 오늘따라 이상하지"로 받아들인다. 이름과 한 줄 설명을 보여 주면
     * 같은 변화가 "이번엔 여기구나"가 된다.
     *
     * 자리는 READY?/FIGHT! 보다 위다. 같은 줄에 두면 두 글자가 포개져
     * 둘 다 안 읽힌다 — 무대 이름은 개시 연출과 겹치는 시간대에 뜬다.
     */
    this.showStageBanner();

    this.time.delayedCall(320, () => this.announce('READY?', '#facc15'));

    this.time.delayedCall(1200, () => {
      this.announce('FIGHT!', '#ff5a5a');
      this.battleActive = true;
      this.items.start();
      this.orbs.start();
      this.player.say(this.player.pickQuote('intro'), this.player.cfg.colors.accent);
    });

    // AI가 여럿이므로 대사를 한 명씩 순서대로 띄운다 (한꺼번에 뜨면 안 읽힌다)
    this.fighters
      .filter((f) => f.side === 'ai')
      .forEach((f, i) => {
        this.time.delayedCall(1700 + i * 700, () => {
          if (f.alive) f.say(f.pickQuote('intro'), f.cfg.colors.accent);
        });
      });
  }

  /**
   * 지금 무대가 무엇인지.
   *
   * 발판 배치는 스크린샷으로도 보이지만, 중력처럼 보이지 않는 것은
   * 화면으로 확인할 방법이 없다. 검사가 직접 읽는다.
   */
  getStageInfo(): { id: string; name: string; platforms: number; gravity: number } {
    return {
      id: this.stage.id,
      name: this.stage.name,
      platforms: this.platforms.length,
      gravity: this.physics.world.gravity.y,
    };
  }

  /** 무대 이름 — 화면 위쪽에서 잠깐 떴다 사라진다 */
  private showStageBanner(): void {
    const accent = `#${this.stage.accent.toString(16).padStart(6, '0')}`;

    const name = this.add
      .text(GAME.WIDTH / 2, 146, this.stage.name, {
        fontFamily: GAME.FONT,
        fontSize: '30px',
        color: accent,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    /*
     * 연승 중이면 몇 판째인지 함께 알린다.
     * 상대가 빨라진 것을 몸으로만 느끼면 "봇이 이상하다"가 되고,
     * 숫자를 보면 "내가 여기까지 왔다"가 된다.
     */
    const line = this.streak > 0
      ? `${this.streak + 1}번째 판 · ${this.streak}연승 중 · ${this.stage.desc}`
      : this.stage.desc;

    const desc = this.add
      .text(GAME.WIDTH / 2, 178, line, {
        fontFamily: GAME.FONT,
        fontSize: '15px',
        color: this.streak > 0 ? '#ffd54a' : '#9fb3dd',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    // announce 와 같은 방식 — 화면 고정 + 최상단. 컨테이너에 넣으면 좌표가 꼬인다
    [name, desc].forEach((t) => t.setScrollFactor(0).setDepth(DEPTH.OVERLAY));
    name.setStroke('#0b1020', 7);
    desc.setStroke('#0b1020', 5);

    this.tweens.add({
      targets: [name, desc],
      alpha: 1,
      y: '-=12',
      duration: 300,
      ease: 'Cubic.Out',
      onComplete: () => {
        this.tweens.add({
          targets: [name, desc],
          alpha: 0,
          delay: 1500,
          duration: 400,
          onComplete: () => {
            name.destroy();
            desc.destroy();
          },
        });
      },
    });
  }

  /* ================================================================ */
  /* 프롬프트 기믹                                                     */
  /* ================================================================ */

  /**
   * 오브를 깬 파이터가 프롬프트를 입력하고, 그 문장이 판을 바꾼다.
   *
   * 사람이 깼으면 실제로 입력을 받고, 봇이 깼으면 미리 준비한 문장 중
   * 하나를 대신 외친다. 봇이 깼을 때 아무 일도 안 일어나면
   * 네 명 중 세 명이 깬 경우 이 기능이 보이지 않는다.
   */
  private async runPrompt(breaker: BaseCharacter): Promise<void> {
    if (this.prompting || !this.battleActive) return;
    this.prompting = true;

    const accent = `#${breaker.cfg.colors.accent.toString(16).padStart(6, '0')}`;
    breaker.playPromptCast();
    let text: string;

    if (breaker.side === 'player') {
      /* 입력하는 동안 전투를 멈춘다 — 타이핑 중에 맞으면 억울하다 */
      this.physics.world.pause();
      if (this.input.keyboard) this.input.keyboard.enabled = false;

      const result = await openPromptOverlay(breaker.cfg.name, accent);
      text = result.text;

      if (this.input.keyboard) this.input.keyboard.enabled = true;
      // 씬이 그 사이 내려갔으면(재시작 등) 더 진행하지 않는다
      if (!this.scene.isActive()) {
        this.prompting = false;
        return;
      }
      this.physics.world.resume();
    } else {
      text = Phaser.Utils.Array.GetRandom(AI_PROMPTS);
      breaker.say(text, breaker.cfg.colors.accent);
    }

    /*
     * 한 문장에 두 가지가 들어 있으면 둘 다 건다.
     *
     * "달에서 한방에 끝내자"는 장소와 규칙을 동시에 말하고 있다.
     * 하나만 골라 버리면 플레이어가 쓴 말의 절반을 흘린 것이고,
     * 그러면 다음부터는 짧게만 쓰게 된다 — 길게 쓸 이유가 없어지므로.
     */
    const reading = readPrompt(text);
    const note =
      `AI 해석: ${reading.reason} · 확신 ${Math.round(reading.confidence * 100)}%`;

    this.gimmicks.activate(reading.primary, text, this.time.now, note);
    this.stats.countGimmick();
    if (reading.secondary) {
      // 조금 늦춰 건다 — 같은 순간에 두 배너가 겹쳐 뜨면 둘 다 안 읽힌다
      this.time.delayedCall(650, () => {
        if (!this.battleActive) return;
        this.gimmicks.activate(reading.secondary!, text, this.time.now, '함께 읽은 것');
        this.stats.countGimmick();
      });
    }

    this.prompting = false;
  }

  private checkBattleEnd(): void {
    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length > 1) return;

    this.battleActive = false;
    const winner = alive[0] ?? null;

    // 승리 포즈
    if (winner) {
      winner.setGuard(false);
      winner.showVictory();
    }

    eventBus.emit('battle:end', {
      winnerId: winner?.fighterId ?? null,
      winnerName: winner?.cfg.name ?? '',
    });

    this.showResult(winner);
  }

  private showResult(winner: BaseCharacter | null): void {
    const playerWon = winner?.side === 'player';

    /*
     * 결과 화면 배경.
     * 그림이 있으면 전투 장면을 덮고, 없으면 지금까지처럼 검게 깐다.
     * 어느 쪽이든 그 위에 반투명 막을 한 겹 더 둬 글자를 읽히게 한다.
     */
    /*
     * HUD를 내린다.
     *
     * 판이 끝난 뒤의 주가 막대는 아무 정보도 아니고, 화면 아래 넉넉한
     * 자리를 차지해 전적표가 그 위로 겹친다. 결과는 결과만 보여야 한다.
     */
    this.hudLayer?.setVisible(false);

    const art = addBackdrop(this, 'ui_result_bg', GAME.WIDTH, GAME.HEIGHT);
    art?.setDepth(DEPTH.OVERLAY).setScrollFactor(0);

    this.add
      .rectangle(0, 0, GAME.WIDTH, GAME.HEIGHT, 0x000000, art ? 0.42 : 0.62)
      .setOrigin(0)
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0);

    /* 이긴 판이 몇 번째인가 — 이번 판을 포함한 수 */
    const wonSoFar = playerWon ? this.streak + 1 : this.streak;
    this.canContinue = playerWon;

    const title = this.add
      .text(
        GAME.WIDTH / 2,
        170,
        playerWon ? '승리!' : '패배…',
        {
          fontFamily: GAME.FONT,
          fontSize: '76px',
          color: playerWon ? '#4ade80' : '#ef4444',
          fontStyle: 'bold',
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);
    title.setStroke('#0b1020', 10);

    // 플레이어가 몇 등이었는지 알려준다 (KO 순서의 역순 = 등수)
    const total = this.fighters.length;
    const playerRank = total - this.koOrder.indexOf(this.player.fighterId);
    const rankText = playerWon
      ? `${total}명 중 최후의 1인`
      : `${total}명 중 ${playerRank}위`;

    this.add
      .text(
        GAME.WIDTH / 2,
        250,
        winner
          ? `${winner.cfg.name} 생존 · 주가 ${this.stock.get(winner.fighterId)}%\n${rankText}`
          : '전원 상장폐지',
        {
          fontFamily: GAME.FONT,
          fontSize: '20px',
          color: '#cbd5e1',
          align: 'center',
          lineSpacing: 8,
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);

    /*
     * 연승 표시.
     *
     * 이 게임에는 스무 명과 무대 넷이 있는데, 한 판 하고 선택 화면으로
     * 나가면 대부분 거기서 그만둔다. **나가지 않아도 다음 상대가 나오는 것**이
     * 그 스무 명을 실제로 보게 만드는 유일한 장치다.
     */
    if (wonSoFar > 0) {
      const badge = streakTitle(wonSoFar);
      this.add
        .text(
          GAME.WIDTH / 2,
          304,
          `${wonSoFar}연승${badge ? `  ·  ${badge}` : ''}`,
          {
            fontFamily: GAME.FONT,
            fontSize: '26px',
            color: '#ffd54a',
            fontStyle: 'bold',
          },
        )
        .setOrigin(0.5)
        .setDepth(DEPTH.OVERLAY + 1)
        .setStroke('#0b1020', 7);
    }

    this.buildScoreboard();

    const keys = playerWon
      ? 'SPACE : 다음 상대      R : 이 판 다시      ESC : 캐릭터 선택'
      : 'R : 다시하기      ESC : 캐릭터 선택';

    const keyLabel = this.add
      .text(GAME.WIDTH / 2, 648, keys, {
        fontFamily: GAME.FONT,
        fontSize: '18px',
        color: playerWon ? '#e8eeff' : '#8fa6d8',
        fontStyle: playerWon ? 'bold' : 'normal',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);

    // 이겼을 때는 다음 상대 안내가 눈에 띄어야 한다 — 여기서 멈추면 안 되므로
    if (playerWon) {
      this.tweens.add({
        targets: keyLabel,
        alpha: { from: 1, to: 0.45 },
        duration: 700,
        yoyo: true,
        repeat: -1,
      });
    }

    this.tweens.add({
      targets: title,
      scale: { from: 1.6, to: 1 },
      duration: 420,
      ease: 'Back.easeOut',
    });
  }

  /**
   * 네 명의 전적표.
   *
   * ── 왜 붙였는가 ──────────────────────────────────────────────────
   * 전에는 "승리!" 와 등수 한 줄이 전부였다. 네 명이 3분 동안 치고받은
   * 결과가 그 한 줄로 요약되면 방금 무슨 일이 있었는지 남지 않는다.
   *
   * 캐릭터가 스무 명인 게임에서는 **내가 뭘 했는지**가 다음 판의 선택을
   * 만든다. "이 캐릭터로 340을 넣었네", "가장 많이 쓴 건 강제 종료였네" —
   * 둘 다 다음에 누구를 고를지에 영향을 준다. 그 정보가 없으면
   * 스무 명이 그냥 스무 개의 이름으로 남는다.
   */
  private buildScoreboard(): void {
    const top = this.stats.topDealer();

    const rowH = 46;
    const y0 = 358;
    const left = GAME.WIDTH / 2 - 430;

    const header = ['', '준 피해', '맞은 피해', 'KO', '최고 주가', '가장 많이 쓴 기술'];
    const colX = [0, 250, 350, 448, 520, 640];

    header.forEach((label, i) => {
      if (!label) return;
      this.add
        .text(left + colX[i]!, y0 - 26, label, {
          fontFamily: GAME.FONT,
          fontSize: '13px',
          color: '#6c86c4',
        })
        .setOrigin(i === 5 ? 0 : 0.5, 0.5)
        .setDepth(DEPTH.OVERLAY + 1);
    });

    this.add
      .rectangle(GAME.WIDTH / 2, y0 - 10, 900, 2, 0x2f3f6b)
      .setDepth(DEPTH.OVERLAY + 1);

    /* 준 피해 순으로 세운다 — 순위표는 등수가 보여야 순위표다 */
    const ordered = [...this.fighters].sort(
      (a, b) => this.stats.get(b.fighterId).dealt - this.stats.get(a.fighterId).dealt,
    );

    ordered.forEach((f, i) => {
      const r = this.stats.get(f.fighterId);
      const fav = this.stats.favouriteMove(f.fighterId);
      const y = y0 + 12 + i * rowH;
      const isPlayer = f.side === 'player';
      const isTop = top?.id === f.fighterId && r.dealt > 0;

      // 내 줄만 배경을 깐다 — 넷 중 어느 줄이 나인지 한눈에 찾게
      if (isPlayer) {
        this.add
          .rectangle(GAME.WIDTH / 2, y, 900, rowH - 6, f.cfg.colors.accent, 0.12)
          .setDepth(DEPTH.OVERLAY + 1);
      }

      const nameColor = `#${f.cfg.colors.accent.toString(16).padStart(6, '0')}`;
      this.add
        .text(left - 40, y, `${isTop ? '👑 ' : ''}${f.cfg.name}`, {
          fontFamily: GAME.FONT,
          fontSize: '18px',
          color: nameColor,
          fontStyle: isPlayer ? 'bold' : 'normal',
        })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.OVERLAY + 2);

      const cells: Array<[number, string, string]> = [
        [colX[1]!, String(Math.round(r.dealt)), '#e8eeff'],
        [colX[2]!, String(Math.round(r.taken)), '#9fb3dd'],
        [colX[3]!, String(r.kos), r.kos ? '#ffd54a' : '#54608a'],
        [colX[4]!, `${Math.round(r.peakStock)}%`, '#9fb3dd'],
      ];
      for (const [x, text, color] of cells) {
        this.add
          .text(left + x, y, text, {
            fontFamily: GAME.FONT,
            fontSize: '18px',
            color,
          })
          .setOrigin(0.5)
          .setDepth(DEPTH.OVERLAY + 2);
      }

      this.add
        .text(
          left + colX[5]!,
          y,
          fav ? `${fav.name} ×${fav.count}` : '한 대도 못 맞혔다',
          {
            fontFamily: GAME.FONT,
            fontSize: '16px',
            color: fav ? '#cbd5e1' : '#54608a',
          },
        )
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.OVERLAY + 2);
    });

    /* 이 판 전체를 한 줄로 — 어디서 싸웠고 문장을 몇 번 썼는가 */
    const me = this.stats.get(this.player.fighterId);
    this.add
      .text(
        GAME.WIDTH / 2,
        y0 + 12 + ordered.length * rowH + 24,
        `${this.stage.name} · 프롬프트 ${this.stats.gimmicks}회` +
          (me.bestHitName ? ` · 내 최고 한 방 ${me.bestHitName} ${Math.round(me.bestHit)}` : ''),
        {
          fontFamily: GAME.FONT,
          fontSize: '15px',
          color: '#6c86c4',
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);
  }

  /**
   * 연승 도전 — 다음 상대.
   *
   * 같은 캐릭터로 계속 간다. 고른 캐릭터를 바꾸고 싶으면 선택 화면으로
   * 나가면 되고, 여기서 원하는 것은 "지금 이 캐릭터로 어디까지 가나"다.
   *
   * 상대는 방금 싸운 셋을 뒤로 밀어 다시 뽑고, 무대도 앞 판과 다른 곳으로
   * 간다(BattleScene 이 lastStageId 를 들고 있다). 주가는 이긴 순간의 값을
   * 이어받되 너무 낮으면 올려 준다 — 바닥에서 시작하면 그냥 끝나므로.
   */
  private startNextRound(): void {
    if (!this.canContinue) return;
    this.canContinue = false;

    const playerId = this.battleData.playerId;
    this.scene.start('Battle', {
      playerId,
      aiIds: pickOpponents(playerId, this.battleData.aiIds.length, this.battleData.aiIds),
      streak: this.streak + 1,
      startStock: carryOverStock(this.stock.get(this.player.fighterId)),
    } satisfies BattleSceneData);
  }

  /** 화면 중앙 대형 안내 문구 */
  private announce(text: string, color: string, hold = 700): void {
    /*
     * 앞의 안내가 아직 떠 있으면 지우고 시작한다.
     *
     * 네 명이 붙는 판이라 "장외!" 와 "OOO 상장폐지!" 가 거의 동시에 뜨는 일이
     * 흔한데, 같은 자리에 겹쳐 그려져 두 글자가 포개진 채 읽히지 않는다.
     * 뒤에 온 소식이 더 중요하므로 앞의 것을 치운다.
     */
    this.announceLabel?.destroy();

    const label = this.add
      .text(GAME.WIDTH / 2, 230, text, {
        fontFamily: GAME.FONT,
        fontSize: '58px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0);
    label.setStroke('#0b1020', 9);
    this.announceLabel = label;

    this.tweens.add({
      targets: label,
      scale: { from: 1.7, to: 1 },
      duration: 260,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: label,
          alpha: 0,
          y: label.y - 30,
          delay: hold,
          duration: 260,
          onComplete: () => {
            if (this.announceLabel === label) this.announceLabel = undefined;
            label.destroy();
          },
        });
      },
    });
  }

  /* ================================================================ */
  /* HUD                                                              */
  /* ================================================================ */

  private buildHud(): void {
    /*
     * HUD는 카메라를 따라 움직이면 안 된다.
     * 하나의 레이어 컨테이너에 담고 scrollFactor 0을 주면
     * 자식 전부가 화면에 고정된다. (월드가 화면보다 넓어졌기 때문)
     */
    this.hudLayer = this.add
      .container(0, 0)
      .setDepth(DEPTH.HUD)
      .setScrollFactor(0);

    /** 만든 객체를 HUD 레이어로 옮긴다 */
    const ui = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
      this.hudLayer.add(obj);
      return obj;
    };

    /*
     * 조작키 안내는 상단에 둔다 — 하단은 HUD 패널이 가득 차 겹친다.
     * 커맨드가 늘어나 한 줄에 담기지 않으므로 두 줄로 나눴다.
     */
    /*
     * 조작 안내는 배경 위에 바로 얹힌다.
     *
     * 생성한 배경이 밝게 나오면 이 옅은 회색 글자가 그대로 묻힌다.
     * 배경이 밝은지 어두운지에 따라 색을 바꾸는 것보다, 글자마다 어두운
     * 테두리를 두르는 쪽이 어떤 그림 위에서도 통한다.
     */
    const hint = (y: number, text: string, color: string) => {
      const label = ui(
        this.add
          .text(GAME.WIDTH / 2, y, text, {
            fontFamily: GAME.FONT,
            fontSize: '13px',
            color,
          })
          .setOrigin(0.5),
      );
      label.setStroke('#080d1a', 4);
      return label;
    };

    hint(
      16,
      'A/D 이동 · SPACE(↑) 점프(2단) · S 방어 · AA/DD 대시 · T 도발 · P 일시정지 · R 재시작',
      '#8ea3cc',
    );
    hint(
      34,
      'J 약공격(JJJ 연속기) · K 강공격(KK) · L 스킬  ｜  W+J·W+K 상단기 · S+J·S+K 하단기 · 대시 중 J/K 돌진 · 공중 S+J/K 급강하',
      '#a8bce0',
    );

    this.muteLabel = ui(
      this.add
        .text(GAME.WIDTH - 20, 14, sound.isMuted ? '🔇 M' : '🔊 M', {
          fontFamily: GAME.FONT,
          fontSize: '14px',
          color: '#8ea3cc',
        })
        .setOrigin(1, 0),
    );
    this.muteLabel.setStroke('#080d1a', 4);

    /*
     * 연속기 안내.
     *
     * 이어 칠 수 있다는 사실을 알려주지 않으면 대부분의 플레이어는
     * 연속기가 있는 줄도 모른 채 한 대씩만 치고 끝낸다.
     * 플레이어 머리 위가 아니라 화면 하단 중앙에 고정해 시야에서 벗어나지 않게 한다.
     */
    this.chainHint = ui(
      this.add
        .text(GAME.WIDTH / 2, HUD_Y - 34, '', {
          fontFamily: GAME.FONT,
          fontSize: '17px',
          color: '#facc15',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setAlpha(0),
    );
    this.chainHint.setStroke('#0b1020', 5);

    /*
     * 방금 낸 기술 이름.
     *
     * 커맨드가 열넷인데 화면에 이름이 안 뜨니, 플레이어는 자기가 무엇을
     * 냈는지 모르고 버튼만 누른다. "W+K를 눌렀더니 Ctrl+Alt+Del이 나갔다"가
     * 보여야 기술이 많다는 사실이 전달된다.
     * 연속기 안내 바로 위에 둬서 시선이 한 군데 머물게 한다.
     */
    this.moveName = ui(
      this.add
        .text(GAME.WIDTH / 2, HUD_Y - 62, '', {
          fontFamily: GAME.FONT,
          fontSize: '20px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setAlpha(0),
    );
    this.moveName.setStroke('#0b1020', 6);

    /*
     * 진행 중인 기믹 배너.
     * 중력이나 룰이 바뀐 채로 안내가 없으면 플레이어는 조작이 고장난 줄 안다.
     * 남은 시간까지 같이 보여준다.
     */
    this.gimmickHud = ui(
      this.add
        .text(GAME.WIDTH / 2, this.banners.claim(26).center, '', {
          fontFamily: GAME.FONT,
          fontSize: '16px',
          color: '#facc15',
          align: 'center',
          fontStyle: 'bold',
        })
        .setOrigin(0.5),
    );
    this.gimmickHud.setStroke('#0b1020', 5);

    /* 인원수만큼 패널을 가로로 고르게 배치한다 (1P는 항상 맨 왼쪽) */
    const n = this.fighters.length;
    const totalW = n * HUD_PANEL_W + (n - 1) * HUD_GAP;
    const startX = (GAME.WIDTH - totalW) / 2;

    this.fighters.forEach((fighter, i) => {
      const isPlayer = fighter.side === 'player';
      const x = startX + i * (HUD_PANEL_W + HUD_GAP);
      const y = HUD_Y;
      const accent = fighter.cfg.colors.accent;

      // 플레이어 패널만 테두리를 밝게 해 눈에 띄게 한다
      ui(
        this.add
          .rectangle(x, y, HUD_PANEL_W, HUD_PANEL_H, 0x0b1020, 0.8)
          .setOrigin(0)
          .setStrokeStyle(isPlayer ? 3 : 2, accent, isPlayer ? 0.95 : 0.45),
      );

      /*
       * 초상.
       * 시트에 얼굴 칸이 있으면 그 그림이, 없으면 캐릭터 색 원이 들어간다.
       * 네 명이 붙는 판에서 누가 누구인지는 이름보다 얼굴로 먼저 읽힌다.
       */
      for (const part of buildPortrait(this, fighter.cfg, 21)) {
        ui(part);
        (part as Phaser.GameObjects.Image).setPosition(x + 30, y + 39);
      }

      ui(
        this.add.text(x + 58, y + 8, fighter.cfg.name, {
          fontFamily: GAME.FONT,
          fontSize: '14px',
          color: '#ffffff',
          fontStyle: 'bold',
        }),
      );

      ui(
        this.add.text(x + 58, y + 27, isPlayer ? '1P' : `CPU (${this.difficulty.label})`, {
          fontFamily: GAME.FONT,
          fontSize: '10px',
          color: isPlayer ? '#4ade80' : '#7f93bd',
        }),
      );

      const percent = ui(
        this.add
          .text(x + HUD_PANEL_W - 12, y + 5, '100%', {
            fontFamily: GAME.FONT,
            fontSize: '22px',
            color: '#ffffff',
            fontStyle: 'bold',
          })
          .setOrigin(1, 0),
      );

      const tierLabel = ui(
        this.add
          .text(x + HUD_PANEL_W - 12, y + 30, '보통', {
            fontFamily: GAME.FONT,
            fontSize: '10px',
            color: '#cbd5e1',
          })
          .setOrigin(1, 0),
      );

      // 주가 진행바
      ui(this.add.rectangle(x + 58, y + 48, HUD_BAR_W, 12, 0x1a2440).setOrigin(0));
      const bar = ui(
        this.add
          .rectangle(x + 58, y + 48, HUD_BAR_W / 3, 12, TIERS[StockTier.NORMAL].color)
          .setOrigin(0),
      );

      // 스킬 쿨다운
      ui(this.add.rectangle(x + 58, y + 62, HUD_BAR_W, 5, 0x1a2440).setOrigin(0));
      const skillBar = ui(
        this.add.rectangle(x + 58, y + 62, HUD_BAR_W, 5, accent).setOrigin(0),
      );

      const skillLabel = ui(
        this.add.text(x + 58 + HUD_BAR_W + 6, y + 58, 'L', {
          fontFamily: GAME.FONT,
          fontSize: '11px',
          color: '#4ade80',
          fontStyle: 'bold',
        }),
      );

      // 장착 아이템 아이콘
      const itemIcon = ui(
        this.add
          .text(x + HUD_PANEL_W - 12, y + 46, '', { fontSize: '18px' })
          .setOrigin(1, 0),
      );

      /*
       * 캐릭터 고유 자원.
       *
       * 지분이 몇 개 쌓였는지, 부스터가 남았는지 보이지 않으면
       * "그때그때 다르게 동작하는 캐릭터"로만 느껴진다. 눈에 보여야 탐구가 된다.
       */
      const sigLabel = ui(
        this.add.text(x + 58, y + 62, '', {
          fontFamily: GAME.FONT,
          fontSize: '12px',
          color: `#${fighter.cfg.signature.color.toString(16).padStart(6, '0')}`,
          fontStyle: 'bold',
        }),
      );

      this.huds.push({
        fighter,
        percent,
        tierLabel,
        bar,
        skillBar,
        skillLabel,
        itemIcon,
        sigLabel,
      });
    });
  }


  private updateHud(): void {
    this.updateMoveName();
    this.updateChainHint();
    this.updateGimmickHud();

    for (const hud of this.huds) {
      const id = hud.fighter.fighterId;
      const value = this.stock.get(id);
      const tier = this.stock.getTier(id);
      const effect = TIERS[tier];

      hud.percent.setText(`${value}%`);
      hud.percent.setColor(`#${effect.color.toString(16).padStart(6, '0')}`);
      hud.tierLabel.setText(effect.label);

      hud.bar.width = Math.max(1, HUD_BAR_W * (value / STOCK.MAX));
      hud.bar.setFillStyle(effect.color);

      // 쿨다운 바는 차오르는 방향으로 (1 = 준비 완료)
      const ready = 1 - hud.fighter.getSkillCooldownRatio();
      hud.skillBar.width = Math.max(0, HUD_BAR_W * ready);
      hud.skillLabel.setColor(ready >= 1 ? '#4ade80' : '#5d739f');

      // 장착 아이템
      hud.itemIcon.setText(hud.fighter.getItem()?.cfg.icon ?? '');

      // 캐릭터 고유 자원
      hud.sigLabel.setText(this.describeSignature(hud.fighter));

      // 상장폐지된 파이터는 패널 전체를 어둡게
      hud.percent.setAlpha(hud.fighter.alive ? 1 : 0.4);
      hud.bar.setAlpha(hud.fighter.alive ? 1 : 0.4);
    }
  }

  /**
   * 방금 낸 기술 이름을 띄운다.
   *
   * 같은 기술을 이어 내면 다시 튀지 않게 두고, 기술이 바뀔 때만 튕겨 올린다.
   * 매번 튀면 연타할 때 글자가 요동쳐 오히려 안 읽힌다.
   */
  private updateMoveName(): void {
    const name = this.player.alive ? this.player.getRecentMoveName() : null;

    if (!name) {
      if (this.moveName.alpha > 0 && !this.tweens.isTweening(this.moveName)) {
        this.tweens.add({ targets: this.moveName, alpha: 0, duration: 200 });
      }
      return;
    }

    if (this.moveName.text !== name) {
      this.moveName.setText(name);
      this.tweens.killTweensOf(this.moveName);
      this.moveName.setScale(1.3);
      this.tweens.add({
        targets: this.moveName,
        scale: 1,
        duration: 170,
        ease: 'Back.easeOut',
      });
    }
    this.moveName.setAlpha(1);
  }

  /** 플레이어가 지금 이어 칠 수 있는 다음 타를 하단에 띄운다 */
  private updateChainHint(): void {
    const next = this.player.alive ? this.player.getChainNextName() : null;

    if (!next) {
      // 매 프레임 알파를 0으로 덮어쓰지 않는다 — 사라지는 트윈이 끊긴다
      if (this.chainHint.alpha > 0 && !this.tweens.isTweening(this.chainHint)) {
        this.tweens.add({
          targets: this.chainHint,
          alpha: 0,
          duration: 140,
        });
      }
      return;
    }

    const label = `▶ 한 번 더!  ${next}`;
    if (this.chainHint.text !== label) {
      this.chainHint.setText(label);
      this.tweens.killTweensOf(this.chainHint);
      this.chainHint.setScale(1.25);
      this.tweens.add({
        targets: this.chainHint,
        scale: 1,
        duration: 160,
        ease: 'Back.easeOut',
      });
    }
    this.chainHint.setAlpha(1);
  }

  /**
   * 고유 자원을 한 줄로 표현한다.
   *
   * 자원이 있는 캐릭터는 채워진 칸으로, 상태로만 존재하는 캐릭터
   * (잡스의 후속 입력 창, 리누스의 훔친 기술)는 그 순간에만 글자로 알린다.
   */
  private describeSignature(f: BaseCharacter): string {
    const sig = f.cfg.signature;

    if (sig.id === 'oneMoreThing') {
      return f.isSignatureWindowOpen() ? `${sig.icon} 지금! L 한 번 더` : '';
    }
    if (sig.id === 'fork') {
      const name = f.getForkedName();
      return name ? `${sig.icon} ${name}` : '';
    }

    const n = f.getSignatureStacks();
    if (sig.max <= 0) return '';
    // 채워진 칸과 빈 칸을 함께 보여줘야 "몇 개 더 남았는지"가 읽힌다
    return `${sig.icon} ${'◆'.repeat(n)}${'◇'.repeat(Math.max(0, sig.max - n))}`;
  }

  /** 진행 중인 기믹과 남은 시간을 상단에 띄운다 */
  private updateGimmickHud(): void {
    const active = this.gimmicks.getActive();

    if (active.length === 0) {
      if (this.gimmickHud.text) this.gimmickHud.setText('');
      return;
    }

    const now = this.time.now;
    this.gimmickHud.setText(
      active
        .map((a) => {
          const left = Math.max(0, Math.ceil((a.endAt - now) / 1000));
          return `${a.spec.icon} ${a.spec.name} ${left}s`;
        })
        .join('   '),
    );
  }

  /* ================================================================ */
  /* 장외 판정                                                        */
  /* ================================================================ */

  private checkBlastZones(): void {
    for (const f of this.fighters) {
      if (!f.alive) continue;

      const outBottom = f.y > STAGE.BLAST_BOTTOM;
      const outLeft = f.x < STAGE.LEFT - STAGE.BLAST_MARGIN;
      const outRight = f.x > STAGE.RIGHT + STAGE.BLAST_MARGIN;

      if (outBottom || outLeft || outRight) {
        this.announce('장외!', '#ef4444', 500);
        this.stock.forceDelist(f.fighterId, null);
      }
    }
  }

  /* ================================================================ */
  /* 메인 루프                                                        */
  /* ================================================================ */

  override update(time: number, delta: number): void {
    if (this.paused) return;

    // 프롬프트 입력 중에는 판이 멈춘다 (물리는 이미 pause 상태)
    if (this.prompting) {
      this.updateHud();
      return;
    }

    // 히트스탑 중이면 모든 갱신을 멈춘다 (타격감의 핵심)
    if (this.combat.tickHitstop(time)) {
      this.updateHud();
      return;
    }

    /*
     * 슬로우 모션 룰은 델타를 나눠 구현한다.
     * 물리 월드의 timeScale만 건드리면 이동만 느려지고 공격 모션·AI 판단은
     * 그대로라, 화면이 느려진 게 아니라 조작만 굼떠진 것처럼 느껴진다.
     */
    const scaled = delta / this.gimmicks.getTimeScale();

    this.updateCamera(scaled);

    if (this.battleActive) {
      this.handleInput();
      for (const ai of this.ais) ai.update(time, scaled);
    }

    for (const f of this.fighters) f.update(time, scaled);

    this.projectiles.update(time, scaled);

    if (this.battleActive) {
      this.combat.update(time, scaled);
      this.items.update(time, scaled);
      this.orbs.update(time, scaled);
      this.gimmicks.update(time, scaled);
      this.rhythm.update(time);
      this.checkBlastZones();
    }

    this.updateHud();
  }

  /* ================================================================ */

  private cleanup(): void {
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
    this.combat?.reset();
    this.stock?.reset();
    this.projectiles?.reset();
    this.items?.reset();
    // 기믹이 건 중력·발판·크기 변경을 반드시 되돌린 뒤 씬을 내린다
    this.gimmicks?.reset();
    this.orbs?.reset();
    this.rhythm?.reset();
    this.stats?.destroy();
    closePromptOverlay();
    this.prompting = false;
    if (this.input.keyboard) this.input.keyboard.enabled = true;
    sound.stopBgm();
  }
}

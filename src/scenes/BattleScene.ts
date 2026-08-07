import Phaser from 'phaser';
import { addBackdrop, hasArt } from '../config/artAssets';
import { STAGES, STAGE_BY_ID, pickStage } from '../config/stages';
import {
  emptyFrame,
  mergeTaps,
  packFrame,
  readKeyFrame,
  unpackFrame,
} from '../systems/InputFrame';
import type { InputFrame } from '../systems/InputFrame';
import { net } from '../systems/NetSystem';
import type { NetSnapshot } from '../systems/NetSystem';
import { POSE_ORDER } from '../config/spriteSheets';

/**
 * 호스트가 판 상태를 보내는 간격 (ms).
 *
 * 매 프레임 보내면 회선이 좁을 때 밀려 오히려 늦게 도착한다. 33ms(초당 30번)면
 * 눈으로는 부드럽고, 그 사이는 받은 속도로 각자 이어 움직여 메운다.
 */
const NET_SEND_MS = 33;
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
import type { AIDifficulty, AttackDir, BattleSceneData, CharacterId } from '../types';

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
  /** 코드로 그린 배경 — 무대 그림이 없을 때 이 위에 무대 색을 입힌다 */
  private bgBase?: Phaser.GameObjects.Image;
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
  private keys2!: Record<string, Phaser.Input.Keyboard.Key>;
  /** 2P (로컬 2인 대전일 때만 있다) */
  private player2?: BaseCharacter;
  /**
   * 사람이 조종하는 파이터들.
   *
   * 키와 더블탭 기록을 파이터에 묶어 둔다 — 씬이 "1P는 이 키, 2P는 저 키"를
   * 매번 갈라 보는 대신 목록을 돌리기만 하면 되고, 셋째 사람이 붙어도
   * 여기 한 줄이 늘 뿐이다.
   */
  private humans: Array<{
    fighter: BaseCharacter;
    keys: Record<string, Phaser.Input.Keyboard.Key>;
    tap: { dir: -1 | 0 | 1; at: number };
    /** 회선에서 오는 입력 (온라인 대전에서 상대 쪽). 없으면 키보드를 읽는다 */
    remote?: () => InputFrame;
  }> = [];
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
  /* --- 온라인 1:1 결투 ------------------------------------------- */
  /** 이 판에서 내 역할 (없으면 이 기계 안에서만 도는 판) */
  private netRole?: 'host' | 'guest';
  /** 호스트가 보낸 상태를 몇 번째까지 받았는가 — 늦게 온 옛 상태를 버린다 */
  private netSeq = 0;
  /** 마지막으로 상태를 보낸 시각 */
  private lastSnapAt = 0;
  /** 자리별로 회선에서 받은 최신 입력 (호스트). 0번은 호스트 자신이라 안 쓴다 */
  private remoteFrames: InputFrame[] = [];
  /** 전송 사이에 스쳐 간 내 눌림을 모아 둔다 (게스트) */
  private outTaps: InputFrame = emptyFrame();
  /** 이번 구간에 일어난 타격 — 게스트 화면에도 같은 연출을 보낸다 */
  private netHits: number[][] = [];
  /** 회선이 끊겼을 때 한 번만 알린다 */
  private netEnded = false;
  /**
   * 회선이 실제로 오가고 있는가 (검사·디버그용).
   *
   * "연결됐다"와 "입력이 도착한다"는 다른 문제다. 연결만 보고 넘어가면
   * 조용히 아무것도 안 오는 상태를 못 잡는다.
   */
  netStats = { sent: 0, recv: 0 };

  /** 화면 밖으로 나간 사람을 가리키는 가장자리 표시 */
  private offscreenMarks: Array<{
    fighter: BaseCharacter;
    arrow: Phaser.GameObjects.Triangle;
    text: Phaser.GameObjects.Text;
  }> = [];

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

    this.netRole = data.netRole;
    this.netEnded = false;
    this.netSeq = 0;
    this.remoteFrames = [];
    this.outTaps = emptyFrame();
    this.netHits = [];

    this.buildBackground();
    this.buildStage();
    /*
     * 키를 먼저 만든다 — 파이터를 만들 때 사람마다 키를 나눠 묶기 때문이다.
     * (2P가 있으면 1P의 ↑ 점프를 떼야 해서, 키가 없으면 그 판단을 못 한다)
     */
    this.bindInput();
    this.spawnFighters();
    this.setupSystems();
    this.buildHud();
    this.bindNet();
    this.bindEvents();
    this.playIntro();

    sound.startBgm('battle');
    // 무대마다 조와 템포가 달라진다 — 곡은 하나지만 장소는 넷이다
    sound.setStageTone(this.stage.music.transpose, this.stage.music.bpmMul);
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

    this.bgBase = this.add.image(0, 0, KEY).setOrigin(0).setDepth(DEPTH.BG);

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
  /**
   * 코드로 그린 배경을 무대 색으로 물들인다.
   *
   * 곱하기 합성이라 색을 그대로 얹으면 배경이 통째로 어두워진다.
   * 흰색 쪽으로 절반 넘게 끌어와야 "물든" 정도로 남는다.
   *
   * @param on 무대 그림이 없어서 이 배경이 실제로 보이는 상황인가
   */
  private tintBase(on: boolean): void {
    if (!this.bgBase?.scene) return;

    if (!on) {
      this.bgBase.clearTint();
      return;
    }

    const c = Phaser.Display.Color.IntegerToColor(this.stage.accent);
    const mix = (v: number) => Math.round(v + (255 - v) * 0.45);
    this.bgBase.setTint(
      Phaser.Display.Color.GetColor(mix(c.red), mix(c.green), mix(c.blue)),
    );
  }

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
     *
     * ── 없으면 남의 그림을 빌려 오지 않는다 ─────────────────────────
     * 예전에는 그림이 없는 무대를 기본 거래소 배경으로 채웠다. "배경이
     * 사라지는 것보다는 낫다"는 판단이었는데, 무대가 여섯 곳이 되면서
     * 그 판단이 뒤집혔다 — 넷이 같은 그림을 쓰면 이름만 다른 같은 곳이 되고,
     * 플레이어는 "무대가 여러 개"라는 말을 믿지 않게 된다.
     *
     * 그림이 없으면 **코드로 그린 배경을 무대 색으로 물들여** 쓴다.
     * 사진만큼은 아니어도 확실히 다른 곳으로 보이고, 나중에 그림을 넣으면
     * 그대로 갈아 끼워진다.
     */
    const wanted = this.stageArtStack[this.stageArtStack.length - 1];
    const key =
      wanted && hasArt(this, wanted)
        ? wanted
        : hasArt(this, this.stage.art)
          ? this.stage.art
          : null;

    this.tintBase(!key);

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
    if (this.battleData.duel) {
      this.spawnDuel();
      return;
    }

    const spawnY = STAGE.GROUND_Y - FIGHTER.BODY_H;
    const p2Id = this.battleData.player2Id;
    const total = 1 + (p2Id ? 1 : 0) + this.battleData.aiIds.length;

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

    /*
     * 2P는 맨 오른쪽에서 시작한다.
     *
     * 사람 둘을 양 끝에 세우고 봇을 가운데에 둔다. 사람끼리 붙으려면
     * 봇을 헤치고 가야 하니, 시작하자마자 둘이 서로만 두들기는 판이 안 된다.
     */
    if (p2Id) {
      this.player2 = new BaseCharacter(
        this,
        STAGE.RIGHT - 130,
        spawnY,
        CHARACTERS[p2Id],
        'player',
        'P2',
      );
      this.player2.facing = -1;
      this.fighters.push(this.player2);
    }

    // 봇은 사이를 메운다 (사람이 둘이면 자리가 하나 줄어든다)
    const botSlots = total - 1 - (p2Id ? 1 : 0);
    this.battleData.aiIds.slice(0, botSlots).forEach((id, i) => {
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

    /* 사람마다 자기 키와 자기 더블탭 기록을 갖는다 */
    const p1Keys = { ...this.keys };
    // 2P가 있으면 방향키는 2P 것이다 — 1P의 ↑ 점프를 뗀다
    if (this.player2) delete p1Keys.jumpAlt;

    this.humans = [{ fighter: this.player, keys: p1Keys, tap: { dir: 0, at: 0 } }];
    if (this.player2) {
      this.humans.push({
        fighter: this.player2,
        keys: this.keys2,
        tap: { dir: 0, at: 0 },
      });
    }

    /* 지면·발판 충돌 + 파이터 간 밀림 */
    this.fighters.forEach((f) => {
      this.physics.add.collider(f, this.ground);
      this.platforms.forEach((p) => this.physics.add.collider(f, p));
    });
    this.physics.add.collider(this.fighters, this.fighters);
  }

  /**
   * 1:1 결투 — 둘만 선다.
   *
   * 목록 순서를 **호스트 먼저, 게스트 나중**으로 양쪽 기계에서 똑같이 맞춘다.
   * 상태를 번호로 주고받으므로 순서가 어긋나면 상대 화면에서 두 캐릭터가
   * 서로의 자리로 순간이동한다. "내 것"이 몇 번인지는 역할에 따라 갈린다.
   */
  private spawnDuel(): void {
    const spawnY = STAGE.GROUND_Y - FIGHTER.BODY_H;

    /*
     * 사람들이 먼저, 그다음 봇.
     *
     * 목록 순서를 양쪽 기계에서 똑같이 맞춘다. 상태를 번호로 주고받으므로
     * 순서가 어긋나면 상대 화면에서 두 캐릭터가 서로의 자리로 순간이동한다.
     * "내 것"이 몇 번인지는 자리 번호(netSlot)가 알려준다.
     */
    const humanIds =
      this.battleData.humanIds ??
      ([this.battleData.playerId, this.battleData.player2Id].filter(
        Boolean,
      ) as CharacterId[]);
    const botIds = this.battleData.aiIds ?? [];
    const total = humanIds.length + botIds.length;

    /* 사람은 양 끝부터, 봇은 사이를 메운다 */
    const span = STAGE.RIGHT - STAGE.LEFT - 260;
    const gap = total > 1 ? span / (total - 1) : 0;
    const startX = STAGE.LEFT + 130;

    const humans = humanIds.map((id, i) => {
      const f = new BaseCharacter(
        this,
        startX + gap * i,
        spawnY,
        CHARACTERS[id],
        'player',
        `P${i + 1}`,
      );
      // 서로를 마주 보게 — 왼쪽 절반은 오른쪽을, 오른쪽 절반은 왼쪽을
      f.facing = i < humanIds.length / 2 ? 1 : -1;
      this.fighters.push(f);
      return f;
    });

    botIds.forEach((id, i) => {
      const bot = new BaseCharacter(
        this,
        startX + gap * (humans.length + i),
        spawnY,
        CHARACTERS[id],
        'ai',
        `CPU${i + 1}`,
      );
      bot.facing = i % 2 === 0 ? 1 : -1;
      this.fighters.push(bot);
    });

    /* 화면마다 "내 것"이 1P 자리에 온다 — 카메라와 HUD가 나를 따라야 한다 */
    const mySlot = this.battleData.netSlot ?? 0;
    this.player = humans[mySlot] ?? humans[0]!;
    this.player2 = humans.find((f) => f !== this.player);

    this.fighters.forEach((f) => {
      this.physics.add.collider(f, this.ground);
      this.platforms.forEach((p) => this.physics.add.collider(f, p));
    });
    this.physics.add.collider(this.fighters, this.fighters);

    /*
     * 누가 무엇을 조종하는가.
     *
     * 호스트 — 자기 것은 키보드로, 나머지 사람 자리는 회선으로 온 입력으로.
     * 참가자 — 아무것도 직접 조종하지 않는다. 입력은 보내기만 하고, 화면에
     *          보이는 것은 전부 호스트가 계산해 돌려준 결과다. 그래야
     *          모든 화면이 절대 어긋나지 않는다.
     */
    if (this.netRole === 'host') {
      this.humans = humans.map((f, slot) => ({
        fighter: f,
        keys: slot === 0 ? this.keys : {},
        tap: { dir: 0, at: 0 },
        remote: slot === 0 ? undefined : () => this.takeRemoteFrame(slot),
      }));
    } else if (this.netRole === 'guest') {
      /*
       * 참가자도 **자기 캐릭터가 누구인지는** 씬이 알아야 한다.
       * 카메라가 따라갈 대상과 화면 밖 표시가 이 목록에서 나오기 때문이다.
       * 비워 두면 카메라가 전원의 한가운데만 보게 되는데, 양 끝에 서 있으면
       * 정작 자기 캐릭터가 화면 밖이 된다.
       */
      this.humans = [
        {
          fighter: this.player,
          keys: {},
          tap: { dir: 0, at: 0 },
          remote: () => emptyFrame(),
        },
      ];
    } else {
      // 온라인이 아닌 결투 — 한 키보드로 둘이
      this.humans = humans.slice(0, 2).map((f, i) => ({
        fighter: f,
        keys: i === 0 ? this.keys : this.keys2,
        tap: { dir: 0, at: 0 },
      }));
    }
  }

  /* ================================================================ */
  /* 온라인 — 호스트가 계산하고 게스트는 그린다                        */
  /* ================================================================ */

  /** 회선을 이 판에 연결한다 */
  private bindNet(): void {
    if (!this.netRole) return;

    net.onInput = (slot, held, taps) => {
      this.netStats.recv++;
      const f = unpackFrame(held, taps);
      // 눌림은 덮어쓰지 않고 쌓는다 — 전송 사이에 스쳐 간 탭이 사라지지 않게
      const prev = this.remoteFrames[slot];
      if (prev) mergeTaps(f, prev);
      this.remoteFrames[slot] = f;
    };

    net.onSnapshot = (snap) => this.applySnapshot(snap);

    net.onClose = (reason) => {
      if (this.netEnded) return;
      this.netEnded = true;
      this.battleActive = false;
      this.announce(reason, '#ef4444', 2200);
      this.time.delayedCall(2200, () => this.scene.start('Select'));
    };

    /* 타격이 일어날 때마다 게스트 화면에도 같은 연출을 보내려고 모아 둔다 */
    if (this.netRole === 'host') {
      this.disposers.push(
        eventBus.on('combat:hit', (e) => {
          const attacker = this.fighters.find((f) => f.fighterId === e.attackerId);
          this.netHits.push([
            Math.round(e.x),
            Math.round(e.y),
            attacker?.cfg.colors.accent ?? 0xffffff,
            e.damage >= 18 ? 1 : 0,
          ]);
        }),
      );
    }
  }

  /**
   * 호스트가 쓰는 "게스트의 이번 프레임 입력".
   *
   * 읽고 나면 눌림은 비운다 — 안 비우면 한 번 누른 점프가 회선이 잠깐
   * 멎을 때까지 매 프레임 다시 발동한다.
   */
  private takeRemoteFrame(slot: number): InputFrame {
    const f = this.remoteFrames[slot] ?? emptyFrame();
    this.remoteFrames[slot] = {
      ...emptyFrame(),
      left: f.left,
      right: f.right,
      up: f.up,
      down: f.down,
      jumpHeld: f.jumpHeld,
      heavyHeld: f.heavyHeld,
    };
    return f;
  }

  /**
   * 게스트 → 호스트. 내 입력만 보낸다.
   *
   * 매 프레임 읽되 보내는 것은 전송 주기마다다. 그 사이에 스쳐 간 눌림은
   * 모아 두었다가 함께 보낸다 — 빠른 탭 하나가 전송 주기 사이에 통째로
   * 들어가면 그 입력은 아무 데도 안 남기 때문이다.
   */
  private sendMyInput(): void {
    const frame = readKeyFrame(this.keys);
    mergeTaps(this.outTaps, frame);

    const now = this.time.now;
    if (now - this.lastSnapAt < NET_SEND_MS) return;
    this.lastSnapAt = now;

    const merged: InputFrame = { ...frame };
    mergeTaps(merged, this.outTaps);
    this.outTaps = emptyFrame();

    const [held, taps] = packFrame(merged);
    this.netStats.sent++;
    net.sendInput(held, taps);
  }

  /** 호스트 → 게스트. 판의 현재 모습을 통째로 보낸다 */
  private sendSnapshot(time: number): void {
    if (this.netRole !== 'host' || !net.connected) return;
    if (time - this.lastSnapAt < NET_SEND_MS) return;
    this.lastSnapAt = time;

    const snap: NetSnapshot = {
      n: ++this.netSeq,
      f: this.fighters.map((f) => [
        Math.round(f.x),
        Math.round(f.y),
        Math.round(f.body.velocity.x),
        Math.round(f.body.velocity.y),
        f.facing,
        f.alive ? 1 : 0,
        this.stock.get(f.fighterId),
        Math.max(0, POSE_ORDER.indexOf(f.getPose())),
      ]),
    };
    if (this.netHits.length) {
      snap.hit = this.netHits.slice(0, 8);
      this.netHits.length = 0;
    }
    if (!this.battleActive) {
      const alive = this.fighters.findIndex((f) => f.alive);
      snap.over = alive;
    }

    net.sendSnapshot(snap);
  }

  /** 게스트 — 받은 모습을 그대로 그린다 */
  private applySnapshot(snap: NetSnapshot): void {
    // 늦게 도착한 옛 상태는 버린다 (되감기면 캐릭터가 뒤로 튄다)
    if (snap.n <= this.netSeq) return;
    this.netSeq = snap.n;

    snap.f.forEach((row, i) => {
      const f = this.fighters[i];
      if (!f || !f.body) return;

      const [x, y, vx, vy, facing, alive, stock, pose] = row;
      f.setPosition(x!, y!);
      // 속도까지 받아야 다음 상태가 올 때까지 이 자리에 얼어붙지 않는다
      f.body.setVelocity(vx!, vy!);
      f.facing = facing === -1 ? -1 : 1;
      this.stock.setExact(f.fighterId, stock!);
      const p = POSE_ORDER[pose!];
      if (p) f.setRemotePose(p);
      if (!alive && f.alive) f.kill();
    });

    for (const h of snap.hit ?? []) {
      this.combat.playRemoteHit(h[0]!, h[1]!, h[2]!, h[3] === 1);
    }

    if (snap.over !== undefined && this.battleActive) {
      this.battleActive = false;
      const winner = snap.over >= 0 ? (this.fighters[snap.over] ?? null) : null;
      winner?.showVictory();
      this.showResult(winner);
    }
  }

  private setupSystems(): void {
    this.stock = new StockSystem(eventBus);
    this.projectiles = new ProjectileSystem(this);
    this.combat = new CombatSystem(this, this.stock, eventBus);

    this.fighters.forEach((f) => {
      // 연승 도전은 플레이어만 앞 판의 주가를 이어받는다
      this.stock.register(
        f,
        // 연승 도전으로 이어받는 주가는 1P의 것이다 (2P는 늘 100에서 시작)
        f === this.player ? (this.battleData.startStock ?? STOCK.START) : STOCK.START,
      );
      // 투사체 스킬(빌 게이츠맨의 블루스크린 등) 발사 연결
      f.onSpawnProjectile = (owner, atk) => this.projectiles.spawn(owner, atk);
      // 로켓 드롭 착지 충격파
      f.onShockwave = (owner, atk) => this.combat.triggerShockwave(owner, atk);
      // 던지기·잡기 공격도 일반 타격과 같은 경로를 태운다
      f.onThrow = (thrower, victim, atk, fromX) =>
        this.combat.applyThrow(thrower, victim, atk, fromX);
      f.onPummel = (thrower, victim) => this.combat.applyPummel(thrower, victim);
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
      /*
       * 잡기는 전용 키를 쓴다.
       *
       * 대난투처럼 "방어 + 공격"으로 묶고 싶었지만, 이 게임에서는 S가
       * 방어이자 하단기 모디파이어라 S+J는 이미 하단 약공격이다.
       * U는 J 바로 위 — 검지를 한 칸 올리면 닿는다.
       */
      grab: Phaser.Input.Keyboard.KeyCodes.U,
      taunt: Phaser.Input.Keyboard.KeyCodes.T,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    /*
     * 2P 키 — 한 키보드를 반으로 나눠 쓴다.
     *
     * 이동은 방향키. 버튼은 숫자패드를 먼저 두고, 없는 노트북을 위해
     * 방향키 왼쪽의 , . / ; ' 도 같은 자리에 함께 묶었다. 둘 중 아무거나
     * 눌러도 같은 기술이 나가므로 키보드를 가리지 않는다.
     *
     * 1P의 ↑ 점프(jumpAlt)는 2P가 있는 판에서 꺼진다 — 방향키는 2P 것이다.
     */
    this.keys2 = kb.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      jump: Phaser.Input.Keyboard.KeyCodes.NUMPAD_ZERO,
      jumpAlt: Phaser.Input.Keyboard.KeyCodes.COMMA,
      light: Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE,
      lightAlt: Phaser.Input.Keyboard.KeyCodes.PERIOD,
      heavy: Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO,
      heavyAlt: Phaser.Input.Keyboard.KeyCodes.FORWARD_SLASH,
      skill: Phaser.Input.Keyboard.KeyCodes.NUMPAD_THREE,
      skillAlt: Phaser.Input.Keyboard.KeyCodes.SEMICOLON,
      grab: Phaser.Input.Keyboard.KeyCodes.NUMPAD_FOUR,
      grabAlt: Phaser.Input.Keyboard.KeyCodes.QUOTES,
      taunt: Phaser.Input.Keyboard.KeyCodes.NUMPAD_FIVE,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // 스페이스바·방향키로 페이지가 스크롤되지 않도록 캡처
    kb.addCapture([
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
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

  /** 사람이 조종하는 파이터 전부 — 각자 자기 입력원에서 한 프레임을 읽는다 */
  private handleAllInput(): void {
    for (const h of this.humans) {
      /*
       * 입력을 "키보드를 읽는 일"과 "그 입력으로 무엇을 하는가"로 갈랐다.
       *
       * 온라인 대전에서 상대의 입력은 키보드가 아니라 회선으로 온다.
       * handleInput 이 키 객체를 직접 읽으면 그 경로가 통째로 막히므로,
       * 한 프레임분 입력을 값으로 만들어 넘긴다 — 키보드에서 오든
       * 회선에서 오든 이 아래는 같은 코드를 탄다.
       */
      const frame = h.remote ? h.remote() : readKeyFrame(h.keys);
      this.handleInput(h.fighter, frame, h.tap);
    }
  }

  private handleInput(
    p: BaseCharacter,
    input: InputFrame,
    tap: { dir: -1 | 0 | 1; at: number },
  ): void {
    if (!p.alive) return;

    const {
      tapLeft,
      tapRight,
      tapJump,
      releaseJump,
      tapLight,
      tapHeavy,
      tapSkill,
      tapGrab,
      tapTaunt,
      left,
      right,
      up,
      down,
      jumpHeld,
      heavyHeld,
    } = input;
    const onGround = p.body.blocked.down || p.body.touching.down;
    const reversed = this.gimmicks.isReversed();

    /* 공격 방향 — 같은 버튼이라도 W/S를 함께 누르면 다른 기술이 나간다 */
    const dir: AttackDir = up ? 'up' : down ? 'down' : 'neutral';

    /*
     * 잡힌 상태 — 여기서 할 수 있는 건 몸부림뿐이다.
     *
     * 무엇을 눌러도 몸부림으로 친다. 잡힌 사람이 제일 먼저 하는 행동은
     * 아무 버튼이나 두드리는 것이고, 그게 그대로 통해야 한다.
     */
    if (p.isGrabbed()) {
      const mashed =
        tapLeft || tapRight || tapJump || tapLight || tapHeavy || tapSkill || tapGrab;
      if (mashed) p.struggle();
      return;
    }

    /*
     * 붙잡고 있는 동안 — J는 툭툭 치기, K는 던지기.
     *
     * 던지는 방향에 따라 쓰임이 갈린다. 뒤로 메치기가 가장 아프고,
     * 위로 던지면 높이 떠오르니 쫓아 올라가 공중에서 이어친다.
     */
    if (p.isGrabbing()) {
      if (tapLight) p.pummel();
      else if (tapHeavy || tapGrab) {
        // 등 뒤쪽 방향키를 누르고 있으면 뒤로 메친다
        const back = (left && p.facing > 0) || (right && p.facing < 0);
        p.throwGrabbed(up ? 'up' : down ? 'down' : back ? 'back' : 'forward');
      }
      return;
    }

    /*
     * S를 누른 채로는 방어 상태다.
     *
     * 방어 중 좌우 → 구르기, 방어 중 점프 → 제자리 회피.
     * 가드만 있으면 몰렸을 때 답이 없다 — 그 자리에서 깨질 때까지 맞는 게
     * 전부다. 빠져나가는 선택지가 있어야 공격하는 쪽도 읽을 것이 생긴다.
     */
    const wantGuard = down && onGround;
    let dodged = false;
    if (wantGuard) {
      if (tapLeft) dodged = p.dodge(reversed ? 1 : -1);
      else if (tapRight) dodged = p.dodge(reversed ? -1 : 1);
      else if (tapJump) dodged = p.dodge(0);
    }

    /* A/D 더블탭 → 대시 (방어 중에는 구르기가 먼저다) */
    if (!wantGuard) {
      if (tapLeft && this.checkDoubleTap(tap, -1)) p.dash(-1);
      if (tapRight && this.checkDoubleTap(tap, 1)) p.dash(1);
    }

    /* 조작 반전 룰이 걸려 있으면 좌우가 뒤집힌다 */
    let move: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;
    if (reversed) move = -move as -1 | 0 | 1;
    p.moveHorizontal(move);

    // 방어 중 점프는 회피로 쓰이므로 여기서는 뛰지 않는다
    if (tapJump && !wantGuard) p.jump();
    /*
     * 점프 버튼을 떼면 상승이 잘린다 (숏홉).
     * 짧게 누르면 낮게, 길게 누르면 높게 — 같은 버튼에 두 선택지가 생긴다.
     *
     * 뗀 순간(JustUp)만 보지 않고 눌린 상태를 매 프레임 넘긴다. 프레임이
     * 드문 환경에서는 누르고 떼는 것이 통째로 프레임 사이에 들어가
     * JustUp 을 놓치기 때문이다.
     */
    p.setJumpHeld(jumpHeld);
    // 뗀 순간을 잡을 수 있으면 즉시 잘라 반응을 더 또렷하게 한다
    if (releaseJump) p.releaseJump();

    /*
     * 잡기 — 가드를 뚫는 유일한 수단.
     * 헛치면 크게 굳으니 "일단 지르는" 버튼은 아니다.
     */
    if (tapGrab) p.grab();

    if (tapLight) p.attack('light', dir);
    if (tapHeavy) p.attack('heavy', dir);
    // 누르고 있으면 선딜 구간에서 힘을 모은다 (차지 강공격)
    p.setHeavyHeld(heavyHeld);
    if (tapSkill) this.castSkill(p);
    if (tapTaunt) p.taunt();

    p.setGuard(wantGuard && !dodged && !p.isDodging());
    if (down && !onGround) p.fastFall();
  }

  /**
   * 같은 방향키를 짧은 간격으로 두 번 눌렀는가.
   *
   * 기록을 사람마다 따로 둔다. 하나로 두면 2P가 왼쪽을 누른 것이 1P의
   * 더블탭으로 세어져, 둘이 번갈아 걷기만 해도 아무나 대시로 튀어 나간다.
   */
  private checkDoubleTap(tap: { dir: -1 | 0 | 1; at: number }, dir: -1 | 1): boolean {
    const now = this.time.now;
    const isDouble = tap.dir === dir && now - tap.at <= FIGHTER.DOUBLE_TAP_MS;

    tap.dir = dir;
    tap.at = now;
    // 3연타가 연속 대시로 이어지지 않도록 기록을 지운다
    if (isDouble) tap.dir = 0;
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

    /*
     * 사람 쪽에 무게를 둔다.
     *
     * 전원의 한가운데만 보면 봇 셋이 몰려 있는 쪽으로 화면이 끌려가
     * 정작 내 캐릭터가 가장자리로 밀린다. 사람이 둘이면 **둘의 한가운데**를
     * 쓴다 — 한쪽만 따라가면 나머지 한 사람은 늘 화면 밖이다.
     */
    const humansAlive = this.humans.map((h) => h.fighter).filter((f) => f.alive);
    const mid = (minX + maxX) / 2;
    const humanMid = humansAlive.length
      ? humansAlive.reduce((sum, f) => sum + f.x, 0) / humansAlive.length
      : mid;
    const targetX = humansAlive.length ? (mid + humanMid) / 2 : mid;

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
      this.orbs.start(this.streak === 0);
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

  /**
   * 등록된 무대 전부 — 검사 도구가 "적어 둔 대로 실제로 서는가"를 대조한다.
   *
   * 검사 쪽에 무대 목록을 따로 적어 두면 무대를 하나 늘릴 때마다 두 군데를
   * 고쳐야 하고, 한쪽을 잊으면 새 무대는 아무도 확인하지 않은 채 배포된다.
   * 설정을 그대로 내보내 검사가 그것과 실제 판을 맞춰 보게 한다.
   */
  listStages(): Array<{
    id: string;
    name: string;
    platforms: number;
    gravityMul: number;
    transpose: number;
    bpmMul: number;
  }> {
    return STAGES.map((s) => ({
      id: s.id,
      name: s.name,
      platforms: s.platforms.length,
      gravityMul: s.gravityMul,
      transpose: s.music.transpose,
      bpmMul: s.music.bpmMul,
    }));
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
    /*
     * 2인 대전에서는 "이겼다/졌다"가 성립하지 않는다.
     *
     * 사람이 둘이면 한 화면을 둘이 같이 본다. 한쪽 기준으로 "패배…"를
     * 크게 띄우면 이긴 사람은 자기가 진 줄 안다. 그래서 2인 대전에서는
     * 판정을 내리지 않고 **누가 이겼는지만** 말한다.
     */
    const versus = !!this.player2;
    const playerWon = versus
      ? winner === this.player || winner === this.player2
      : winner?.side === 'player';

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
    // 연승 도전은 혼자 할 때만. 둘이면 다음 상대가 아니라 다시 붙는 것이 맞다
    this.canContinue = playerWon && !versus;

    /* 2인 대전은 누가 이겼는지가 곧 제목이다 */
    const humanWinner =
      winner === this.player ? '1P 승리!' : winner === this.player2 ? '2P 승리!' : '봇 승리…';
    const titleText = versus ? humanWinner : playerWon ? '승리!' : '패배…';
    const titleColor = versus
      ? winner === this.player
        ? '#38bdf8'
        : winner === this.player2
          ? '#f472b6'
          : '#ef4444'
      : playerWon
        ? '#4ade80'
        : '#ef4444';

    const title = this.add
      .text(GAME.WIDTH / 2, 170, titleText, {
        fontFamily: GAME.FONT,
        fontSize: '76px',
        color: titleColor,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);
    title.setStroke('#0b1020', 10);

    // 플레이어가 몇 등이었는지 알려준다 (KO 순서의 역순 = 등수)
    const total = this.fighters.length;
    const playerRank = total - this.koOrder.indexOf(this.player.fighterId);
    const rankText = versus
      ? `${total}명 중 최후의 1인`
      : playerWon
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
    if (wonSoFar > 0 && !versus) {
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

    const keys = versus
      ? 'R : 한 판 더      ESC : 캐릭터 선택'
      : playerWon
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

  /**
   * 화면 밖으로 나간 사람을 가장자리에 표시한다.
   *
   * 월드가 화면보다 넓어서, 넉백으로 크게 날아가거나 2인 대전에서 둘이
   * 양 끝으로 갈라지면 자기 캐릭터가 화면에서 사라진다. 그러면 그 몇 초는
   * 게임이 아니라 추측이 된다 — 어디 있는지 모른 채 버튼만 누르게 된다.
   *
   * 대난투가 같은 문제를 화면 가장자리 표시로 푼다. 카메라를 억지로
   * 넓히는 것보다 이쪽이 확실하다 — 넷이 흩어지면 어차피 다 담을 수 없다.
   */
  private buildOffscreenMarkers(
    ui: <T extends Phaser.GameObjects.GameObject>(obj: T) => T,
  ): void {
    this.offscreenMarks = this.humans.map((h) => {
      // HUD 패널과 같은 색을 쓴다 — 1P는 파랑, 2P는 분홍으로 고정
      const first = h.fighter === this.player;
      const accent = first ? 0x38bdf8 : 0xf472b6;
      const label = first ? '1P' : '2P';

      const arrow = ui(
        this.add.triangle(0, 0, 0, 0, 22, 11, 0, 22, accent, 0.92).setVisible(false),
      );
      const text = ui(
        this.add
          .text(0, 0, label, {
            fontFamily: GAME.FONT,
            fontSize: '13px',
            color: '#ffffff',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setVisible(false),
      );
      text.setStroke('#0b1020', 4);

      return { fighter: h.fighter, arrow, text };
    });
  }

  /** 매 프레임 — 화면 밖에 있는 사람만 가장자리에 띄운다 */
  private updateOffscreenMarkers(): void {
    if (!this.offscreenMarks?.length) return;

    const cam = this.cameras.main;
    const left = cam.scrollX;
    const right = cam.scrollX + GAME.WIDTH;
    const MARGIN = 44;

    for (const m of this.offscreenMarks) {
      const f = m.fighter;
      const out = !f.alive ? 0 : f.x < left + MARGIN ? -1 : f.x > right - MARGIN ? 1 : 0;

      if (!out) {
        m.arrow.setVisible(false);
        m.text.setVisible(false);
        continue;
      }

      // 화면 안에서의 세로 위치는 그대로 따라간다 — 위아래 어디쯤인지도 정보다
      const y = Phaser.Math.Clamp(f.y, 90, GAME.HEIGHT - 150);
      const x = out < 0 ? 26 : GAME.WIDTH - 26;

      m.arrow.setPosition(x, y).setAngle(out < 0 ? 180 : 0).setVisible(true);
      m.text.setPosition(x, y - 26).setVisible(true);
    }
  }

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

    this.buildOffscreenMarkers(ui);

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

    if (this.player2) {
      /*
       * 2인 대전은 안내를 사람별로 나눈다.
       *
       * 한 줄에 두 사람 조작을 섞어 쓰면 자기 것을 찾다가 판이 끝난다.
       * 색은 HUD 패널의 1P/2P 표시와 같게 맞춰, 화면 아래를 흘깃 보면
       * 자기 줄이 바로 눈에 들어오게 했다.
       */
      hint(
        16,
        '1P   A/D 이동 · SPACE 점프 · S 방어 · J 약 · K 강 · L 스킬 · U 잡기 · AA/DD 대시',
        '#38bdf8',
      );
      hint(
        34,
        '2P   ← → 이동 · 숫자패드 0 점프 · ↓ 방어 · 1 약 · 2 강 · 3 스킬 · 4 잡기    (숫자패드가 없으면  ,  .  /  ;  \'  순서로 같은 자리)',
        '#f472b6',
      );
    } else {
      hint(
        16,
        'A/D 이동 · SPACE(↑) 점프(2단, 짧게 누르면 낮게) · S 방어 · S+A/D 구르기 · S+SPACE 제자리 회피 · AA/DD 대시 · T 도발 · P 일시정지 · R 재시작',
        '#8ea3cc',
      );
      hint(
        34,
        'J 약공격(JJJ 연속기) · K 강공격(KK, 꾹 누르면 차지) · L 스킬 · U 잡기(가드를 뚫는다)  ｜  잡은 뒤 J 툭툭 · K 던지기(W/S/뒤로 방향 지정) · 잡히면 아무 버튼 연타로 탈출',
        '#a8bce0',
      );
    }

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

      /*
       * 누가 사람인지 한눈에 보여야 한다.
       *
       * 넷이 뒤엉키면 화면에서 자기 캐릭터를 놓친다. 2인 대전이면 특히
       * 그렇다 — 옆 사람 것과 내 것을 헷갈리면 그 판은 끝난 것이나 같다.
       * 1P는 파랑, 2P는 분홍으로 고정해 두고 결과 화면까지 같은 색을 쓴다.
       */
      const label =
        fighter === this.player
          ? '1P'
          : fighter === this.player2
            ? '2P'
            : `CPU (${this.difficulty.label})`;
      const labelColor =
        fighter === this.player
          ? '#38bdf8'
          : fighter === this.player2
            ? '#f472b6'
            : '#7f93bd';

      ui(
        this.add.text(x + 58, y + 27, label, {
          fontFamily: GAME.FONT,
          fontSize: '10px',
          color: labelColor,
          fontStyle: isPlayer ? 'bold' : 'normal',
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
    // 카메라가 정해진 뒤라야 "화면 밖"을 판단할 수 있다
    this.updateOffscreenMarkers();

    /*
     * 게스트는 판을 계산하지 않는다.
     *
     * 자기 입력은 회선으로 보내고, 화면에 보이는 것은 전부 호스트가 계산해
     * 돌려준 결과다. 여기서 전투를 함께 계산하면 두 화면이 조금씩 어긋나기
     * 시작하고, 한번 어긋나면 되돌릴 방법이 없다.
     */
    if (this.netRole === 'guest') {
      this.sendMyInput();
      for (const f of this.fighters) f.update(time, scaled);
      this.projectiles.update(time, scaled);
      this.updateHud();
      return;
    }

    if (this.battleActive) {
      this.handleAllInput();
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

    // 판이 끝난 뒤에도 몇 번 더 보낸다 — 결과가 상대에게 닿아야 한다
    this.sendSnapshot(time);
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

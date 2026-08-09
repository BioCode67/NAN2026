import Phaser from 'phaser';
import { addBackdrop, hasArt } from '../config/artAssets';
import { STAGES, STAGE_BY_ID, pickStage } from '../config/stages';
import {
  PadMenu,
  PadReader,
  emptyFrame,
  mergeFrames,
  mergeTaps,
  packFrame,
  readKeyFrame,
  unpackFrame,
} from '../systems/InputFrame';
import type { InputFrame } from '../systems/InputFrame';
import { net } from '../systems/NetSystem';
import { judgeAt, judgeIndex } from '../systems/RhythmSystem';
import type { NetSnapshot } from '../systems/NetSystem';
import { POSE_ORDER } from '../config/spriteSheets';
import { ITEM_LIST } from '../config/items';

/**
 * 호스트가 판 상태를 보내는 간격 (ms).
 *
 * 매 프레임 보내면 회선이 좁을 때 밀려 오히려 늦게 도착한다. 33ms(초당 30번)면
 * 눈으로는 부드럽고, 그 사이는 받은 속도로 각자 이어 움직여 메운다.
 */
const NET_SEND_MS = 33;
/**
 * 이만큼 아무 입력도 없으면 그 자리는 비었다고 본다.
 *
 * 참가자는 매 프레임(30Hz) 입력을 보내므로 4초는 아주 긴 침묵이다.
 * 그렇다고 1초로 줄이면 잠깐 버벅인 사람이 봇으로 바뀐다.
 */
const QUIET_SEAT_MS = 4000;
/** 조용한 자리를 얼마나 자주 살피는가 */
const QUIET_CHECK_MS = 1000;
/**
 * 결과 화면이 뜬 뒤 패드 입력을 받기까지 (ms).
 *
 * 넷이 붙는 판은 격추 순간에 전원이 버튼을 두드리고 있다. 그 연타를 그대로
 * 받으면 전적표가 뜨자마자 다음 판이 열려, 누가 몇 등인지 아무도 못 본다.
 */
const RESULT_INPUT_DELAY_MS = 1200;
/**
 * 이만큼 지나면 서든데스 — 전원의 주가가 초당 1%씩 흘러내린다.
 *
 * 2분 30초는 보통 판이 이미 끝나 있는 시간이다. 여기 걸리는 판은
 * "둘 다 안 다가가는" 판뿐이고, 그 판이 바로 마감이 필요한 판이다.
 */
const SUDDEN_DEATH_MS = 150000;
/** 서든데스 초당 하락폭 (%) */
const SUDDEN_DEATH_DRAIN = 1;
import type { StageConfig, StageId } from '../config/stages';
import { CHARACTERS } from '../config/characters';
import { pickOpponents } from '../config/matchup';
import { carryOverStock, streakDifficulty, streakTitle } from '../config/streak';
import {
  HIT_REACTION_ORDER,
  AI_MEDIUM,
  CAMERA,
  DEPTH,
  FIGHTER,
  GAME,
  STAGE,
  STOCK,
  TIERS,
} from '../config/gameConfig';
import { BaseCharacter, resetQuoteThrottle } from '../characters/BaseCharacter';
import { buildPortrait } from '../characters/CharacterArt';
import { AI_PROMPTS, gimmickById, readPrompt } from '../config/gimmicks';
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
import type {
  AIDifficulty,
  AttackDir,
  BattleSceneData,
  CharacterId,
  GimmickSpec,
} from '../types';

/** HUD 한 칸(파이터 1명분) */
interface FighterHud {
  fighter: BaseCharacter;
  /** 자리 이름 (1P·2P·CPU…) — 나간 자리를 봇이 이어받으면 바뀐다 */
  seatLabel: Phaser.GameObjects.Text;
  percent: Phaser.GameObjects.Text;
  tierLabel: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
  /**
   * 잔상 바 — 깎인 자리가 잠깐 붉게 남았다가 따라 줄어든다.
   *
   * 바가 값을 즉시 덮어쓰면 큰 피해를 받아도 "순간이동"이라 깎이는 것이
   * 안 보인다. 대전 게임 체력바의 쾌감은 깎여 나가는 그 꼬리에 있다.
   */
  ghostBar: Phaser.GameObjects.Rectangle;
  skillBar: Phaser.GameObjects.Rectangle;
  skillLabel: Phaser.GameObjects.Text;
  itemIcon: Phaser.GameObjects.Text;
  /** 캐릭터 고유 자원 표시 (지분·부스터·풍선…) */
  sigLabel: Phaser.GameObjects.Text;
  /** 직전 프레임의 주가 — 낙차를 감지해 숫자를 튀게 한다 */
  prevValue: number;
  /** 직전 프레임의 스킬 준비 상태 — 준비 완료 순간을 잡아 점멸한다 */
  wasReady: boolean;
  /** 상장폐지 도장을 이미 찍었는가 */
  stamped: boolean;
  /** 패널을 이루는 표시물 전부 — 죽으면 한꺼번에 어둡게 한다 */
  parts: Phaser.GameObjects.GameObject[];
}

/** 등수 색 — 1위 금, 2위 은, 3위 동, 그 밖은 옅게 */
const PLACE_COLORS = ['#ffd54a', '#cbd5e1', '#d19a66', '#6c86c4'];

/**
 * 자리 색 — 1P 파랑, 2P 분홍, 3P 보라, 4P 노랑.
 *
 * 넷이 뒤엉키면 화면에서 자기 캐릭터를 놓친다. 자리마다 색을 고정해 두고
 * HUD부터 결과 화면·화면 밖 화살표까지 같은 색을 쓴다.
 */
const SEAT_COLORS = ['#38bdf8', '#f472b6', '#a78bfa', '#facc15'];
const BOT_COLOR = '#7f93bd';

/** 자리 번호 — 사람 파이터는 P1·P2… 로 이름이 붙어 있다 */
function seatIndex(f: BaseCharacter): number {
  const m = /^P(\d+)$/.exec(f.fighterId);
  return m ? Number(m[1]) - 1 : -1;
}

function seatColor(f: BaseCharacter): string {
  const i = seatIndex(f);
  return i >= 0 ? (SEAT_COLORS[i] ?? SEAT_COLORS[0]!) : BOT_COLOR;
}

/** 같은 자리 색을 도형용 숫자로 (`#38bdf8` → 0x38bdf8) */
function seatTint(f: BaseCharacter): number {
  return Number.parseInt(seatColor(f).slice(1), 16);
}

/** HUD 패널 규격 — 4명이 한 줄에 들어가야 한다 */
const HUD_PANEL_W = 296;
const HUD_PANEL_H = 78;
const HUD_GAP = 16;
const HUD_Y = 624;

/* ── 상장폐지된 사람 — 공매도 유령 ─────────────────────────────────
 *
 * 넷이 붙는 판에서 가장 먼저 떨어진 사람은 남은 1~2분을 구경만 한다.
 * 그 시간이 이 게임에서 제일 재미없는 시간이고, 넷이 모여 노는 판에서는
 * **한 사람이 빠지는 순간 판 전체의 분위기가 식는다.**
 *
 * 그래서 죽으면 판 위를 떠다니는 유령이 된다. 좌우로 움직이며 원하는
 * 자리에 물건을 떨어뜨릴 수 있다 — 살아남은 사람을 도울 수도, 앞서가는
 * 사람 머리 위에 폭탄을 떨어뜨릴 수도 있다. 이기지는 못하지만 판은 흔든다.
 * 상장폐지된 사람이 공매도로 시장을 흔드는 그림이라 주제에도 맞는다.
 */
const GHOST_Y = 96;
/** 유령이 좌우로 움직이는 속도 (px/초) */
const GHOST_SPEED = 520;
/** 물건을 떨어뜨린 뒤 다음까지 (ms) — 짧으면 살아 있는 사람이 못 논다 */
const GHOST_COOLDOWN = 5200;
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
    /** 온라인 자리 번호 — 나간 사람을 찾아내는 데 쓴다 */
    slot?: number;
    /**
     * 이 사람이 쓰는 패드 번호 (없으면 키보드만).
     *
     * 자리 순서에서 유추하지 않고 **명시한다.** 3·4번 자리는 패드 전용인데,
     * 키보드를 쓰는 1·2번까지 세어 버리면 세 번째 사람에게 세 번째 패드를
     * 찾아 주게 된다 — 실제로 꽂힌 것은 첫 번째 패드 하나뿐인데도.
     * 누가 어느 장치를 쓰는지는 자리를 만들 때 이미 정해지므로 그때 적는다.
     */
    padIndex?: number;
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
  /** 이번 구간의 상장폐지 [피해자 자리, 격추자 자리(-1 자멸)] — 참가자 화면용 */
  private netKos: number[][] = [];
  /** 마지막 타격의 리듬 판정 번호 — damageHook 이 쓰고 combat:hit 수집기가 읽는다 */
  private netJudge = -1;
  /** 서든데스 발동 여부 + 다음 하락 틱 시각 */
  private suddenDeath = false;
  private sdNextTickAt = 0;
  /** 서든데스 화면 가장자리 붉은 테 */
  private sdVignette?: Phaser.GameObjects.Rectangle;
  /** 참가자 쪽 — 회선으로 미리 알게 된 격추자 (자리번호). setExact 의 ko 가 쓴다 */
  private remoteKillers = new Map<number, number>();
  /** 회선이 끊겼을 때 한 번만 알린다 */
  private netEnded = false;
  /** 참가자가 보낸 문장을 기다리는 중인 약속 (호스트) */
  private remoteSaid?: (text: string) => void;
  /** 지금 문장을 기다리고 있는 자리 (없으면 -1) */
  private waitingOnSlot = -1;
  /**
   * 회선이 실제로 오가고 있는가 (검사·디버그용).
   *
   * "연결됐다"와 "입력이 도착한다"는 다른 문제다. 연결만 보고 넘어가면
   * 조용히 아무것도 안 오는 상태를 못 잡는다.
   */
  netStats = { sent: 0, recv: 0 };

  /* --- 선두 표시 -------------------------------------------------- */
  /** 지금 주가가 가장 높은 사람 머리 위에 뜨는 왕관 */
  private crown?: Phaser.GameObjects.Image;
  /** 마지막으로 선두였던 사람 — 바뀔 때만 알린다 */
  private leaderId = '';
  /** 선두 교체를 마지막으로 알린 시각 — 엎치락뒤치락하면 배너가 도배된다 */
  private leaderAnnouncedAt = 0;

  /** 화면 밖으로 나간 사람을 가리키는 가장자리 표시 */
  private offscreenMarks: Array<{
    fighter: BaseCharacter;
    arrow: Phaser.GameObjects.Triangle;
    text: Phaser.GameObjects.Text;
  }> = [];

  private paused = false;
  private pauseOverlay?: Phaser.GameObjects.Container;

  /**
   * 게임패드 — 이 기계의 n번째 사람에게 n번째 패드가 간다.
   *
   * 패드마다 "방금 눌림"을 가려낼 앞 프레임 기억이 필요해서 사람 수만큼
   * 리더를 둔다. 키보드와 패드는 합집합이다 — 어느 쪽을 눌러도 통하므로
   * 설정할 것도, 고를 것도 없다.
   */
  /**
   * 인원을 따라가는 줌 (격추 펀치는 빠져 있다).
   *
   * cam.zoom 을 그대로 읽으면 안 된다 — 펀치가 얹힌 값이라, 그것을 기준으로
   * 다시 보간하면 펀치가 따라가는 줌 자체를 끌고 다닌다.
   */
  private baseZoom = 1;
  /** 격추 순간의 카메라 펀치 세기 (0~1) — 따라가는 줌 위에 배수로 얹힌다 */
  private zoomPunch = 0;

  private padReaders: PadReader[] = [];
  /** 스타트 버튼 — 일시정지·다음 상대. 전투 조작과 갈라 둔다 */
  private padMenu = new PadMenu();

  /** 사람이 나가 봇이 이어받은 자리들 */
  private takenOver = new Set<string>();

  /** 상장폐지된 사람들의 유령 (자리 번호 → 상태) */
  private ghosts = new Map<number, { x: number; readyAt: number; mark?: Phaser.GameObjects.Container }>();

  /** 전투가 실제로 시작된 시각 (0 = 아직) */
  private battleActiveSince = 0;

  /** 다음 판을 이미 열었는가 (R 연타로 두 번 열리지 않게) */
  private rematching = false;

  /** 조용해진 자리를 마지막으로 확인한 시각 */
  private lastReapAt = 0;

  /** 결과 화면이 떠 있는가 — 카메라를 원점에 묶는 데 쓴다 */
  private resultShown = false;
  /**
   * 결과 화면에서 패드 입력을 받기 시작하는 시각.
   *
   * 격추 순간에는 대개 전원이 버튼을 두드리고 있다. 그 연타가 그대로
   * 다음 판을 열면 누가 몇 등인지 아무도 못 본 채 넘어간다.
   */
  private resultReadyAt = 0;

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
    this.ghosts.clear();
    this.battleActiveSince = 0;
    this.rematching = false;
    this.takenOver.clear();
    this.battleActive = false;
    // 씬 객체는 판마다 새로 만들어지지 않는다 — 앞 판의 값이 남으면 카메라가 묶인 채 시작한다
    this.resultShown = false;
    /*
     * 선택 화면에서 **스타트로 확정하고** 들어오면 그 버튼이 아직 눌려 있다.
     * 지금은 togglePause 가 인트로 중에는 안 멈춰 사고로 안 이어지지만,
     * 그것은 여기와 상관없는 이유로 있는 자물쇠다. 새는 자리에서 막는다.
     */
    this.padMenu.prime();
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
    this.netKos = [];
    this.remoteKillers = new Map();
    // 씬 인스턴스는 재사용된다 — 앞 판의 파괴된 표시물을 들고 있으면 안 된다
    this.killFeed = [];
    this.controlHints = [];
    this.hintsFolded = false;
    this.netHealthText = undefined;
    this.suddenDeath = false;
    this.sdNextTickAt = 0;
    this.sdVignette = undefined;
    this.leaderId = '';
    this.leaderAnnouncedAt = 0;

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
    /*
     * 이 기계 앞에 앉은 사람들.
     *
     * 1·2번은 키보드를 나눠 쓰고, 3·4번은 패드다 — 한 키보드에 손 셋을
     * 얹을 수 없어서 지금까지 여기가 둘에서 막혀 있었다. 자리마다 어느
     * 장치를 쓰는지는 아래 humans 를 세울 때 함께 적는다.
     *
     * humanIds 가 있으면 그것이 명단이고, 없으면 옛 방식(playerId +
     * player2Id)으로 읽는다. 온라인은 이 함수까지 오지 않는다(duel 로 갈린다).
     */
    const humanIds =
      this.battleData.humanIds ??
      ([this.battleData.playerId, this.battleData.player2Id].filter(
        Boolean,
      ) as CharacterId[]);
    const total = humanIds.length + this.battleData.aiIds.length;

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

    /*
     * 사람을 **바깥쪽부터** 세운다 — 1P 왼쪽 끝, 2P 오른쪽 끝, 3·4P 그 안쪽.
     *
     * 사람끼리 붙으려면 사이에 있는 봇을 헤치고 가야 하니, 시작하자마자
     * 둘이 서로만 두들기는 판이 안 된다. 셋·넷이 되면 사람이 사람 옆에
     * 서게 되는데, 그때는 그게 오히려 낫다 — 시작 신호와 함께 바로 붙는다.
     */
    const humanSpots = humanIds.map((_, i) =>
      i % 2 === 0 ? startX + gap * (i / 2) : STAGE.RIGHT - 130 - gap * ((i - 1) / 2),
    );

    const humans = humanIds.map((id, i) => {
      const f = new BaseCharacter(
        this,
        humanSpots[i]!,
        spawnY,
        CHARACTERS[id],
        'player',
        `P${i + 1}`,
      );
      // 왼쪽에서 시작한 사람은 오른쪽을, 오른쪽에서 시작한 사람은 왼쪽을 본다
      f.facing = i % 2 === 0 ? 1 : -1;
      this.fighters.push(f);
      return f;
    });

    this.player = humans[0]!;
    /*
     * player2 는 "이 판에 나 말고 다른 사람이 있는가"의 표시로도 쓰인다
     * (연승 도전을 끄고, 결과 화면 문구를 바꾸고, 조작 안내를 나눈다).
     * 셋·넷일 때도 그 답은 같으므로 두 번째 사람을 그대로 넣는다.
     */
    this.player2 = humans[1];

    // 봇은 사이를 메운다 (사람이 늘면 그만큼 자리가 줄어든다)
    const botSlots = Math.max(0, total - humans.length);
    this.battleData.aiIds.slice(0, botSlots).forEach((id, i) => {
      const bot = new BaseCharacter(
        this,
        startX + gap * (humans.length + i),
        spawnY,
        CHARACTERS[id],
        'ai',
        `CPU${i + 1}`,
      );
      bot.facing = -1;
      this.fighters.push(bot);
    });

    /*
     * 사람마다 자기 입력원과 자기 더블탭 기록을 갖는다.
     *
     * 1번은 키보드(WASD 계열) + 첫 패드, 2번은 키보드(방향키 계열) + 둘째 패드.
     * 3번부터는 키보드가 남아 있지 않으므로 패드 전용이다 — 패드 번호를
     * 자리 순서로 유추하지 않고 여기서 못 박는다.
     */
    const p1Keys = { ...this.keys };
    // 2P가 있으면 방향키는 2P 것이다 — 1P의 ↑ 점프를 뗀다
    if (this.player2) delete p1Keys.jumpAlt;
    const keySets = [p1Keys, this.keys2];

    this.humans = humans.map((f, i) => ({
      fighter: f,
      keys: keySets[i] ?? {},
      tap: { dir: 0 as -1 | 0 | 1, at: 0 },
      padIndex: this.padSeatIndex(i, humans.length),
      /*
       * 자리 번호는 로컬에서도 적는다.
       *
       * 온라인 전용처럼 보이지만 **유령이 이 번호로 갈린다**(ghostOf).
       * 안 적으면 전부 0번으로 접히고, 로컬에서 둘째가 상장폐지되는 순간
       * 첫째의 유령을 함께 조종하게 된다 — 유령은 하나만 그려지고 두 사람의
       * 좌우 입력이 같은 것을 밀고 당긴다. 사람이 둘까지일 때는 둘 다 죽으면
       * 판이 끝나서 드러나지 않던 것이, 넷이 되면서 실제로 보인다.
       *
       * 온라인 자리 관리(handOverToBot·quietSlots)는 remote 인 자리만 보므로
       * 여기에 번호가 있어도 건드리지 않는다.
       */
      slot: i,
    }));

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
        slot,
      }));
    } else if (this.netRole === 'guest') {
      /*
       * 참가자 화면의 파이터는 전원 꼭두각시다 — 시뮬레이션을 돌리면
       * computePose 가 회선으로 온 공격 포즈를 매 프레임 지워버린다.
       */
      this.fighters.forEach((f) => f.makePuppet());
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

    /*
     * 판이 열리는 순간 자리들의 시계를 되감는다.
     *
     * 참가자가 첫 입력을 보내기까지는 화면 전환과 씬 로딩만큼 시간이 걸린다.
     * 그 침묵을 "사라진 사람"으로 세면 아직 들어오지도 않은 사람이 봇으로
     * 바뀐다 — 느린 기계일수록 그렇게 된다.
     */
    net.markAllHeard();

    net.onInput = (slot, held, taps) => {
      this.netStats.recv++;
      const f = unpackFrame(held, taps);
      // 눌림은 덮어쓰지 않고 쌓는다 — 전송 사이에 스쳐 간 탭이 사라지지 않게
      const prev = this.remoteFrames[slot];
      if (prev) mergeTaps(f, prev);
      this.remoteFrames[slot] = f;
    };

    net.onSnapshot = (snap) => this.applySnapshot(snap);

    /*
     * 오브를 깬 사람이 문장을 입력할 차례다.
     *
     * 넷이 붙는 판에서 이 순간은 전원이 멈춰 지켜보는 시간이다 —
     * 한 사람만 멈추면 나머지는 그동안 계속 싸워서 불공평하다.
     */
    net.onAsk = (slot, who, accent) => {
      const mine = slot === (this.battleData.netSlot ?? 0);
      void this.awaitPrompt(mine, who, accent);
    };

    /* 참가자가 보낸 문장 — 호스트가 받아 판에 건다 */
    net.onSaid = (text) => this.remoteSaid?.(text);

    /* 무엇이 걸렸는지 — 참가자는 이걸 받아 같은 화면을 그린다 */
    net.onGimmick = (ids, text, who, note) => {
      this.resumeAll();
      ids.forEach((id, i) => {
        const spec = gimmickById(id);
        if (!spec) return;
        this.time.delayedCall(i * 650, () => {
          if (!this.scene.isActive()) return;
          this.gimmicks.activate(spec, text, this.time.now, note);
        });
        // 참가자 화면의 결과표에도 같은 문장이 남아야 한다
        this.logPrompt(text, who, spec);
      });
      if (who) this.announce(`${who}의 명령`, '#f472b6', 900);
    };

    /*
     * 넷 중 하나가 나갔다 — 봇이 이어받는다.
     *
     * ── 왜 이렇게까지 하는가 ──────────────────────────────────────
     * 넷이 붙는 판에서 한 사람이 창을 닫는 일은 드물지 않다. 지금까지는 그
     * 캐릭터가 그 자리에 **그대로 서 있었다**. 남은 셋은 허수아비를 상대로
     * 남은 판을 치르게 되는데, 그건 진 사람에게도 이긴 사람에게도 판이 아니다.
     * 자리를 봇에게 넘기면 판은 판으로 끝난다.
     *
     * 판을 그 자리에서 끝내 버리는 선택지도 있었지만, 셋이 잘 싸우고 있는
     * 판을 한 사람의 사정으로 없애는 쪽이 더 나쁘다.
     */
    /* 방장이 "한 판 더"를 눌렀다 — 참가자는 그대로 따라간다 */
    net.onAgain = (d) => {
      if (this.netRole !== 'guest' || this.rematching) return;
      this.rematching = true;
      this.scene.start('Battle', {
        playerId: d.chars[0]!,
        humanIds: d.chars,
        netSlot: net.slot,
        aiIds: d.bots,
        stageId: d.stageId,
        duel: true,
        netRole: 'guest',
      } satisfies BattleSceneData);
    };

    net.onLeft = (slot, reason) => {
      if (this.netRole !== 'host') return;
      /*
       * 하필 그 사람 차례에 나갔다면 먼저 판부터 되돌린다.
       *
       * 문장을 기다리는 동안에는 **전원이 멈춰 있다.** 기다리던 사람이
       * 창을 닫으면 아무리 기다려도 문장은 오지 않는데, 안전장치가 15초라
       * 남은 셋은 멈춘 화면을 15초 동안 본다 — 회선이 끊긴 줄 안다.
       * 나갔다는 것을 아는 순간이 곧 기다림이 끝나는 순간이다.
       */
      if (this.waitingOnSlot === slot) {
        this.announce('입력하던 사람이 나갔습니다', '#facc15', 1400);
        this.remoteSaid?.('');
      }
      this.handOverToBot(slot, reason);
    };

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
        eventBus.on('fighter:ko', (p) => {
          this.netKos.push([
            this.fighters.findIndex((f) => f.fighterId === p.fighterId),
            p.killerId
              ? this.fighters.findIndex((f) => f.fighterId === p.killerId)
              : -1,
          ]);
        }),
        eventBus.on('combat:hit', (e) => {
          const attacker = this.fighters.find((f) => f.fighterId === e.attackerId);
          const victimAt = this.fighters.findIndex((f) => f.fighterId === e.targetId);
          const victim = this.fighters[victimAt];
          this.netHits.push([
            Math.round(e.x),
            Math.round(e.y),
            attacker?.cfg.colors.accent ?? 0xffffff,
            e.damage >= 18 ? 1 : 0,
            /*
             * 맞은 쪽의 몸 반응까지 실어 보낸다.
             * 참가자 화면은 receiveHit 을 안 돌므로, 이게 없으면 맞는 순간
             * 파티클만 튀고 몸은 뻣뻣하게 서 있다.
             */
            victimAt,
            Math.max(0, HIT_REACTION_ORDER.indexOf(victim?.getHitReaction() ?? 'jab')),
            // 리듬 판정 번호 (-1 = 리듬 배틀 아님)
            this.netJudge,
            // 연타 카운터 — 참가자 화면에도 "N HIT · 가즈아!"가 떠야 한다
            this.fighters.indexOf(attacker ?? this.player),
            this.combat.getCombo(e.attackerId),
          ]);
          this.netJudge = -1;
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
    // 참가자도 패드로 칠 수 있다 — 이 기계의 사람은 나 하나뿐이니 0번 패드다
    const pad = this.padFrame(0);
    if (pad) mergeFrames(frame, pad);
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
        /*
         * 계기판 값들 — 참가자 쪽 파이터는 시뮬레이션이 없어서 이 값들을
         * 스스로 만들 수 없다. 실제로 스킬 게이지가 항상 가득 찬 것으로
         * 보였다 — 쿨다운 시계가 이쪽에만 있었기 때문이다.
         */
        Math.round(f.getSkillCooldownRatio() * 100),
        f.getSignatureStacks(),
        f.getSigFlag() ? 1 : 0,
        ITEM_LIST.findIndex((i) => i.id === f.getItem()?.cfg.id),
        Math.round(f.getChargeRatio() * 100),
        f.getChainSlotIndex(),
      ]),
    };
    if (this.netHits.length) {
      snap.hit = this.netHits.slice(0, 8);
      this.netHits.length = 0;
    }
    if (this.netKos.length) {
      snap.ko = this.netKos.slice(0, 4);
      this.netKos.length = 0;
    }
    // 오브는 이 게임의 중심 장치다 — 안 보이면 판이 왜 멈추는지 알 수가 없다
    snap.orb = this.orbs.snapshot();
    // 아이템도 — 안 보이면 상대가 왜 갑자기 세졌는지 알 수가 없다
    const items = this.items.snapshot();
    if (items.length) snap.item = items;
    // 투사체 — 없으면 참가자는 블루스크린을 "안 보이는 공격"으로 맞는다
    const pj = this.projectiles.snapshot();
    if (pj.length) snap.pj = pj;
    /*
     * 유령도 보내야 한다.
     *
     * 참가자가 자기 유령을 각자 계산하면 "내가 여기 떨어뜨렸는데 저기 떨어졌다"가
     * 된다. 물건이 떨어지는 자리는 호스트가 정하므로, 조준선도 호스트 것을 본다.
     */
    if (this.ghosts.size) {
      snap.gh = [...this.ghosts].map(([slot, g]) => [
        slot,
        Math.round(g.x),
        time >= g.readyAt ? 1 : 0,
      ]);
    }
    if (this.suddenDeath) snap.sd = 1;
    if (!this.battleActive) {
      const alive = this.fighters.findIndex((f) => f.alive);
      snap.over = alive;
      // 결과 화면용 전적 — 참가자는 이벤트가 없어 스스로 못 센다
      snap.stat = this.fighters.map((f) => {
        const r = this.stats.get(f.fighterId);
        return [
          Math.round(r.dealt),
          Math.round(r.taken),
          r.kos,
          r.hits,
          Math.round(r.bestHit),
          r.bestHitName,
        ];
      });
    }

    net.sendSnapshot(snap);
  }

  /** 참가자 화면의 아이템 획득 연출 — 링과 이름표만, 판정은 호스트 것이다 */
  private playRemotePickup(f: BaseCharacter, icon: string, name: string): void {
    sound.play('uiConfirm', 0.5);
    const ring = this.add
      .circle(f.x, f.y - 30, 18)
      .setStrokeStyle(3, 0xffd54a, 0.9)
      .setDepth(DEPTH.FLOATING);
    this.tweens.add({
      targets: ring,
      scale: 2.2,
      alpha: 0,
      duration: 330,
      onComplete: () => ring.destroy(),
    });
    const label = this.add
      .text(f.x, f.y - 64, `${icon} ${name}`, {
        fontFamily: GAME.FONT,
        fontSize: '15px',
        color: '#ffd54a',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.FLOATING);
    label.setStroke('#0b1020', 5);
    this.tweens.add({
      targets: label,
      y: label.y - 40,
      alpha: 0,
      duration: 900,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  /** 게스트 — 받은 모습을 그대로 그린다 */
  /** 마지막 스냅샷이 도착한 시각 (참가자) — 회선 상태 표시가 본다 */
  private lastSnapRecvAt = 0;
  private netHealthText?: Phaser.GameObjects.Text;

  /**
   * 회선 상태 표시 (참가자 화면 오른쪽 위).
   *
   * 온라인에서 화면이 굳으면 사람은 자기 탓부터 한다 — "내가 뭘 잘못
   * 눌렀나". 스냅샷이 끊긴 지 얼마나 됐는지를 화면이 말해 주면, 게임
   * 문제와 회선 문제를 사람이 구별할 수 있다.
   */
  private updateNetHealth(time: number): void {
    if (!this.netHealthText) {
      this.netHealthText = this.add
        .text(GAME.WIDTH - 14, 12, '', {
          fontFamily: GAME.FONT,
          fontSize: '13px',
          fontStyle: 'bold',
        })
        .setOrigin(1, 0)
        .setDepth(DEPTH.HUD + 1)
        .setScrollFactor(0);
      this.netHealthText.setStroke('#0b1020', 4);
      this.lastSnapRecvAt = time;
    }

    const gap = time - this.lastSnapRecvAt;
    if (gap < 400) {
      // 정상 — 조용히 있는다. 초록 점을 계속 띄우면 그것도 소음이다
      this.netHealthText.setText('');
    } else if (gap < 2000) {
      this.netHealthText.setText('📶 회선 지연…').setColor('#facc15');
    } else {
      this.netHealthText
        .setText(`📶 연결이 끊긴 것 같습니다 (${Math.floor(gap / 1000)}초)`)
        .setColor('#ef4444');
    }
  }

  private applySnapshot(snap: NetSnapshot): void {
    // 늦게 도착한 옛 상태는 버린다 (되감기면 캐릭터가 뒤로 튄다)
    if (snap.n <= this.netSeq) return;
    this.netSeq = snap.n;
    this.lastSnapRecvAt = this.time.now;

    /* 유령 — 자리와 "던질 수 있는가"만 받는다 */
    for (const [slot, x, ready] of snap.gh ?? []) {
      /*
       * 죽은 참가자 본인에게는 조작법을 알려야 한다.
       * 호스트 화면에는 안내가 뜨는데 정작 유령을 조종할 사람의 화면에는
       * 안 떠서, 자기가 아직 판에 개입할 수 있다는 것을 모른 채 구경만 했다.
       */
      if (!this.ghosts.has(slot!) && slot === net.slot) {
        this.announce('유령이 됐다! ← → 조준 · J 로 물건 투하', '#a78bfa', 2600);
      }
      const g = this.ghosts.get(slot!) ?? { x: x!, readyAt: 0 };
      g.x = x!;
      g.readyAt = ready ? 0 : Number.POSITIVE_INFINITY;
      this.ghosts.set(slot!, g);
    }

    // 격추자 정보를 먼저 챙긴다 — 아래 alive 반영이 ko 이벤트를 일으킨다
    for (const [victimAt, killerAt] of snap.ko ?? []) {
      this.remoteKillers.set(victimAt!, killerAt ?? -1);
    }

    snap.f.forEach((row, i) => {
      const f = this.fighters[i];
      if (!f || !f.body) return;

      const [x, y, vx, vy, facing, alive, stock, pose, cd, stacks, flag, item, chg, chain] =
        row;
      f.setPosition(x!, y!);
      // 속도까지 받아야 다음 상태가 올 때까지 이 자리에 얼어붙지 않는다
      f.body.setVelocity(vx!, vy!);
      f.facing = facing === -1 ? -1 : 1;
      this.stock.setExact(f.fighterId, stock!);
      f.applyRemoteMeters(
        (cd ?? 0) / 100,
        stacks ?? 0,
        flag === 1,
        (chg ?? 0) / 100,
        chain ?? -1,
      );
      /*
       * 아이템 획득 순간 — 아이콘이 없음→있음으로 바뀌는 전이가 곧 "집었다"다.
       * 호스트 쪽 획득 연출(grant)은 이쪽에서 안 돌므로, 상자가 소리 없이
       * 증발하고 상대가 말없이 세지는 것처럼 보였다.
       */
      const prevIcon = f.remoteItemIcon;
      const cfgItem = item !== undefined && item >= 0 ? ITEM_LIST[item] : undefined;
      f.remoteItemIcon = cfgItem?.icon ?? '';
      if (cfgItem && !prevIcon) this.playRemotePickup(f, cfgItem.icon, cfgItem.name);
      const p = POSE_ORDER[pose!];
      if (p) f.setRemotePose(p);
      /*
       * 장외 격추는 주가가 남은 채 죽는다 — setExact 로는 ko 이벤트가
       * 안 나므로 여기서 직접 연출까지 챙긴다. (주가 0 격추는 setExact 가
       * 이미 이벤트를 내 위 경로에서 처리되고, alive 가 벌써 false 라
       * 이 분기는 조용히 지나간다)
       */
      if (!alive && f.alive) {
        const killerAt = this.remoteKillers.get(i);
        this.remoteKillers.delete(i);
        f.kill();
        this.koOrder.push(f.fighterId);
        this.playKo(
          f,
          killerAt !== undefined && killerAt >= 0
            ? (this.fighters[killerAt] ?? null)
            : null,
        );
      }
    });

    for (const h of snap.hit ?? []) {
      this.combat.playRemoteHit(h[0]!, h[1]!, h[2]!, h[3] === 1);
      // 맞은 쪽 몸 반응 — 젖혀짐·찌그러짐·점멸
      const victim = this.fighters[h[4] ?? -1];
      const reaction = HIT_REACTION_ORDER[h[5] ?? -1];
      if (victim?.alive && reaction) victim.playRemoteReaction(reaction);
      // 리듬 배틀 판정 — 호스트 시계로 판정된 것을 그대로 띄운다
      const judge = judgeAt(h[6] ?? -1);
      if (judge) this.rhythm.showJudge(h[0]!, h[1]!, judge);
      // 연타 카운터 — 호스트가 센 수 그대로
      this.combat.playRemoteCombo(this.fighters[h[7] ?? -1], h[8] ?? 0);
    }
    this.orbs.applyRemote(snap.orb, this.time.now);
    this.items.applyRemote(snap.item ?? []);
    this.projectiles.applyRemote(snap.pj ?? []);

    // 서든데스 — 하락 자체는 setExact 로 오고, 여기서는 연출만 켠다
    if (snap.sd && !this.suddenDeath) {
      this.suddenDeath = true;
      this.announce('⏰ 서든데스 — 전원 주가가 흘러내린다!', '#ef4444', 2400);
      sound.play('finisher');
      this.startSdVignette();
      sound.setIntensity(1);
    }

    // 전적 주입은 결과 화면을 세우기 전에 — 표가 0으로 굳은 뒤에는 늦다
    snap.stat?.forEach((row, i) => {
      const f = this.fighters[i];
      if (!f) return;
      this.stats.injectRemote(f.fighterId, {
        dealt: row[0],
        taken: row[1],
        kos: row[2],
        hits: row[3],
        bestHit: row[4],
        bestHitName: row[5],
      });
    });

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
      // 같은 동기 흐름에서 combat:hit 수집기가 읽는다 — 참가자 화면 판정 팝업용
      this.netJudge = judgeIndex(judge);
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

  /**
   * 조용해진 자리를 정리한다 (호스트에서만).
   *
   * ── 왜 인사만 믿지 않는가 ────────────────────────────────────────
   * 창을 닫을 때 "나간다"고 알려 주는 회선도 있지만, 그 인사가 아예 안 오는
   * 경우가 훨씬 많다 — 탭을 그냥 닫거나, 노트북을 덮거나, 회선이 끊기거나,
   * 브라우저가 죽거나. 어느 쪽이든 결과는 같다: **그 캐릭터를 아무도 조종하지
   * 않는다.** 참가자는 매 프레임 자기 입력을 보내므로 조용해진 자리는 곧
   * 사라진 사람이고, 그 판단에 인사는 필요 없다.
   *
   * 문장을 입력하는 동안에는 전원이 멈춰 입력을 보내지 않으므로 세지 않는다 —
   * 그때 세면 문장을 오래 고민한 사람이 봇으로 바뀐다.
   */
  private reapQuietSeats(time: number): void {
    /*
     * 프롬프트 입력 중에도 회수기는 돈다.
     *
     * 전에는 prompting 이면 쉬었다 — 판이 멈췄으니 침묵이 정상이라고 봤다.
     * 그런데 참가자들은 판이 멈춰도 입력 프레임을 계속 보내므로(사람이
     * 있다는 신호), 진짜로 조용해지는 자리는 **끊긴 자리**뿐이다. 하필
     * 문장을 입력하던 사람이 이탈 신호도 없이 사라지면, 이 회수기 말고는
     * 아무도 판을 되살릴 수 없다 — 전원이 영원히 그 사람을 기다린다.
     */
    if (this.netRole !== 'host' || !this.battleActive) return;

    /*
     * 판이 막 열린 동안은 세지 않는다.
     *
     * 인트로가 끝나 전투가 시작될 때, 참가자 쪽은 아직 무대를 그리는 중일 수
     * 있다. 그 몇 초를 침묵으로 세면 첫 판이 시작되자마자 사람이 봇으로
     * 바뀐다 — 실제로 그렇게 됐다.
     */
    // 판이 시작된 시각은 전투 개시에서 찍는다 (여기서 찍으면 로컬에서 안 찍힌다)
    if (this.battleActiveSince === 0) return;
    if (time - this.battleActiveSince < QUIET_SEAT_MS) return;

    if (time - this.lastReapAt < QUIET_CHECK_MS) return;
    this.lastReapAt = time;

    for (const slot of net.quietSlots(QUIET_SEAT_MS)) {
      net.dropSlot(slot, '소식이 끊겼습니다.');
    }
  }

  /**
   * 서든데스 — 판이 이만큼 지나면 전원의 주가가 흘러내리기 시작한다.
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────
   * 신중한 둘이 남으면 판이 한없이 길어진다. 서로 다가가지 않는 것이
   * 항상 안전하기 때문이다 — 특히 온라인에서 그렇다. 시간이 지나면
   * 버티는 쪽이 반드시 지게 되어 있어야, 남은 판이 마감을 향해 조여든다.
   *
   * 흘러내리는 주가는 "지속 피해"가 아니라 **마감**이다. 맞아서 깎이는
   * 것과 달리 누구의 전적에도 안 잡히고, 전원이 똑같이 잃으므로 유불리를
   * 바꾸지 않는다 — 단지 시간을 무기로 쓰는 선택지를 지운다.
   */
  private tickSuddenDeath(time: number): void {
    if (!this.battleActive || this.prompting) return;

    if (!this.suddenDeath) {
      if (this.battleActiveSince === 0) return;
      if (time - this.battleActiveSince < SUDDEN_DEATH_MS) return;

      this.suddenDeath = true;
      this.sdNextTickAt = time;
      this.announce('⏰ 서든데스 — 전원 주가가 흘러내린다!', '#ef4444', 2400);
      sound.play('finisher');
      this.startSdVignette();
      // 곡도 최고 단계로 — 귀로도 "이제 끝이 온다"가 들려야 한다
      sound.setIntensity(1);
      return;
    }

    if (time < this.sdNextTickAt) return;
    this.sdNextTickAt = time + 1000;
    for (const f of this.fighters) {
      if (f.alive) this.stock.add(f.fighterId, -SUDDEN_DEATH_DRAIN);
    }
  }

  /** 서든데스 표시 — 화면 가장자리가 붉게 고동친다 (호스트·참가자 공통) */
  private startSdVignette(): void {
    if (this.sdVignette) return;
    this.sdVignette = this.add
      .rectangle(0, 0, GAME.WIDTH, GAME.HEIGHT)
      .setOrigin(0)
      .setDepth(DEPTH.HUD - 2)
      .setScrollFactor(0)
      .setFillStyle(0x000000, 0)
      .setStrokeStyle(26, 0xef4444, 0.28);
    this.tweens.add({
      targets: this.sdVignette,
      alpha: { from: 1, to: 0.35 },
      duration: 640,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * 나간 사람의 캐릭터를 봇에게 넘긴다 (호스트에서만).
   *
   * 회선으로 오던 입력이 끊기면 그 자리는 아무 입력도 받지 못한다 —
   * `humans` 에서 빼서 더 이상 회선 입력을 기다리지 않게 하고, 같은 캐릭터에
   * AI를 새로 붙인다. 캐릭터·주가·위치는 그대로 두므로 판은 이어진다.
   */
  private handOverToBot(slot: number, reason: string): void {
    const i = this.humans.findIndex((h) => h.remote && h.slot === slot);
    if (i < 0) return;

    const taken = this.humans[i]!;
    const f = taken.fighter;
    this.humans.splice(i, 1);

    // 손을 뗀 순간의 입력이 눌린 채로 남으면 계속 그 방향으로 걷는다
    f.moveHorizontal(0);
    f.setGuard(false);

    /*
     * 봇을 새로 붙인다. 다른 봇과 똑같은 배선을 준다 — 이어받은 자리라고
     * 스킬을 못 쓰면 그때부터 그 캐릭터만 반쪽이 된다.
     */
    this.ais.push(
      new AISystem(f, () => this.pickAiTarget(f), this.difficulty, {
        castSkill: (g) => this.castSkill(g),
      }),
    );

    this.takenOver.add(f.fighterId);
    const hud = this.huds.find((h) => h.fighter === f);
    hud?.seatLabel.setText(this.seatName(f)).setColor(BOT_COLOR);

    this.announce(`${f.cfg.name} — 봇이 이어받는다`, '#facc15', 1600);
    console.info(`[net] ${reason} (자리 ${slot}) — 봇 전환`);
  }

  /**
   * 이 자리를 뭐라고 부를 것인가.
   *
   * ── 왜 따로 두는가 ──────────────────────────────────────────────
   * 전에는 "내 것이면 1P, player2 면 2P, 나머지는 전부 CPU"였다. 사람이
   * 둘일 때는 맞는 말이지만 **온라인에서 넷이 붙으면 3번·4번 자리에 앉은
   * 진짜 사람이 판 내내 "CPU (중간)"으로 표시된다.** 이긴 사람이 3번이면
   * 결과 화면에도 "봇 승리…"라고 뜬다.
   *
   * 자리 번호는 파이터 이름(P1·P2…)에 이미 들어 있고 그 순서는 모든 화면에서
   * 같다. 그것을 그대로 쓴다.
   */
  private seatName(f: BaseCharacter): string {
    const i = seatIndex(f);
    if (i < 0) return `CPU (${this.difficulty.label})`;
    // 사람이 나가 봇이 이어받은 자리 — 사람인 척하면 안 된다
    if (this.takenOver.has(f.fighterId)) return `${i + 1}P 자리 · 봇`;
    return `${i + 1}P`;
  }

  /* ================================================================ */
  /* 공매도 유령 — 상장폐지된 사람도 판에 개입한다                      */
  /* ================================================================ */

  /**
   * 유령 한 명분 갱신 — 좌우 이동과 투하.
   *
   * 호스트에서만 실제로 물건이 떨어진다. 참가자 화면은 유령의 자리를
   * 상태로 받아 그린다 — 각자 계산하면 "내가 여기 떨어뜨렸는데 저기 떨어졌다"가
   * 되고, 그건 조작이 고장난 것으로 느껴진다.
   */
  private updateGhost(
    h: (typeof this.humans)[number],
    localIdx: number = -1,
  ): void {
    if (this.netRole === 'guest') return;

    const frame = h.remote ? h.remote() : readKeyFrame(h.keys);
    if (localIdx >= 0) {
      const pad = this.padFrame(localIdx);
      if (pad) mergeFrames(frame, pad);
    }
    const g = this.ghostOf(h);
    const dt = this.game.loop.delta / 1000;

    if (frame.left) g.x -= GHOST_SPEED * dt;
    if (frame.right) g.x += GHOST_SPEED * dt;
    g.x = Phaser.Math.Clamp(g.x, STAGE.LEFT + 60, STAGE.RIGHT - 60);

    const now = this.time.now;
    if ((frame.tapLight || frame.tapHeavy) && now >= g.readyAt) {
      g.readyAt = now + GHOST_COOLDOWN;
      this.items.dropAt(g.x);
      sound.play('surge');
      this.announce(`${h.fighter.cfg.name}의 공매도!`, '#a78bfa', 700);
    }
  }

  /** 이 사람의 유령 (없으면 죽은 자리에서 만든다) */
  private ghostOf(h: (typeof this.humans)[number]): {
    x: number;
    readyAt: number;
    mark?: Phaser.GameObjects.Container;
  } {
    const slot = h.slot ?? 0;
    let g = this.ghosts.get(slot);
    if (!g) {
      g = { x: h.fighter.x, readyAt: this.time.now + 1200 };
      this.ghosts.set(slot, g);
      this.announce(
        `${h.fighter.cfg.name} — 공매도 유령이 됐다  (← → 이동 · J 투하)`,
        '#a78bfa',
        2200,
      );
    }
    return g;
  }

  /** 유령 표시를 그리고 옮긴다 (모든 화면에서 돈다) */
  private drawGhosts(): void {
    for (const [slot, g] of this.ghosts) {
      /*
       * 주인은 humans 가 아니라 fighters 에서 찾는다.
       *
       * 참가자 화면의 humans 에는 **자기 것 하나뿐**이라, humans 로 찾으면
       * 남의 유령은 영영 안 그려진다. 사람은 자리 순서대로 먼저 만들어지므로
       * 자리 번호가 곧 fighters 의 번호다 — 이 순서는 모든 화면에서 같다.
       */
      const owner = this.fighters[slot];
      if (!owner) continue;

      if (!g.mark) {
        const accent = owner.cfg.colors.accent;
        const body = this.add.circle(0, 0, 17, accent, 0.55);
        const eye = this.add.circle(0, -3, 6, 0xffffff, 0.9);
        const tag = this.add
          .text(0, 24, `${slot + 1}P 유령`, {
            fontFamily: GAME.FONT,
            fontSize: '12px',
            color: '#e8eeff',
          })
          .setOrigin(0.5);
        g.mark = this.add.container(g.x, GHOST_Y, [body, eye, tag]).setDepth(DEPTH.OVERLAY - 1);

        // 둥둥 떠 있다 — 살아 있는 캐릭터와 한눈에 구별되어야 한다
        this.tweens.add({
          targets: g.mark,
          y: GHOST_Y + 10,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
      g.mark.x = g.x;
      // 다시 던질 수 있으면 또렷하게, 기다리는 중이면 흐리게
      g.mark.setAlpha(this.time.now >= g.readyAt ? 1 : 0.45);
    }
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

    kb.on('keydown-R', () => this.onRestartKey());
    kb.on('keydown-SPACE', () => this.startNextRound());
    kb.on('keydown-ESC', () => this.leaveToSelect());
    kb.on('keydown-P', () => this.togglePause());
    kb.on('keydown-F1', () => this.toggleControlHints());
    kb.on('keydown-M', () => {
      const muted = sound.toggleMute();
      this.muteLabel.setText(muted ? '🔇 M' : '🔊 M');
    });
  }

  /**
   * 이 자리는 몇 번 패드를 쓰는가 (없으면 키보드 전용).
   *
   * ── 규칙이 인원수에 따라 갈리는 이유 ───────────────────────────
   * 키보드는 두 사람까지다. 그래서 셋 이상이면 3·4번은 **패드가 곧 그 사람**
   * 이고, 첫 패드가 3번 것이 된다.
   *
   * 이때 1·2번에서 패드를 떼야 한다. 안 그러면 1번과 3번이 같은 첫 패드를
   * 함께 보게 되어, 패드 하나로 두 캐릭터가 똑같이 움직인다. 둘이서 할
   * 때(인원 ≤ 2)는 그 충돌이 없으므로 자리마다 패드를 그대로 붙여
   * "키보드든 패드든 아무 쪽이나"를 유지한다.
   */
  private padSeatIndex(seat: number, humanCount: number): number | undefined {
    const KEYBOARD_SEATS = 2;
    if (humanCount <= KEYBOARD_SEATS) return seat;
    if (seat < KEYBOARD_SEATS) return undefined;
    return seat - KEYBOARD_SEATS;
  }

  /** 지금 꽂혀 있는 패드들 (꽂힌 순서) */
  private livePads(): Phaser.Input.Gamepad.Gamepad[] {
    const pads = this.input.gamepad?.gamepads ?? [];
    return pads.filter((p) => p && p.connected);
  }

  /**
   * `padIndex`번째 패드의 이번 프레임 입력.
   *
   * 패드가 없으면 null — 키보드 프레임에 합치기만 하므로 없어도 그만이다.
   * (다만 패드 전용 자리는 그동안 아무 입력도 못 받는다. 판 도중에 뽑히면
   *  조용한 자리 회수기가 봇으로 바꿔 준다.)
   */
  private padFrame(padIndex: number): InputFrame | null {
    const pad = this.livePads()[padIndex];
    if (!pad) return null;
    while (this.padReaders.length <= padIndex) {
      this.padReaders.push(new PadReader());
    }
    return this.padReaders[padIndex]!.read(pad);
  }

  /** 사람이 조종하는 파이터 전부 — 각자 자기 입력원에서 한 프레임을 읽는다 */
  private handleAllInput(): void {
    for (const h of this.humans) {
      const myLocalIdx = h.remote ? -1 : (h.padIndex ?? -1);
      /*
       * 죽은 사람은 유령을 조종한다.
       *
       * humans 에서 빼지 않는 이유가 여기 있다 — 같은 입력이 살아 있을 때는
       * 캐릭터를, 죽은 뒤에는 유령을 움직인다. 회선 경로도 그대로 쓴다.
       */
      if (!h.fighter.alive) {
        this.updateGhost(h, myLocalIdx);
        continue;
      }
      /*
       * 입력을 "키보드를 읽는 일"과 "그 입력으로 무엇을 하는가"로 갈랐다.
       *
       * 온라인 대전에서 상대의 입력은 키보드가 아니라 회선으로 온다.
       * handleInput 이 키 객체를 직접 읽으면 그 경로가 통째로 막히므로,
       * 한 프레임분 입력을 값으로 만들어 넘긴다 — 키보드에서 오든
       * 회선에서 오든 이 아래는 같은 코드를 탄다.
       *
       * 이 기계의 사람이면 게임패드도 함께 읽어 합친다.
       */
      const frame = h.remote ? h.remote() : readKeyFrame(h.keys);
      if (myLocalIdx >= 0) {
        const pad = this.padFrame(myLocalIdx);
        if (pad) mergeFrames(frame, pad);
      }
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

    /*
     * 공격 방향 — 같은 버튼이라도 어디를 누르고 있느냐로 다른 기술이 나간다.
     *
     * 앞·뒤는 **바라보는 방향이 아니라 상대가 있는 쪽**을 기준으로 잡는다.
     * 바라보는 방향은 걸을 때마다 곧바로 따라 돌기 때문에, 그것을 기준으로
     * 삼으면 누르는 쪽이 언제나 "앞"이 되고 뒤 기술은 영영 안 나온다.
     *
     * 조작 반전 룰이 걸려 있으면 손이 누르는 것과 캐릭터가 가는 곳이 반대다.
     * 여기서도 그것을 먼저 풀어 두어야, 반전 중에 앞 기술을 내려다 뒤 기술이
     * 나오는 일이 없다.
     */
    const held: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;
    const heldWorld = (reversed ? -held : held) as -1 | 0 | 1;
    const toFoe = this.directionToNearestFoe(p);
    const dir: AttackDir = up
      ? 'up'
      : down
        ? 'down'
        : heldWorld === 0
          ? 'neutral'
          : heldWorld === toFoe
            ? 'forward'
            : 'back';

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
    /*
     * 회피 조합키는 지상·공중 모두 `S` 다.
     *
     * 공중에는 방어가 없지만 **회피는 있다.** 규칙을 "S를 누르고 방향이면
     * 회피"로 하나로 두면 외울 것이 안 늘어난다 — 땅에서는 구르기가,
     * 공중에서는 공중 회피가 나갈 뿐이다. dodge() 가 발이 땅에 있는지 보고
     * 알아서 갈라 준다.
     */
    const dodgeMod = down;
    let dodged = false;
    if (dodgeMod) {
      if (tapLeft) dodged = p.dodge(reversed ? 1 : -1);
      else if (tapRight) dodged = p.dodge(reversed ? -1 : 1);
      else if (tapJump) dodged = p.dodge(0);
    }

    /* A/D 더블탭 → 대시 (방어 중에는 구르기가 먼저다) */
    if (!dodgeMod) {
      if (tapLeft && this.checkDoubleTap(tap, -1)) p.dash(-1);
      if (tapRight && this.checkDoubleTap(tap, 1)) p.dash(1);
    }

    /* 조작 반전 룰이 걸려 있으면 좌우가 뒤집힌다 */
    p.moveHorizontal(heldWorld);

    // S를 누르고 있을 때의 점프는 회피다 — 지상이든 공중이든 여기서는 안 뛴다
    if (tapJump && !dodgeMod) p.jump();
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

    /*
     * 뒤 기술은 **상대를 보면서** 물러난다.
     *
     * 뒤로 걸으면 바라보는 방향이 따라 돌아 등을 보인 채로 치게 된다.
     * 그러면 판정이 상대 반대쪽에 생겨서 "분명히 눌렀는데 안 맞는다"가 된다.
     * 격투 게임에서 뒤로 걷는 동안 상대를 계속 보고 있는 것과 같은 이유다.
     */
    if ((tapLight || tapHeavy) && dir === 'back' && toFoe !== 0) {
      p.faceToward(toFoe);
    }
    if (tapLight) p.attack('light', dir);
    if (tapHeavy) p.attack('heavy', dir);
    // 누르고 있으면 선딜 구간에서 힘을 모은다 (차지 강공격)
    p.setHeavyHeld(heavyHeld);
    if (tapSkill) this.castSkill(p);
    if (tapTaunt) p.taunt();

    p.setGuard(wantGuard && !dodged && !p.isDodging());
    if (down && !onGround) p.fastFall();

    /*
     * 지금 누르고 있는 방향을 적어 둔다 — 맞는 순간 이것으로 궤도가 휜다(DI).
     *
     * 매 프레임 적는 이유는, 맞는 순간이 언제일지 모르기 때문이다. 피격은
     * 상대의 판정이 정하는 것이라 이쪽에서는 미리 알 수 없다.
     * 위/아래는 방어·급강하와 같은 키를 쓰지만, 여기서는 "어디로 벗어나려
     * 하는가"로만 읽는다 — 한 손가락이 두 가지 뜻을 갖는 것이 아니라
     * 누르고 있는 방향이 곧 벗어나려는 방향이라 자연스럽다.
     */
    p.setDodgeInfluence(heldWorld, up ? -1 : down ? 1 : 0);
  }

  /**
   * 가장 가까운 살아 있는 상대가 어느 쪽에 있는가 (-1 왼쪽 / 1 오른쪽).
   *
   * 앞·뒤 커맨드의 기준점이다. 넷이 붙는 판이라 "상대"가 하나로 정해지지
   * 않으므로 **제일 가까운 사람**을 본다 — 지금 실제로 싸우고 있는 상대가
   * 보통 제일 가깝고, 그 사람을 기준으로 앞뒤를 잡는 것이 손에 맞는다.
   *
   * 아무도 없으면 0 을 돌려준다. 그때는 어느 쪽을 눌러도 중립기가 나간다 —
   * 기준이 없는데 앞뒤를 억지로 정하면 같은 입력이 상황마다 다른 것을 낸다.
   */
  private directionToNearestFoe(me: BaseCharacter): -1 | 0 | 1 {
    let best: number | null = null;
    let bestGap = Infinity;
    for (const f of this.fighters) {
      if (f === me || !f.alive) continue;
      const gap = Math.abs(f.x - me.x);
      if (gap < bestGap) {
        bestGap = gap;
        best = f.x;
      }
    }
    if (best === null) return 0;
    // 거의 겹쳐 서 있으면 방향을 정할 수 없다 (한 픽셀 차이로 앞뒤가 뒤집힌다)
    if (Math.abs(best - me.x) < 8) return 0;
    return best > me.x ? 1 : -1;
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
   * 카메라 — 살아있는 파이터들의 중앙을 따라가고, 뭉치면 파고든다.
   *
   * ── 줌을 어떻게 넣었나 ─────────────────────────────────────────
   * 오래 줌 없이 스크롤만 했다. HUD 에 scrollFactor(0) 만 주면 됐기 때문이고,
   * 줌을 넣으면 그 HUD 까지 함께 확대돼 UI 전용 카메라가 필요해 보였다.
   *
   * 카메라를 하나 더 두는 대신 **HUD 를 거꾸로 줄인다.** scrollFactor 0 인
   * 것은 화면 좌표 p 를 (p - c)·z + c 자리에 그리므로(c = 화면 중앙),
   * 컨테이너를 1/z 로 줄이고 c - c/z 로 옮겨 두면 정확히 상쇄된다.
   * HUD 가 이미 컨테이너 하나(hudLayer)에 다 들어 있어서 두 줄로 끝난다.
   *
   * ── 왜 당기기만 하고 물러나지는 않는가 ─────────────────────────
   * 월드는 1920×720 이고 화면은 1280×720 이다. 세로가 **정확히 같아서**
   * 물러나는 순간 무대 위아래로 아무것도 없는 빈 공간이 드러난다.
   * 가로만 물러나게 하는 것도 안 된다 — 줌은 가로세로가 같이 간다.
   * 그래서 1.0 이 가장 넓은 상태이고, 뭉쳤을 때만 파고든다.
   *
   * 파고드는 정도는 **전원이 여유를 두고 화면에 들어오는 선까지**로만
   * 잡는다. 그래서 누가 밖으로 밀려나는 일이 구조적으로 없다.
   */
  private updateCamera(delta: number): void {
    const cam = this.cameras.main;

    /*
     * 결과 화면에서는 카메라를 원점에 묶는다.
     *
     * 결과 화면의 글자들은 월드 좌표로 그려지는데, 카메라는 마지막 순간까지
     * 생존자를 따라가 있다. 넓은 무대의 오른쪽 끝에서 판이 끝나면 카메라가
     * 거기 머물러 **전적표와 제목이 화면 왼쪽 밖으로 잘려 나간다.**
     * 판이 끝난 뒤의 카메라 위치는 아무 정보도 아니므로 원점으로 되돌린다.
     */
    if (this.resultShown) {
      this.baseZoom = 1;
      this.zoomPunch = 0;
      this.applyZoom();
      cam.setScroll(0, 0);
      return;
    }

    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const f of alive) {
      minX = Math.min(minX, f.x);
      maxX = Math.max(maxX, f.x);
      minY = Math.min(minY, f.y);
      maxY = Math.max(maxY, f.y);
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

    /*
     * 전원이 이만큼 여유를 두고 들어오는 선까지만 당긴다.
     *
     * 여유(CAMERA.MARGIN)는 캐릭터 반 몸에 날아갈 자리를 더한 값이다.
     * 이것을 좁게 잡으면 화면 가장자리에 딱 붙은 채로 싸우게 되고,
     * 한 대 맞아 밀리는 순간 곧바로 밖으로 나간다.
     */
    const needW = maxX - minX + CAMERA.MARGIN * 2;
    const needH = maxY - minY + CAMERA.MARGIN * 2;
    const fit = Math.min(GAME.WIDTH / needW, GAME.HEIGHT / needH);

    /*
     * 판이 멈춰 있는 동안(인트로·프롬프트 입력·일시정지)에는 1 로 돌아간다.
     * 그 화면들의 글자는 hudLayer 밖에 있어 줌을 되돌려 주는 손이 없다.
     */
    const still = !this.battleActive || this.prompting || this.paused;
    const wantZoom = still ? 1 : Phaser.Math.Clamp(fit, 1, CAMERA.MAX_ZOOM);

    /*
     * 줌은 스크롤보다 **느리게** 따라간다.
     *
     * 넷이 뒤엉킨 판에서는 사람 사이 거리가 매 순간 출렁이는데, 줌이 그걸
     * 그대로 따라가면 화면이 숨을 쉬듯 울렁거려 눈이 먼저 지친다.
     * 당기는 것보다 물러나는 것을 조금 더 빠르게 둔다 — 늦게 물러나면
     * 누군가 화면 밖에 잠깐 머물게 되고, 그 순간은 게임이 아니라 추측이 된다.
     */
    const zoomIn = wantZoom > this.baseZoom;
    const zt = 1 - Math.pow(zoomIn ? CAMERA.ZOOM_IN_EASE : CAMERA.ZOOM_OUT_EASE, delta / 1000);
    const zoom = Phaser.Math.Linear(this.baseZoom, wantZoom, zt);
    this.baseZoom = zoom;
    this.applyZoom();

    /*
     * 좌우 한계는 **보이는 폭**으로 잡는다.
     *
     * 줌이 걸리면 화면에 담기는 월드 폭이 1280 이 아니라 1280/줌 이다.
     * 예전 상수(WORLD_WIDTH - WIDTH)를 그대로 쓰면 당긴 만큼 무대 밖
     * 검은 여백이 양옆에 드러난다.
     */
    const halfView = GAME.WIDTH / 2 / zoom;
    const midX = Phaser.Math.Clamp(targetX, halfView, GAME.WORLD_WIDTH - halfView);
    const desired = midX - GAME.WIDTH / 2;

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

  /**
   * 지금의 줌(따라가는 줌 × 격추 펀치)을 걸고, HUD 를 그만큼 거꾸로 줄인다.
   *
   * scrollFactor 0 인 것은 화면 좌표 p 를 (p - c)·z + c 자리에 그린다
   * (c = 화면 중앙). 그러니 컨테이너를 1/z 로 줄이고 c - c/z 로 옮기면
   * 자식들이 정확히 원래 자리에 온다 — 카메라를 하나 더 두지 않아도 된다.
   *
   * 두 줌을 **곱해서** 한 군데서 거는 이유가 이 되돌리기다. 두 곳에서 따로
   * setZoom 을 부르면 나중에 부른 쪽이 앞엣것을 지우고, HUD 되돌리기는
   * 그중 한쪽 값만 보고 어긋난다.
   *
   * hudLayer 밖에 있는 화면 고정 글자(중앙 안내·격추 도장)는 일부러
   * 그냥 둔다. 둘 다 화면 한가운데 잠깐 떴다 사라지는 것이라, 당긴 판에서
   * 조금 크게 뜨는 편이 오히려 그 순간을 강조한다.
   */
  private applyZoom(): void {
    const zoom = this.baseZoom * (1 + CAMERA.KO_PUNCH * this.zoomPunch);
    const cam = this.cameras.main;
    if (Math.abs(cam.zoom - zoom) > 0.0005) cam.setZoom(zoom);

    if (!this.hudLayer) return;
    const inv = 1 / zoom;
    const cx = GAME.WIDTH / 2;
    const cy = GAME.HEIGHT / 2;
    this.hudLayer.setScale(inv);
    this.hudLayer.setPosition(cx - cx * inv, cy - cy * inv);
  }

  /** 스킬 시전 — 시전 시 부가 효과(도박 등)까지 처리한다 */
  private castSkill(fighter: BaseCharacter): boolean {
    if (!fighter.useSkill()) return false;
    this.combat.onSkillCast(fighter);
    return true;
  }

  /* ================================================================ */
  /* 격추 연출                                                        */
  /* ================================================================ */

  /**
   * 격추 순간.
   *
   * ── 왜 따로 공들이는가 ────────────────────────────────────────────
   * 한 판에서 가장 크게 웃는 순간이 여기다. 넷이 뒤엉켜 치고받다가 누군가
   * 하나가 날아가는 그 순간이 이 게임의 하이라이트인데, 지금까지는 글자
   * 한 줄과 짧은 흔들림이 전부라 그냥 지나갔다.
   *
   * 세 가지를 겹친다.
   *  1. **판을 잠깐 멈춘다** — 눈이 따라갈 시간을 준다. 안 멈추면 다음 싸움에
   *     묻혀서 누가 죽었는지도 모르고 지나간다.
   *  2. **누가 누구를 잡았는지 이름으로 말한다** — 넷이 붙는 판에서 제일
   *     궁금한 것이 그거다. "상장폐지!"만으로는 내 공이었는지 알 수 없다.
   *  3. **남은 인원을 알린다** — 판이 어디까지 왔는지가 곧 긴장이다.
   */
  /** 오른쪽 위에 쌓이는 격추 기록 */
  private killFeed: Phaser.GameObjects.Text[] = [];
  /** 상단 조작 안내 두 줄 — 몇 초 뒤 접힌다 (F1 로 다시 편다) */
  private controlHints: Phaser.GameObjects.Text[] = [];
  private hintsFolded = false;

  /** 조작 안내를 접는다 — 지우지 않고 아주 옅게 남긴다 */
  private fadeControlHints(): void {
    if (this.hintsFolded || !this.controlHints.length) return;
    this.hintsFolded = true;
    this.tweens.add({
      targets: this.controlHints.filter((h) => h.active),
      alpha: 0,
      y: '-=6',
      duration: 500,
      ease: 'Quad.easeIn',
    });
  }

  /** F1 — 조작 안내를 다시 편다 (한 번 더 누르면 접는다) */
  private toggleControlHints(): void {
    const live = this.controlHints.filter((h) => h.active);
    if (!live.length) return;
    const show = this.hintsFolded;
    this.hintsFolded = !show;
    this.tweens.killTweensOf(live);
    // 접을 때 위로 6px 올렸으므로 펼 때는 제자리로 되돌린다
    live.forEach((h, i) => {
      this.tweens.add({
        targets: h,
        alpha: show ? 1 : 0,
        y: show ? 16 + i * 18 : h.y - 6,
        duration: 220,
        ease: 'Quad.easeOut',
      });
    });
    // 다시 편 것은 잠시 뒤 알아서 접힌다 — 끄는 법을 또 외우게 하지 않는다
    if (show) this.time.delayedCall(6000, () => this.fadeControlHints());
  }

  /**
   * 킬 피드 — 누가 누구를 보냈는지가 화면 구석에 잠깐 남는다.
   *
   * 넷이 뒤엉킨 판에서는 가운데 배너를 놓치기 일쑤다. 놓친 사람도
   * "아까 누가 누굴 보냈지?"를 구석에서 확인할 수 있어야 판의 흐름을
   * 따라간다 — 난투 게임이 다들 이것을 두는 이유다.
   */
  private pushKillFeed(victim: BaseCharacter, killer: BaseCharacter | null): void {
    const text = killer
      ? `${killer.cfg.name}  ⚔  ${victim.cfg.name}`
      : `${victim.cfg.name}  💥  자멸`;
    const color = killer
      ? `#${killer.cfg.colors.accent.toString(16).padStart(6, '0')}`
      : '#ff8a8a';

    const line = this.add
      .text(GAME.WIDTH - 14, 36 + this.killFeed.length * 24, text, {
        fontFamily: GAME.FONT,
        fontSize: '14px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH.HUD + 1)
      .setScrollFactor(0)
      .setAlpha(0);
    line.setStroke('#0b1020', 4);

    this.killFeed.push(line);
    this.tweens.add({ targets: line, alpha: 1, x: '-=10', duration: 180 });
    this.time.delayedCall(4200, () => {
      this.tweens.add({
        targets: line,
        alpha: 0,
        duration: 400,
        onComplete: () => {
          line.destroy();
          const at = this.killFeed.indexOf(line);
          if (at >= 0) this.killFeed.splice(at, 1);
          // 남은 줄을 위로 당긴다
          this.killFeed.forEach((l, i) => (l.y = 36 + i * 24));
        },
      });
    });
  }

  private playKo(victim: BaseCharacter, killer: BaseCharacter | null): void {
    const left = this.fighters.filter((f) => f.alive).length;

    /* 1) 판을 잠깐 멈춘다 — 마지막 한 명이 남는 순간은 더 길게 */
    const last = left <= 1;
    this.combat.freeze(last ? 460 : 240);

    this.cameras.main.shake(last ? 520 : 340, last ? 0.03 : 0.02);
    this.cameras.main.flash(last ? 260 : 140, 255, 90, 90, true);
    sound.play(last ? 'finisher' : 'ko');

    /* 2) 누가 누구를 잡았는가 */
    const accent = killer
      ? `#${killer.cfg.colors.accent.toString(16).padStart(6, '0')}`
      : '#ff5a5a';
    const text =
      killer && killer !== victim
        ? `${killer.cfg.name} → ${victim.cfg.name} 상장폐지!`
        : `${victim.cfg.name} 자멸…`;
    this.announce(text, accent, 1500);

    /*
     * 격추 지점에서 이름이 솟아오른다.
     *
     * 가운데 배너만으로는 **어디서** 벌어진 일인지 안 보인다. 넷이 흩어져
     * 싸우는 판에서는 그 자리를 짚어 줘야 "저기서 터졌구나"가 된다.
     */
    /*
     * 카메라 펀치 — 상장폐지는 이 게임에서 가장 큰 사건이다.
     * 흔들림만으로는 잦은 타격과 구별이 안 된다. 한 호흡 줌이 들어갔다
     * 나오면 "방금 큰 일이 났다"가 몸으로 전달된다.
     */
    /*
     * 펀치는 **지금 줌 위에 얹는다** (1 에서 시작하지 않는다).
     *
     * 카메라는 인원이 뭉치면 이미 당겨져 있다. 펀치가 절대값으로 1.09 를
     * 써 버리면 당겨 있던 판에서는 오히려 **확 물러났다 돌아오는** 반대
     * 연출이 되고, 끝나면서 1 로 스냅해 다음 프레임에 원래 줌으로 튄다.
     * 배수로 얹고, 되돌리는 것은 세기(zoomPunch)를 0 으로 두는 것으로 한다.
     *
     * 트윈이 직접 applyZoom 을 부르는 이유는 히트스탑 때문이다 — 격추 순간엔
     * 판이 멈춰 있어 updateCamera 가 안 돈다. 그래도 펀치는 보여야 한다.
     */
    const cam = this.cameras.main;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 130,
      yoyo: true,
      hold: 90,
      ease: 'Quad.easeOut',
      onUpdate: (t) => {
        this.zoomPunch = this.resultShown ? 0 : (t.getValue() as number);
        this.applyZoom();
      },
      onComplete: () => {
        this.zoomPunch = 0;
        this.applyZoom();
      },
    });
    cam.shake(200, 0.012);

    this.pushKillFeed(victim, killer);

    const label = this.add
      .text(victim.x, victim.y - 40, killer ? `${killer.cfg.name} KO!` : 'KO!', {
        fontFamily: GAME.FONT,
        fontSize: '30px',
        color: accent,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.FLOATING);
    label.setStroke('#0b1020', 8);
    this.tweens.add({
      targets: label,
      y: label.y - 90,
      scale: { from: 0.4, to: 1.25 },
      alpha: { from: 1, to: 0 },
      duration: 1100,
      ease: 'Back.easeOut',
      onComplete: () => label.destroy(),
    });

    /* 3) 몇 명 남았는가 — 마지막 둘이 되는 순간이 가장 크게 읽혀야 한다 */
    if (left === 2) {
      this.time.delayedCall(700, () => {
        if (!this.battleActive) return;
        this.announce('마지막 둘!', '#facc15', 1100);
      });
    }
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

        /*
         * 격추자 찾기 — 참가자 화면에서는 이벤트에 killerId 가 없다.
         * (setExact 경유라 출처를 모른다) 회선으로 온 [피해자, 격추자]를
         * 먼저 봐야 모든 KO 가 "자멸…"로 표시되는 것을 막는다.
         */
        const victimAt = this.fighters.indexOf(victim);
        const remoteAt = this.remoteKillers.get(victimAt);
        this.remoteKillers.delete(victimAt);
        const killer = p.killerId
          ? this.findFighter(p.killerId)
          : remoteAt !== undefined && remoteAt >= 0
            ? (this.fighters[remoteAt] ?? null)
            : null;
        this.playKo(victim, killer);
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
      /*
       * 판이 시작된 시각을 여기서 찍는다.
       *
       * 전에는 이 값을 **조용한 자리 회수기**가 지나가며 찍었는데, 그 회수기는
       * 첫 줄에서 호스트가 아니면 곧바로 돌아선다(netRole !== 'host'). 그래서
       * 이 기계 안에서만 도는 판에서는 시각이 영영 0 으로 남고, 그 값을 함께
       * 쓰는 **서든데스가 한 번도 안 걸렸다** — 2분 30초가 지나도 아무 일이
       * 없었다. 판을 닫으라고 넣은 장치가 정작 로컬에서만 죽어 있었다.
       *
       * 판이 시작된 시각은 회선과 아무 상관이 없다. 시작하는 자리에서 찍는다.
       */
      this.battleActiveSince = this.time.now;
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

    /*
     * 온라인에서는 오브를 깬 사람이 누구인지부터 가린다.
     *
     * 호스트가 판을 계산하므로 오브도 호스트에서 깨지는데, 정작 깬 사람은
     * 다른 기계에 앉아 있을 수 있다. 그 사람에게 입력창을 띄우고 문장이
     * 돌아올 때까지 기다려야 한다 — 안 그러면 남이 깬 오브를 호스트가
     * 대신 입력하게 된다.
     */
    if (this.netRole === 'host') {
      const slot = this.humans.findIndex((h) => h.fighter === breaker);
      if (slot >= 0) {
        net.sendAsk(slot, breaker.cfg.name, breaker.cfg.colors.accent);
        text = await this.awaitPrompt(
          slot === 0,
          breaker.cfg.name,
          breaker.cfg.colors.accent,
          slot,
        );
      } else {
        text = Phaser.Utils.Array.GetRandom(AI_PROMPTS);
        breaker.say(text, breaker.cfg.colors.accent);
      }
      this.applyPrompt(text, breaker.cfg.name);
      this.prompting = false;
      return;
    }

    if (breaker.side === 'player') {
      /* 입력하는 동안 전투를 멈춘다 — 타이핑 중에 맞으면 억울하다 */
      this.physics.world.pause();
      if (this.input.keyboard) this.input.keyboard.enabled = false;

      /*
       * 누가 치는지 **자리로** 말한다.
       *
       * 한 화면 앞에 넷이 앉아 있으면 입력창이 뜨는 순간 제일 먼저 갈리는
       * 것이 "이거 누구 차례야?"다. 캐릭터 이름만 뜨면 방금 자기가 고른
       * 것을 기억 못 하는 사람이 손을 뻗고, 정작 깬 사람은 구경한다.
       * 자리 번호는 HUD·결과 화면과 같은 이름이라 바로 읽힌다.
       */
      const seat = seatIndex(breaker);
      const who =
        seat >= 0 && this.humans.length > 1
          ? `${seat + 1}P · ${breaker.cfg.name}`
          : breaker.cfg.name;

      const result = await openPromptOverlay(who, accent);
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
    this.applyPrompt(text, breaker.cfg.name);
    this.prompting = false;
  }

  /**
   * 문장을 읽어 판에 건다.
   *
   * 한 문장에 두 가지가 들어 있으면 둘 다 건다. "달에서 한방에 끝내자"는
   * 장소와 규칙을 동시에 말하고 있다. 하나만 골라 버리면 플레이어가 쓴 말의
   * 절반을 흘린 것이고, 그러면 다음부터는 짧게만 쓰게 된다 —
   * 길게 쓸 이유가 없어지므로.
   */
  private applyPrompt(text: string, who: string): void {
    const reading = readPrompt(text);
    const note =
      `AI 해석: ${reading.reason} · 확신 ${Math.round(reading.confidence * 100)}%`;

    this.gimmicks.activate(reading.primary, text, this.time.now, note);
    this.logPrompt(text, who, reading.primary);
    if (reading.secondary) {
      // 조금 늦춰 건다 — 같은 순간에 두 배너가 겹쳐 뜨면 둘 다 안 읽힌다
      this.time.delayedCall(650, () => {
        if (!this.battleActive) return;
        this.gimmicks.activate(reading.secondary!, text, this.time.now, '함께 읽은 것');
        this.stats.logPrompt({
          text,
          who,
          gimmick: reading.secondary!.name,
          icon: reading.secondary!.icon,
          color: reading.secondary!.color,
        });
      });
    }

    /* 참가자들에게도 같은 것을 걸어 화면을 맞춘다 */
    if (this.netRole === 'host') {
      const ids = [reading.primary.id];
      if (reading.secondary) ids.push(reading.secondary.id);
      net.sendGimmick(ids, text, who, note);
    }
  }

  /** 결과 화면에 남길 한 줄 (호스트·1인·참가자 모두 같은 자리로 모은다) */
  private logPrompt(text: string, who: string, spec: GimmickSpec): void {
    this.stats.logPrompt({
      text,
      who,
      gimmick: spec.name,
      icon: spec.icon,
      color: spec.color,
    });
  }

  /**
   * 문장이 들어올 때까지 판을 멈추고 기다린다.
   *
   * 내 차례면 입력창을 띄우고, 남의 차례면 누가 쓰는 중인지 알린다.
   * 넷이 붙는 판에서 한 사람만 멈추면 나머지는 그동안 계속 싸워서 불공평하다 —
   * 전원이 같이 멈춰 지켜본다.
   */
  private async awaitPrompt(
    mine: boolean,
    who: string,
    accent: number,
    slot = -1,
  ): Promise<string> {
    const hex = `#${accent.toString(16).padStart(6, '0')}`;
    this.prompting = true;
    this.physics.world.pause();

    if (!mine) {
      this.announce(`${who}가 명령을 입력 중…`, hex, 2400);
      this.waitingOnSlot = slot;
      const text = await new Promise<string>((resolve) => {
        this.remoteSaid = resolve;
        // 상대가 창을 닫거나 회선이 끊겨도 판이 영영 멈춰 있으면 안 된다
        this.time.delayedCall(15000, () => resolve(''));
      });
      this.remoteSaid = undefined;
      this.waitingOnSlot = -1;
      this.resumeAll();
      return text;
    }

    if (this.input.keyboard) this.input.keyboard.enabled = false;
    const result = await openPromptOverlay(who, hex);
    if (this.input.keyboard) this.input.keyboard.enabled = true;

    this.resumeAll();
    // 참가자면 호스트가 판에 걸어야 하므로 보내 준다
    if (this.netRole === 'guest') net.sendSaid(result.text);
    return result.text;
  }

  /** 멈춰 둔 판을 되돌린다 (입력이 끝났거나 회선이 끊겼거나) */
  private resumeAll(): void {
    this.prompting = false;
    if (this.scene.isActive()) this.physics.world.resume();
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
    this.resultShown = true;
    // 전적표를 한 번은 읽고 넘어가게 — 격추 순간의 연타가 그대로 새지 않는다
    this.resultReadyAt = this.time.now + RESULT_INPUT_DELAY_MS;
    this.cameras.main.setScroll(0, 0);

    /*
     * 킬 피드를 걷는다.
     *
     * 판 중에는 "누가 누구를 보냈는지"가 쓸모 있지만, 결과 화면에는 그
     * 내용이 전적표에 이미 다 있다. 옅게 남은 글자가 오른쪽 위에 겹쳐 있으면
     * 정보가 아니라 얼룩이다.
     */
    this.killFeed.forEach((l) => l.destroy());
    this.killFeed = [];
    this.netHealthText?.destroy();
    this.netHealthText = undefined;
    // 연타 카운터도 같은 이유로 걷는다 — 결과 위에 떠 있으면 얼룩이다
    this.combat.clearComboLabels();

    /*
     * 2인 대전에서는 "이겼다/졌다"가 성립하지 않는다.
     *
     * 사람이 둘이면 한 화면을 둘이 같이 본다. 한쪽 기준으로 "패배…"를
     * 크게 띄우면 이긴 사람은 자기가 진 줄 안다. 그래서 2인 대전에서는
     * 판정을 내리지 않고 **누가 이겼는지만** 말한다.
     */
    const versus = !!this.player2;
    /*
     * 사람이 이겼는가.
     *
     * 사람이 셋·넷일 수 있으므로 "나 아니면 2P"로 세면 안 된다 —
     * 3번 자리가 이겨도 사람이 이긴 것이다.
     */
    // winner 는 없을 수 있다 — 전원이 동시에 장외로 나가면 아무도 안 남는다
    const winnerSeat = winner ? seatIndex(winner) : -1;
    const humanWon =
      !!winner && winnerSeat >= 0 && !this.takenOver.has(winner.fighterId);
    const playerWon = versus ? humanWon : winner?.side === 'player';

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
    /*
     * 누가 이겼는지 자리 이름으로 말한다.
     *
     * 전에는 "나 아니면 2P, 그 밖은 전부 봇"이라 **온라인에서 3번 자리가
     * 이기면 "봇 승리…"** 라고 떴다. 자리 번호는 파이터 이름에 이미 있고
     * 모든 화면에서 같으므로 그것을 쓴다.
     */
    const humanWinner = !winner
      ? '무승부…'
      : humanWon
        ? `${winnerSeat + 1}P 승리!`
        : '봇 승리…';
    const titleText = versus ? humanWinner : playerWon ? '승리!' : '패배…';
    const titleColor = versus
      ? playerWon && winner
        ? seatColor(winner)
        : '#ef4444'
      : playerWon
        ? '#4ade80'
        : '#ef4444';

    const title = this.add
      .text(GAME.WIDTH / 2, 152, titleText, {
        fontFamily: GAME.FONT,
        fontSize: '76px',
        color: titleColor,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);
    title.setStroke('#0b1020', 10);
    // 쾅 하고 박힌다 — 3분을 치고받은 끝이 스르륵 떠서는 안 된다
    title.setScale(2.1).setAlpha(0);
    this.tweens.add({
      targets: title,
      scale: 1,
      alpha: 1,
      duration: 240,
      ease: 'Back.easeIn',
      onComplete: () => {
        this.cameras.main.shake(110, 0.006);
        /*
         * 이긴 판에만 축포. 승리 화면인데 축하 연출이 하나도 없었다 —
         * 스파크 텍스처가 이미 있으므로 방출기 하나면 된다.
         */
        if (playerWon && this.textures.exists('spark')) {
          const burst = this.add
            .particles(GAME.WIDTH / 2, 152, 'spark', {
              speed: { min: 140, max: 380 },
              angle: { min: 0, max: 360 },
              scale: { start: 0.9, end: 0 },
              lifespan: 750,
              tint: [0xffd54a, 0x4ade80, 0xffffff],
              emitting: false,
            })
            .setDepth(DEPTH.OVERLAY + 2)
            .setScrollFactor(0);
          burst.explode(46);
          this.time.delayedCall(900, () => burst.destroy());
        }
      },
    });

    /*
     * 이 줄은 **한 사람**의 이야기다 — 그래서 사람이 여럿이면 쓰지 않는다.
     *
     * 전에는 versus 에서도 이 줄이 떴는데, 내용이 1P 기준이라 2·3·4P 에게는
     * 남의 성적표였다. 심지어 versus 에서는 무조건 "최후의 1인"이라 첫판에
     * 죽은 사람 화면에도 그렇게 떴다. 여럿일 때 등수는 아래 표가 전원치를
     * 등수 순으로 보여주므로, 여기서 한 명만 골라 말할 이유가 없다.
     */
    const total = this.fighters.length;
    const rankText = versus
      ? ''
      : playerWon
        ? `${total}명 중 최후의 1인`
        : `${total}명 중 ${this.placementOf(this.player)}위`;

    this.add
      .text(
        GAME.WIDTH / 2,
        232,
        winner
          ? `${winner.cfg.name} 생존 · 주가 ${this.stock.get(winner.fighterId)}%${
              rankText ? `\n${rankText}` : ''
            }`
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
          288,
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

    /*
     * 안내는 **누르면 실제로 되는 것**만 적는다.
     *
     * 온라인에서 다음 판을 여는 것은 방장뿐이다. 참가자 화면에도 "R : 한 판 더"
     * 라고 적어 두면 눌러도 아무 일이 없고, 그건 고장으로 읽힌다.
     * 대신 무엇을 기다리는 중인지 알려 준다.
     */
    const keys = this.netRole
      ? this.netRole === 'host'
        ? 'R : 다 같이 한 판 더      ESC : 방 나가기'
        : '방장이 다음 판을 시작합니다…      ESC : 방 나가기'
      : versus
        ? 'R : 한 판 더      ESC : 캐릭터 선택'
        : playerWon
          ? 'SPACE : 다음 상대      R : 이 판 다시      ESC : 캐릭터 선택'
          : 'R : 다시하기      ESC : 캐릭터 선택';

    /*
     * 패드를 쥐고 있으면 패드 쪽도 적는다.
     *
     * 넷이 소파에 앉아 한 판을 끝내면 전원이 패드를 쥐고 있다. 그때 화면이
     * "R : 한 판 더" 만 말하면 누군가는 키보드까지 손을 뻗어야 하고,
     * 나머지 셋은 그 사람을 기다린다 — 제일 자주 하게 될 일이 제일 불편해진다.
     */
    const padKeys =
      this.livePads().length > 0
        ? this.netRole === 'guest'
          ? ''
          : `      (패드 : 스타트 · A 로도 · B 로 나가기)`
        : '';

    const keyLabel = this.add
      .text(GAME.WIDTH / 2, 690, keys + padKeys, {
        fontFamily: GAME.FONT,
        fontSize: '18px',
        color: playerWon ? '#e8eeff' : '#8fa6d8',
        fontStyle: playerWon ? 'bold' : 'normal',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);

    // 이겼을 때는 다음 상대 안내가 눈에 띄어야 한다 — 여기서 멈추면 안 되므로
    if (playerWon || this.netRole) {
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
  /**
   * 이 사람이 몇 등인가 (1등이 최고).
   *
   * 등수는 **오래 버틴 순서**다. koOrder 는 상장폐지된 차례대로 쌓이므로
   * 뒤집으면 그대로 등수가 된다 — 제일 먼저 죽은 사람이 꼴찌다.
   * 살아남은 사람은 1등이고, 전원이 죽은 판에서는 마지막에 죽은 사람이 1등이다.
   */
  private placementOf(f: BaseCharacter): number {
    if (f.alive) return 1;
    const i = this.koOrder.indexOf(f.fighterId);
    // 목록에 없으면(있을 수 없지만) 맨 뒤로 보낸다 — 순서가 뒤엉키는 것보다 낫다
    if (i < 0) return this.fighters.length;
    return this.fighters.length - i;
  }

  private buildScoreboard(): void {
    const top = this.stats.topDealer();

    const rowH = 42;
    /*
     * 표 머리글이 연승 배지(y 288, 26px)와 겹쳐 있었다.
     * 배지는 화면 가운데, KO 열도 거의 가운데라 글자가 그대로 포개졌다.
     * 표를 한 줄만큼 내려 사이를 띄운다.
     */
    const y0 = 350;
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

    /*
     * **등수 순으로** 세운다.
     *
     * 오래 준 피해 순으로 세웠는데, 넷이 붙는 판에서 그건 순위표가 아니라
     * 통계표다. 판이 끝나고 넷이 제일 먼저 찾는 것은 "내가 몇 등이야?"이고,
     * 그 답은 누가 오래 살아남았는가다 — 피해를 제일 많이 준 사람이 제일
     * 먼저 죽는 일은 흔하다.
     *
     * 준 피해는 여전히 표에 있고, 동점(같은 등수)일 때 순서를 가른다.
     */
    const ordered = [...this.fighters].sort((a, b) => {
      const d = this.placementOf(a) - this.placementOf(b);
      if (d !== 0) return d;
      return this.stats.get(b.fighterId).dealt - this.stats.get(a.fighterId).dealt;
    });

    ordered.forEach((f, i) => {
      const r = this.stats.get(f.fighterId);
      const fav = this.stats.favouriteMove(f.fighterId);
      const y = y0 + 12 + i * rowH;
      const isPlayer = f.side === 'player';
      const isTop = top?.id === f.fighterId && r.dealt > 0;
      /*
       * 줄이 하나씩 떨어져 내린다.
       * 표 전체가 한 프레임에 박히면 "결과 화면이 떴다"로 끝이고,
       * 한 줄씩 들어오면 순위를 위에서부터 읽게 된다 — 같은 정보가
       * 발표가 된다. 이 줄에서 만드는 것들을 모아 함께 트윈한다.
       */
      const rowFrom = this.children.list.length;

      /*
       * 내 줄만 배경을 깐다 — 넷 중 어느 줄이 나인지 한눈에 찾게.
       *
       * 화면 가운데 기준으로 깔았더니 이름 앞부분이 배경 밖으로 삐져나와
       * "빌"만 배경 없이 뜨고 "게이츠맨"부터 배경 위에 놓였다. 글자 하나가
       * 두 색으로 갈려 보인다. 배경은 **줄의 실제 내용**에 맞춘다.
       */
      if (isPlayer) {
        // 등수 칸까지 덮는다 — 배경이 이름에서만 시작하면 등수가 떠 보인다
        const bgX = left - 100;
        this.add
          .rectangle(bgX, y, left + colX[5]! + 210 - bgX, rowH - 6, f.cfg.colors.accent, 0.12)
          .setOrigin(0, 0.5)
          .setDepth(DEPTH.OVERLAY + 1);
      }

      /*
       * 등수를 이름 왼쪽에 크게 박는다.
       *
       * 표에 줄만 순서대로 놓여 있으면 "위에 있는 게 잘한 건가?"를 한 번
       * 생각해야 한다. 넷이 동시에 화면을 들여다보는 3초 안에는 그 한 번이
       * 안 일어난다 — 숫자로 적혀 있어야 바로 읽힌다.
       */
      const place = this.placementOf(f);
      this.add
        .text(left - 92, y, `${place}위`, {
          fontFamily: GAME.FONT,
          fontSize: place === 1 ? '22px' : '18px',
          color: PLACE_COLORS[place - 1] ?? '#6c86c4',
          fontStyle: place === 1 ? 'bold' : 'normal',
        })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.OVERLAY + 2);

      const nameColor = `#${f.cfg.colors.accent.toString(16).padStart(6, '0')}`;
      const nameLabel = this.add
        .text(left - 40, y, `${isTop ? '👑 ' : ''}${f.cfg.name}`, {
          fontFamily: GAME.FONT,
          fontSize: '18px',
          color: nameColor,
          fontStyle: isPlayer ? 'bold' : 'normal',
        })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.OVERLAY + 2);

      /*
       * 자리 이름(1P·2P…)을 이름 뒤에 작게 붙인다.
       *
       * 사람이 하나일 때는 "내 줄만 배경을 깐다"로 충분했다. 넷이 붙으면
       * 네 줄이 전부 사람 줄이라 그 표시가 아무것도 안 가리킨다 — 다 칠하면
       * 안 칠한 것과 같다. 넷이 동시에 화면을 들여다보며 각자 자기 줄을
       * 찾아야 하는데, 그때 기준이 되는 것은 캐릭터 이름이 아니라 **자리**다.
       * 자기가 고른 캐릭터 이름을 판이 끝난 뒤 기억 못 하는 일이 흔하다.
       */
      const seat = seatIndex(f);
      if (seat >= 0) {
        this.add
          .text(nameLabel.x + nameLabel.width + 8, y, `${seat + 1}P`, {
            fontFamily: GAME.FONT,
            fontSize: '13px',
            color: SEAT_COLORS[seat] ?? '#6c86c4',
            fontStyle: 'bold',
          })
          .setOrigin(0, 0.5)
          .setDepth(DEPTH.OVERLAY + 2);
      }

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

      // 이 줄의 표시물 전부 — 위에서 차례로 떨어져 내린다
      const rowParts = this.children.list.slice(rowFrom);
      rowParts.forEach((o) => {
        const go = o as unknown as { setAlpha?: (a: number) => void; y?: number };
        go.setAlpha?.(0);
        if (typeof go.y === 'number') go.y -= 14;
      });
      this.tweens.add({
        targets: rowParts,
        alpha: 1,
        y: '+=14',
        delay: 380 + i * 90,
        duration: 240,
        ease: 'Quad.easeOut',
      });
    });

    /* 이 판 전체를 한 줄로 — 어디서 싸웠고 내 최고 한 방은 무엇이었나 */
    const me = this.stats.get(this.player.fighterId);
    this.add
      .text(
        GAME.WIDTH / 2,
        y0 + 12 + ordered.length * rowH + 22,
        `${this.stage.name}` +
          (me.bestHitName ? ` · 내 최고 한 방 ${me.bestHitName} ${Math.round(me.bestHit)}` : ''),
        {
          fontFamily: GAME.FONT,
          fontSize: '15px',
          color: '#6c86c4',
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);

    this.buildPromptLog(y0 + 12 + ordered.length * rowH + 52);
  }

  /**
   * 이 판을 바꾼 문장들.
   *
   * ── 왜 여기에 두는가 ───────────────────────────────────────────
   * 전적표는 어느 대전 게임에나 있다. 이 게임에만 있는 것은 **사람이
   * 그 자리에서 지어낸 한 줄로 판이 통째로 뒤집혔다**는 사실이고,
   * 그것은 숫자로 남지 않는다. "프롬프트 3회"라고 적으면 아무 기억도
   * 만들어지지 않지만, `"중력 좀 꺼줘" → 무중력` 이라고 적으면 방금 다 같이
   * 떠올랐던 30초가 통째로 돌아온다.
   *
   * 그래서 전적표 아래가 아니라 전적표와 **같은 무게**로 그린다 — 문장은
   * 이 게임의 부록이 아니라 본편이다.
   */
  private buildPromptLog(y: number): void {
    const log = this.stats.prompts;

    if (log.length === 0) {
      this.add
        .text(GAME.WIDTH / 2, y + 6, '이번 판에는 아무도 명령을 내리지 않았다', {
          fontFamily: GAME.FONT,
          fontSize: '14px',
          color: '#54608a',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.OVERLAY + 1);
      return;
    }

    this.add
      .text(GAME.WIDTH / 2, y, '이 판을 바꾼 말', {
        fontFamily: GAME.FONT,
        fontSize: '14px',
        color: '#c084fc',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);

    /*
     * 마지막 세 줄만.
     *
     * 긴 판에서는 여덟 줄까지도 쌓이는데, 여기서부터 화면 아래 끝까지는
     * 세 줄이 한계다. 잘라야 한다면 **나중 것**을 남긴다 — 판을 끝낸
     * 문장이 대개 마지막 것이고, 그것이 사람들이 기억하는 장면이다.
     */
    const shown = log.slice(-3);
    const hidden = log.length - shown.length;

    shown.forEach((p, i) => {
      const ly = y + 24 + i * 21;
      const hex = `#${p.color.toString(16).padStart(6, '0')}`;

      /* 문장이 길면 잘라 준다 — 두 줄로 넘어가면 아래 안내와 겹친다 */
      const said = p.text.length > 22 ? `${p.text.slice(0, 21)}…` : p.text;

      const line = this.add
        .text(GAME.WIDTH / 2, ly, `${p.who}  “${said}”  →  ${p.icon} ${p.gimmick}`, {
          fontFamily: GAME.FONT,
          fontSize: '16px',
          color: hex,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.OVERLAY + 1)
        .setAlpha(0);

      // 한 줄씩 떠오르게 — 눈이 여기로 온다
      this.tweens.add({
        targets: line,
        alpha: 1,
        y: { from: ly + 8, to: ly },
        delay: 380 + i * 130,
        duration: 260,
      });
    });

    if (hidden > 0) {
      this.add
        .text(GAME.WIDTH / 2, y + 24 + shown.length * 21, `그리고 ${hidden}줄 더`, {
          fontFamily: GAME.FONT,
          fontSize: '13px',
          color: '#54608a',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.OVERLAY + 1);
    }
  }

  /**
   * R — 다시 한 판.
   *
   * ── 온라인에서는 혼자 눌러선 안 된다 ────────────────────────────
   * 전에는 누구든 R 을 누르면 **그 사람만** 새 판으로 갔다. 넷이 붙은 판에서
   * 한 사람이 누르면 그 화면만 새 판이 시작되고 나머지 셋은 결과 화면에
   * 남는다 — 방이 거기서 깨진다. 넷을 모으는 데 든 수고가 한 판으로 끝난다.
   *
   * 그래서 온라인에서는 **방장이 누르고 전원이 함께 간다.** 참가자의 R 은
   * 아무 일도 하지 않고, 대신 결과 화면이 "방장이 다음 판을 시작합니다"라고
   * 알려 준다 — 눌러도 안 되는 키를 안내에 적어 두면 고장으로 읽힌다.
   */
  private onRestartKey(): void {
    if (!this.netRole) {
      this.scene.start('Battle', this.battleData);
      return;
    }
    if (this.netRole !== 'host') return;
    this.startRematch();
  }

  /**
   * 방장이 여는 다음 판 — 같은 사람, 같은 캐릭터, 다른 무대.
   *
   * 무대를 바꾸는 이유는 연승 도전과 같다. 같은 자리에서 또 하면 두 번째
   * 판은 첫 판의 반복이 되고, 무대가 바뀌면 같은 캐릭터로도 다른 판이 된다.
   */
  private startRematch(): void {
    if (this.netRole !== 'host' || this.rematching) return;
    this.rematching = true;

    const humanIds = this.battleData.humanIds ?? [this.battleData.playerId];
    const bots = this.battleData.aiIds ?? [];
    const stage = pickStage(this.stage.id);
    const d = { chars: humanIds, bots, stageId: stage.id };

    /*
     * 알리고 곧바로 간다 — 기다리지 않는다.
     *
     * 처음에는 "참가자가 먼저 넘어가도록" 260ms 뒤에 넘어갔는데, 그 사이를
     * 씬 타이머에 맡긴 것이 문제였다. 판이 끝난 화면에서는 그 타이머가 늘
     * 도는 것이 아니어서, **가끔 아무 일도 일어나지 않고 결과 화면에 그대로
     * 남았다.** 알림은 이미 보냈으니 기다릴 이유도 없다.
     */
    try {
      net.sendAgain(d);
    } catch {
      /* 회선이 끊겼어도 내 판은 다시 연다 — 여기서 멈추면 아무것도 못 한다 */
    }

    this.scene.start('Battle', {
      ...this.battleData,
      humanIds,
      aiIds: bots,
      stageId: stage.id,
    } satisfies BattleSceneData);
  }

  /**
   * ESC — 방을 나간다.
   *
   * 온라인에서 그냥 선택 화면으로 넘어가면 회선은 열린 채 남는다. 남은
   * 사람들은 그 자리가 비었다는 것을 침묵으로만 알게 되고(4초), 방장이
   * 나간 경우에는 아무도 판을 계산하지 않는 방이 남는다. 나갈 때는 나간다고
   * 말하고 나간다.
   */
  private leaveToSelect(): void {
    if (this.netRole) net.close();
    this.scene.start('Select');
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

    /*
     * 긴 문장은 화면에 맞춰 줄인다.
     *
     * 58px 고정이라 "빌 게이츠맨 — 공매도 유령이 됐다 (← → 이동 · J 투하)"
     * 같은 긴 안내가 **양쪽으로 잘려 나갔다.** 가운데 토막만 보이니
     * 무슨 말인지도 모르고, 화면 밖으로 넘친 글자가 무대까지 가린다.
     * 긴 소식일수록 중요한 소식이라 자르는 대신 줄이는 쪽이 맞다.
     */
    const maxW = GAME.WIDTH - 80;
    const fit = label.width > maxW ? maxW / label.width : 1;
    label.setScale(fit);

    this.tweens.add({
      targets: label,
      scale: { from: fit * 1.7, to: fit },
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
  /**
   * 선두에게 왕관을 씌운다.
   *
   * ── 왜 필요한가 ──────────────────────────────────────────────────
   * 넷이 붙는 판에서 매 순간의 판단은 "누구를 때릴까"다. 그런데 주가는
   * 화면 아래 패널의 작은 숫자로만 보여서, 싸우는 동안에는 아무도 안 본다.
   * 그러면 그냥 눈앞에 있는 사람을 때리게 되고, 판이 난장판일 뿐 전략이 없다.
   *
   * 선두가 머리에 왕관을 쓰고 있으면 셋이 그쪽을 노린다. 그게 이 장르가
   * 재미있는 이유다 — 앞서면 표적이 되고, 표적이 되면 다시 뒤집힌다.
   * "1등을 때리자"가 말하지 않아도 자동으로 성립한다.
   */
  private updateLeader(): void {
    if (!this.battleActive) {
      this.crown?.setVisible(false);
      return;
    }

    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length < 2) {
      this.crown?.setVisible(false);
      return;
    }

    let best = alive[0]!;
    for (const f of alive) {
      if (this.stock.get(f.fighterId) > this.stock.get(best.fighterId)) best = f;
    }

    /*
     * 다 같이 100%로 시작하므로 처음에는 선두가 없다.
     * 아무나 왕관을 씌우면 시작하자마자 한 명이 억울하게 표적이 된다.
     */
    const top = this.stock.get(best.fighterId);
    const second = Math.max(
      ...alive.filter((f) => f !== best).map((f) => this.stock.get(f.fighterId)),
    );
    if (top <= second) {
      this.crown?.setVisible(false);
      this.leaderId = '';
      return;
    }

    if (!this.crown) this.crown = this.makeCrown();
    // 게이지(-34) 보다 더 위에 — 겹치면 둘 다 안 읽힌다
    this.crown.setPosition(best.x, best.y - FIGHTER.BODY_H / 2 - 58).setVisible(true);

    if (best.fighterId === this.leaderId) return;

    /*
     * 선두가 바뀌었다. 다만 엎치락뒤치락하는 구간에서는 배너가 도배되므로
     * 간격을 둔다 — 매번 외치면 아무도 안 읽게 된다.
     */
    const first = this.leaderId === '';
    this.leaderId = best.fighterId;
    const now = this.time.now;
    if (first || now - this.leaderAnnouncedAt < 4000) return;

    this.leaderAnnouncedAt = now;
    this.announce(
      `선두 교체 — ${best.cfg.name}!`,
      `#${best.cfg.colors.accent.toString(16).padStart(6, '0')}`,
      900,
    );
    this.crown.setScale(1.9);
    this.tweens.add({ targets: this.crown, scale: 1, duration: 280, ease: 'Back.easeOut' });
  }

  /**
   * 왕관을 도형으로 그린다.
   *
   * 이모지(👑)로 뒀더니 글꼴에 그 글자가 없는 환경에서는 아무것도 안 보였다.
   * 왕관은 "지금 누가 1등인가"를 알리는 유일한 표시라, 안 보이면 그 규칙이
   * 통째로 사라진다. 도형으로 그리면 어느 기계에서든 똑같이 나온다.
   */
  private makeCrown(): Phaser.GameObjects.Image {
    const KEY = 'crown-mark';
    const W = 38;
    const H = 30;

    if (!this.textures.exists(KEY)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      // 봉우리 셋 + 아래 띠 — 작게 줄여도 왕관으로 읽히는 최소한의 모양
      const pts = [
        { x: 2, y: H - 3 },
        { x: 2, y: 8 },
        { x: 10, y: 17 },
        { x: 19, y: 3 },
        { x: 28, y: 17 },
        { x: 36, y: 8 },
        { x: 36, y: H - 3 },
      ];
      // 어두운 배경에서 실루엣이 분리되도록 외곽선을 두껍게 깐다
      g.lineStyle(6, 0x0b1020, 1);
      g.strokePoints(pts, true, true);
      g.fillStyle(0xffd54a, 1);
      g.fillPoints(pts, true);
      g.generateTexture(KEY, W, H);
      g.destroy();
    }

    return this.add.image(0, 0, KEY).setOrigin(0.5).setDepth(DEPTH.FLOATING);
  }

  private buildOffscreenMarkers(
    ui: <T extends Phaser.GameObjects.GameObject>(obj: T) => T,
  ): void {
    this.offscreenMarks = this.humans.map((h) => {
      /*
       * HUD 패널·결과 화면과 같은 자리 색을 쓴다.
       *
       * 전에는 "내 것이면 1P 파랑, 아니면 전부 2P 분홍"이었다. 사람이 둘일
       * 때는 맞는 말이지만 넷이 붙으면 **3P·4P 화살표가 둘 다 "2P" 라고**
       * 뜬다. 화면 밖으로 밀려난 사람을 찾으라고 만든 표시가, 정작 셋이
       * 밀려난 순간 같은 이름 셋을 같은 색으로 내놓는다 — 없느니만 못하다.
       */
      const seat = seatIndex(h.fighter);
      const accent = seatTint(h.fighter);
      const label = seat >= 0 ? `${seat + 1}P` : '';

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

    /*
     * "화면 밖"은 줌에 따라 달라진다.
     *
     * 당긴 화면에 담기는 월드 폭은 1280 이 아니라 1280/줌 이다. 예전처럼
     * 1280 으로 재면 당길수록 실제보다 넓게 보고 있다고 착각해서, **정작
     * 밖으로 밀려난 사람에게 화살표가 안 뜬다** — 화살표가 필요한 바로
     * 그때만 사라지는 셈이다. 카메라가 실제로 보고 있는 범위로 잰다.
     */
    const cam = this.cameras.main;
    const halfView = GAME.WIDTH / 2 / cam.zoom;
    const left = cam.midPoint.x - halfView;
    const right = cam.midPoint.x + halfView;
    const MARGIN = 44;

    /*
     * 같은 쪽으로 나간 사람들을 **세로로 벌린다.**
     *
     * 세로 위치는 그 사람의 실제 높이를 따라간다 — 위아래 어디쯤인지도
     * 정보다. 그런데 넷이 붙는 판에서는 둘이 나란히 밀려나는 일이 흔하고,
     * 그러면 화살표 두 개가 같은 자리에 겹쳐 하나로 보인다. 뒤엣것은 통째로
     * 가려져서 자기 화살표를 찾던 사람은 "나는 표시가 안 뜨네" 가 된다.
     *
     * 한 번에 한 개씩 아래로 밀어내는 방식은 안 된다 — 아래 끝에 닿으면
     * 도로 같은 자리로 잘려 원점이다(실제로 그렇게 겹쳤다). 그 쪽으로 나간
     * 사람을 다 모아 놓고, 높이 순서는 지킨 채 **덩어리째** 화면 안에 앉힌다.
     */
    const MIN_GAP = 54;
    const TOP = 90;
    const BOTTOM = GAME.HEIGHT - 150;

    type Mark = BattleScene['offscreenMarks'][number];
    const sides: Record<'L' | 'R', Array<{ m: Mark; y: number }>> = { L: [], R: [] };

    for (const m of this.offscreenMarks) {
      const f = m.fighter;
      const out = !f.alive ? 0 : f.x < left + MARGIN ? -1 : f.x > right - MARGIN ? 1 : 0;
      if (!out) {
        m.arrow.setVisible(false);
        m.text.setVisible(false);
        continue;
      }
      sides[out < 0 ? 'L' : 'R'].push({ m, y: Phaser.Math.Clamp(f.y, TOP, BOTTOM) });
    }

    for (const key of ['L', 'R'] as const) {
      const list = sides[key].sort((a, b) => a.y - b.y);
      if (!list.length) continue;

      // 덩어리 전체 높이를 먼저 재고, 아래로 넘치면 위로 당겨 앉힌다
      const span = MIN_GAP * (list.length - 1);
      const first = Phaser.Math.Clamp(list[0]!.y, TOP, Math.max(TOP, BOTTOM - span));
      const x = key === 'L' ? 26 : GAME.WIDTH - 26;

      list.forEach((e, i) => {
        const y = first + i * MIN_GAP;
        e.m.arrow.setPosition(x, y).setAngle(key === 'L' ? 180 : 0).setVisible(true);
        e.m.text.setPosition(x, y - 26).setVisible(true);
      });
    }
  }

  /**
   * 사람이 잡은 캐릭터의 발밑에 자리 색 고리를 붙인다.
   *
   * HUD 를 세우는 자리에서 함께 한다 — 자리 색의 출처가 한 곳이어야
   * 화면마다 다른 색이 뜨는 일이 없다.
   */
  private markHumanSeats(): void {
    for (const h of this.humans) {
      const i = seatIndex(h.fighter);
      if (i < 0) continue;
      const hex = (SEAT_COLORS[i] ?? '#ffffff').replace('#', '');
      h.fighter.markSeat(Number.parseInt(hex, 16));
    }
  }

  private buildHud(): void {
    this.markHumanSeats();
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
    /*
     * 조작 안내는 **처음 몇 초만** 화면에 있는다.
     *
     * 두 줄이 상단을 상시 점유하고 있었다. 첫 판에는 꼭 필요한 정보지만,
     * 아는 사람에게는 그때부터 끝까지 무대와 캐릭터를 가리는 띠일 뿐이다 —
     * 실제로 화면 위 1/10 을 계속 먹고 있었다. 6초 뒤 옅게 접어 두고,
     * 필요하면 F1 로 다시 편다.
     */
    const hints: Phaser.GameObjects.Text[] = [];
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
      hints.push(label);
      return label;
    };

    /*
     * 이 기계의 사람이 셋 이상이면 3·4번은 패드다.
     *
     * 키보드 두 줄을 그대로 두고 패드 줄을 하나 더 붙인다 — 세 줄이 되면
     * 빽빽하지만, 패드 배치를 어디에도 안 적으면 패드를 쥔 사람은 아무
     * 버튼이나 눌러 보는 수밖에 없다. 판이 시작된 뒤에 알아내야 하는 조작은
     * 없는 조작과 같다.
     */
    const localHumans = this.humans.filter((h) => !h.remote).length;

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
        '1P   A/D 이동 · SPACE 점프 · S 방어 · J 약 · K 강 · L 스킬 · U 잡기 · AA/DD 대시      (F1 : 이 안내)',
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
        'A/D 이동 · SPACE(↑) 점프(2단, 짧게 누르면 낮게) · S 방어 · S+A/D 구르기 · S+SPACE 제자리 회피 · AA/DD 대시 · T 도발 · P 일시정지 · R 재시작 · F1 이 안내',
        '#8ea3cc',
      );
      hint(
        34,
        'J 약공격(JJJ 연속기) · K 강공격(KK, 꾹 누르면 차지) · L 스킬 · U 잡기(가드를 뚫는다)  ｜  잡은 뒤 J 툭툭 · K 던지기(W/S/뒤로 방향 지정) · 잡히면 아무 버튼 연타로 탈출',
        '#a8bce0',
      );
    }

    if (localHumans > 2) {
      const who = localHumans === 3 ? '3P' : '3P · 4P';
      hint(
        52,
        `${who} (패드)   스틱·십자키 이동 · A 점프 · X 약 · B 강 · Y 스킬 · LB/RB 잡기 · LT/RT 방어 · 스타트 일시정지`,
        SEAT_COLORS[2]!,
      );
    }

    this.controlHints = hints;
    this.time.delayedCall(6000, () => this.fadeControlHints());

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

      /*
       * 이 패널의 표시물을 전부 모아 둔다.
       * 상장폐지되면 패널 전체가 어두워져야 하는데, 전에는 숫자와 바만
       * 어두워지고 테두리·초상·이름이 멀쩡히 밝게 남아 누가 죽었는지
       * HUD 에서 안 읽혔다. 여기서부터 만들어지는 것이 전부 이 패널이므로,
       * 표시 목록의 앞뒤 차이가 곧 패널 구성물이다.
       */
      const panelFrom = this.children.list.length;

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
      const label = this.seatName(fighter);
      const labelColor = seatColor(fighter);

      const seatLabel = ui(
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
          /*
           * 등급 글자는 주가 숫자 **아래로 확실히 내린다.**
           * 22px 숫자가 y+5 에서 시작해 y+32 까지 내려오는데 여기가 y+30
           * 이라 두 글자가 맞닿아 있었다 — "166%떡상 1단계"로 읽힌다.
           */
          .text(x + HUD_PANEL_W - 12, y + 34, '보통', {
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

      /*
       * 잔상 바 — 주가 바와 같은 자리에 반투명 붉은 바를 깐다.
       * (실제 바보다 나중에 그려지면 가려지므로 깊이만 한 단 내린다)
       */
      const ghostBar = ui(
        this.add
          .rectangle(x + 58, y + 48, HUD_BAR_W / 3, 12, 0xef4444, 0.5)
          .setOrigin(0),
      );
      /*
       * 그리는 순서: 어두운 홈 → 잔상(붉음) → 실제 바.
       * 잔상은 실제 바보다 넓을 때만 붉은 꼬리로 비어져 나온다.
       * (같은 깊이는 만든 순서로 그려지므로 소수점으로 사이에 끼운다)
       */
      ghostBar.setDepth(bar.depth + 0.1);
      bar.setDepth(bar.depth + 0.2);

      this.huds.push({
        fighter,
        seatLabel,
        percent,
        tierLabel,
        bar,
        ghostBar,
        skillBar,
        skillLabel,
        itemIcon,
        sigLabel,
        prevValue: this.stock.get(fighter.fighterId),
        wasReady: true,
        stamped: false,
        parts: this.children.list.slice(panelFrom),
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

      /*
       * 잔상 바 — 오를 때는 즉시 따라가고, 깎일 때만 잠깐 남았다가 줄어든다.
       * 깎여 나간 폭이 붉은 꼬리로 잠깐 보여야 "방금 이만큼 잃었다"가 읽힌다.
       */
      if (value >= hud.prevValue) {
        this.tweens.killTweensOf(hud.ghostBar);
        hud.ghostBar.width = hud.bar.width;
      } else if (!this.tweens.isTweening(hud.ghostBar)) {
        this.tweens.add({
          targets: hud.ghostBar,
          width: hud.bar.width,
          delay: 140,
          duration: 300,
          ease: 'Quad.easeOut',
        });
      }

      /* 숫자가 튄다 — 깎인 프레임에만. 매 프레임 튀면 연타 때 안 읽힌다 */
      if (value < hud.prevValue) {
        this.tweens.killTweensOf(hud.percent);
        hud.percent.setScale(hud.prevValue - value >= 10 ? 1.45 : 1.25);
        this.tweens.add({
          targets: hud.percent,
          scale: 1,
          duration: 170,
          ease: 'Back.easeOut',
        });
      }
      hud.prevValue = value;

      // 쿨다운 바는 차오르는 방향으로 (1 = 준비 완료)
      const ready = 1 - hud.fighter.getSkillCooldownRatio();
      hud.skillBar.width = Math.max(0, HUD_BAR_W * ready);
      hud.skillLabel.setColor(ready >= 1 ? '#4ade80' : '#5d739f');

      /*
       * 준비 완료의 **순간**을 잡아 점멸한다.
       * 5px 바가 조용히 차오르는 것만으로는 전투 중에 아무도 못 본다 —
       * "지금 스킬 된다"는 순간이 가장 쓸모 있는 정보인데도.
       */
      const isReady = ready >= 1;
      if (isReady && !hud.wasReady && hud.fighter.alive) {
        this.tweens.add({
          targets: hud.skillBar,
          alpha: { from: 0.15, to: 1 },
          duration: 90,
          yoyo: true,
          repeat: 2,
        });
        hud.skillLabel.setScale(1.6);
        this.tweens.add({
          targets: hud.skillLabel,
          scale: 1,
          duration: 220,
          ease: 'Back.easeOut',
        });
      }
      hud.wasReady = isReady;

      // 장착 아이템 (참가자 화면은 호스트가 보낸 아이콘을 쓴다)
      hud.itemIcon.setText(
        hud.fighter.getItem()?.cfg.icon ?? hud.fighter.remoteItemIcon,
      );

      // 캐릭터 고유 자원
      hud.sigLabel.setText(this.describeSignature(hud.fighter));

      /*
       * 상장폐지 — 패널 전체가 죽고 도장이 박힌다.
       * 숫자만 어두워지던 때는 4인전에서 누가 죽었는지 HUD 로 안 읽혔다.
       * "상장폐지"는 이 게임 최고의 어휘인데 정작 도장 찍을 곳이 없었다.
       */
      if (!hud.fighter.alive && !hud.stamped) {
        hud.stamped = true;
        hud.parts.forEach((o) =>
          (o as unknown as { setAlpha?: (a: number) => void }).setAlpha?.(0.32),
        );
        /*
         * 도장은 패널 **아래쪽 절반**에 찍는다.
         *
         * 패널 가운데에 찍었더니 주가 숫자와 포개져 둘 다 안 읽혔다.
         * 이름·숫자는 위쪽에, 바와 자원은 아래쪽에 있으므로 아래에 겹치는
         * 편이 덜 가린다 — 어차피 죽은 사람의 게이지는 볼 일이 없다.
         */
        const cx = hud.percent.x - HUD_PANEL_W / 2 + 30;
        const stamp = this.add
          .text(cx, hud.percent.y + HUD_PANEL_H - 22, '상장폐지', {
            fontFamily: GAME.FONT,
            fontSize: '19px',
            color: '#ef4444',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setAngle(-11)
          .setDepth(DEPTH.HUD + 1)
          .setScrollFactor(0);
        stamp.setStroke('#0b1020', 6);
        stamp.setScale(2.2);
        this.hudLayer.add(stamp);
        this.tweens.add({
          targets: stamp,
          scale: 1,
          duration: 200,
          ease: 'Back.easeIn',
          onComplete: () => this.cameras.main.shake(90, 0.004),
        });
      }
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
    const next = this.player.alive ? this.player.getChainBranches() : null;

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

    /*
     * 갈래를 함께 보여준다.
     *
     * 마무리가 셋인데 화면에 하나만 적혀 있으면 나머지 둘은 없는 것과 같다.
     * "한 번 더"만 알려주던 때에도 3타가 있는 줄 모르는 사람이 있었다.
     */
    const label = `▶ 한 번 더!  ${next.straight}    ↑ ${next.up}  ·  ↓ ${next.down}`;
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

  /**
   * 패드로 판을 다룬다 — 키보드에 손을 뻗지 않고도.
   *
   * 일시정지를 **풀** 수도 있어야 하므로 paused 검사보다 먼저 돈다.
   *
   * ── 결과 화면에서 스타트가 하는 일 ─────────────────────────────
   * 처음에는 startNextRound() 만 불렀다. 그런데 그건 **혼자 이겼을 때만**
   * 열리는 길이라(canContinue), 사람 둘 이상이 붙은 판에서는 스타트가
   * 아무 일도 안 했다. 넷이 소파에 앉아 한 판을 끝내고 나면 다시 붙으려고
   * 전원이 패드를 쥐고 있는데, 그때 키보드까지 손을 뻗어야 R 을 누를 수
   * 있었다 — 넷이서 하는 게임에서 제일 자주 하게 될 동작이 제일 불편했다.
   *
   * 그래서 스타트는 "지금 가장 하고 싶은 것"을 한다. 연승 도전이 열려
   * 있으면 다음 상대, 아니면 이 판 다시. B 는 캐릭터 선택으로 나간다.
   */
  private pollPadMenu(): void {
    const taps = this.padMenu.poll(this.input.gamepad);

    if (this.resultShown) {
      /*
       * 전적표를 읽을 시간을 준다.
       *
       * 격추 순간에는 대개 전원이 버튼을 두드리고 있어서, 결과 화면이 뜨는
       * 즉시 받으면 그 연타가 그대로 다음 판을 열어 버린다. 누가 몇 등인지
       * 아무도 못 본 채로 넘어간다.
       */
      if (this.time.now < this.resultReadyAt) return;
      if (taps.ok) {
        if (this.canContinue) this.startNextRound();
        else this.onRestartKey();
      } else if (taps.back) {
        this.leaveToSelect();
      }
      return;
    }

    if (taps.start && !this.prompting) this.togglePause();
  }

  override update(time: number, delta: number): void {
    this.pollPadMenu();
    if (this.paused) return;

    // 프롬프트 입력 중에는 판이 멈춘다 (물리는 이미 pause 상태)
    if (this.prompting) {
      /*
       * 멈춘 판에서도 두 가지는 돈다.
       *
       * 참가자의 입력 전송 — 이것이 "사람이 아직 있다"는 신호다. 끊으면
       * 판이 멈춘 동안 전원이 침묵으로 보여 회수기가 아무도 못 가린다.
       * 호스트의 침묵 자리 회수 — 하필 문장을 입력하던 사람이 이탈 신호
       * 없이 사라지면(창 강제 종료·회선 단절) 이 회수기 말고는 아무도
       * 판을 되살릴 수 없다. 전원이 영원히 그 사람을 기다리게 된다.
       */
      if (this.netRole === 'guest') this.sendMyInput();
      if (this.netRole === 'host') this.reapQuietSeats(time);
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
    this.updateLeader();
    this.drawGhosts();

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
      /*
       * 기믹과 리듬 게이지는 참가자도 돌린다.
       *
       * 안 돌리면 정전 조명이 (0,0)에 얼어붙고 슬로우가 영원히 안 풀리고
       * 리듬 마커가 정지 화면이 된다 — 걸리는 것은 회선으로 오는데 **풀리는
       * 것은 시간이 풀어 주기 때문**이다. 수치 효과(주가 틱)는 30Hz 스냅샷의
       * setExact 가 곧바로 덮어쓰므로 두 번 세는 일은 없다.
       */
      this.gimmicks.update(time, scaled);
      this.rhythm.update(time);
      this.combat.updateRemoteLabels(time);
      this.updateNetHealth(time);
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

    this.reapQuietSeats(time);
    this.tickSuddenDeath(time);

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

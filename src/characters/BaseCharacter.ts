import Phaser from 'phaser';
import {
  CHAIN,
  DEPTH,
  FIGHTER,
  GAME,
  IMPACT,
  STAGE,
  STOCK,
  TIERS,
  resolveMoveSlot,
} from '../config/gameConfig';
import { sound } from '../systems/SoundSystem';
import type { ItemConfig, ItemMods } from '../config/items';
import { createFighterView } from './FighterView';
import type { FighterView } from './FighterView';
import { MOVE_POSE } from '../config/spriteSheets';
import type { Pose } from '../config/spriteSheets';
import { StockTier } from '../types';
import type {
  AttackConfig,
  AttackDir,
  AttackPhase,
  CharacterConfig,
  MoveSlot,
  Side,
} from '../types';

/** 히트박스가 놓이는 자리 — 판정과 이펙트가 같은 계산을 공유한다 */
interface HitArea {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** 머리 위 미니 게이지 규격 */
const GAUGE_W = 82;
const GAUGE_H = 14;

/**
 * 마지막으로 대사가 뜬 시각 (전 캐릭터 공용).
 *
 * 4인 난투에서는 각자 캐릭터별 쿨다운만 두면 네 명이 동시에 떠들어
 * 말풍선이 서로 겹쳐 읽을 수 없다. 전역으로 간격을 강제한다.
 */
let lastGlobalSayAt = 0;
/** 대사 사이 최소 간격 (ms) */
const GLOBAL_SAY_GAP = 700;

/** 씬을 다시 시작할 때 호출 — 모듈 전역 상태가 남아 대사가 막히는 것을 막는다 */
export function resetQuoteThrottle(): void {
  lastGlobalSayAt = 0;
}

/**
 * 모든 파이터의 기반 클래스.
 *
 * 캐릭터 고유 성능은 CharacterConfig(데이터)로 주입받으므로
 * 이 클래스 하나로 5종 캐릭터가 전부 구동된다.
 *
 * 책임 범위:
 *  - 이동 / 점프 / 공격 상태 머신
 *  - 피격 반응(넉백, 경직, 스쿼시, 플래시)
 *  - 시각 표현(대두 SD, 오라, 머리 위 게이지, 명대사)
 *
 * 주가 계산은 StockSystem이, 히트 판정은 CombatSystem이 담당한다.
 */
export class BaseCharacter extends Phaser.GameObjects.Container {
  declare body: Phaser.Physics.Arcade.Body;

  /** 전투 내 고유 식별자 (같은 캐릭터를 여럿 써도 구분되도록) */
  readonly fighterId: string;
  readonly cfg: CharacterConfig;
  readonly side: Side;

  /** 바라보는 방향 (1 = 오른쪽, -1 = 왼쪽) */
  facing: 1 | -1 = 1;
  /** 투사체 발사 요청 — BattleScene이 ProjectileSystem에 연결한다 */
  onSpawnProjectile?: (owner: BaseCharacter, atk: AttackConfig) => void;
  /** 생존 여부 */
  alive = true;

  /* --- 시각 요소 ------------------------------------------------- */
  /** 스쿼시&스트레치 대상. 게이지가 같이 찌그러지지 않도록 분리했다. */
  private readonly visual: Phaser.GameObjects.Container;
  private readonly aura: Phaser.GameObjects.Arc;
  /** 겉모습 — 스프라이트 시트 또는 도형 아트 */
  private readonly view: FighterView;
  private readonly shadow: Phaser.GameObjects.Ellipse;

  private readonly gauge: Phaser.GameObjects.Container;
  private readonly gaugeFill: Phaser.GameObjects.Rectangle;
  private readonly gaugeText: Phaser.GameObjects.Text;

  private flameEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;
  private auraTween?: Phaser.Tweens.Tween;

  /** 스쿼시 계수. facing 반전과 충돌하지 않도록 별도 보관한다. */
  private readonly squash = { x: 1, y: 1 };
  /** 방금 낸 기술 이름 — HUD가 읽어 간다 */
  private lastMove = '';
  private lastMoveAt = -99999;
  /**
   * 몸 크기 배율 (거대화 룰).
   *
   * 겉보기만 키우면 히트박스가 그대로라 "닿았는데 안 맞는다"가 된다.
   * 그림·판정·물리 바디를 한 값으로 함께 키운다.
   */
  private sizeScale = 1;

  /* --- 전투 상태 ------------------------------------------------- */
  private attackPhase: AttackPhase = 'none';
  private attackTimer = 0;
  private currentAttack: AttackConfig | null = null;
  /** 한 번의 공격 모션이 같은 대상을 여러 번 때리지 않도록 */
  private readonly hitTargets = new Set<string>();

  /* --- 연속기 --------------------------------------------------- */
  /**
   * 다음에 이어 칠 수 있는 타.
   * 한 타가 끝난 뒤 chainUntil 까지만 유효하다.
   */
  private chainNext: MoveSlot | null = null;
  private chainUntil = 0;
  /**
   * 선입력 버퍼에 쌓인 이어치기 입력 수.
   *
   * 판정이 도는 도중에 누른 다음 타를 기억했다가, 판정이 끝나는 순간 바로 잇는다.
   * 후딜이 풀리기를 기다렸다 눌러야 한다면 연타가 아니라 박자 맞추기가 된다.
   *
   * 한 칸이 아니라 여러 칸을 쌓는 이유: 손이 빠르면 3타분 입력이 1타 모션이
   * 끝나기도 전에 다 들어온다. 한 칸만 기억하면 나머지가 버려져
   * "빠르게 누를수록 연속기가 덜 나가는" 이상한 게임이 된다.
   */
  private chainBuffered = 0;
  /** 쌓아둘 수 있는 최대 선입력 (가장 긴 연속기가 3타라 2면 충분하다) */
  private static readonly CHAIN_BUFFER_MAX = 2;

  /** 이 시각까지 경직 (scene.time.now 기준) */
  private stunUntil = 0;
  /** 이 시각까지 무적 */
  private invulnUntil = 0;
  /** 스킬 사용 가능 시각 */
  private skillReadyAt = 0;

  // FIGHTER.MAX_JUMPS는 as const라 리터럴 타입(2)이므로 number로 명시한다
  /** 방어 중인가 (S 유지) */
  private guarding = false;
  /** 승리 포즈 고정 */
  private victorious = false;

  /** 장착 중인 아이템 (지속형만) */
  private item: { cfg: ItemConfig; until: number } | null = null;
  private itemAura?: Phaser.GameObjects.Arc;
  private itemIcon?: Phaser.GameObjects.Text;
  /** 낙하 공격(로켓 드롭) 진행 상태 */
  private diving: { atk: AttackConfig; phase: 'rising' | 'falling' } | null = null;
  /** 착지 충격파 발생 요청 — BattleScene이 연결한다 */
  onShockwave?: (owner: BaseCharacter, atk: AttackConfig) => void;

  /** 대시 포즈가 유지되는 시각 */
  private dashUntil = 0;
  /** 다음 대시가 가능한 시각 */
  private dashReadyAt = 0;

  private jumpsLeft: number = FIGHTER.MAX_JUMPS;
  private wasOnGround = true;
  /**
   * 지금 상승 중인 점프가 "버튼을 떼면 잘리는" 점프인가.
   *
   * 넉백으로 떠오르는 것과 스스로 뛴 것을 구별해야 한다 — 맞아서 뜬 것을
   * 버튼 떼기로 자를 수 있으면 콤보를 손쉽게 빠져나가게 된다.
   */
  private jumpRising = false;
  /** 착지 직전에 눌린 점프를 기억한다 (0 = 없음) */
  private jumpBufferedAt = 0;
  /**
   * 점프 버튼이 눌려 있는가.
   *
   * 기본값이 true 인 이유 — 봇은 이 값을 갱신하지 않는다. false 로 두면
   * 봇의 점프가 전부 즉시 잘려 아무도 발판에 못 올라간다.
   * "따로 알려주지 않으면 계속 누르고 있는 것으로 본다"가 안전한 쪽이다.
   */
  private jumpHeld = true;
  /**
   * 차지 강공격.
   *
   * ── 왜 이 방식인가 ────────────────────────────────────────────
   * "누르고 있다가 떼면 발동"으로 만들면 입력이 130ms 늦게 나간다.
   * 격투 게임에서 그 지연은 곧바로 "뻑뻑하다"로 느껴진다.
   *
   * 그래서 **누르는 즉시 모션은 시작하되, 선딜 구간에서 버튼을 계속
   * 누르고 있으면 그 자리에 멈춰 힘을 모은다.** 대난투의 스매시 어택과
   * 같은 방식이고, 입력 지연이 0이면서 "모으는 맛"이 생긴다.
   */
  private chargeMs = 0;
  /** 지금 강공격 버튼이 눌려 있는가 (씬이 매 프레임 알려준다) */
  private holdingHeavy = false;
  /** 차지 불티를 마지막으로 뿌린 시각 — 매 프레임 뿌리면 화면이 탄다 */
  private lastChargeSpark = 0;
  /** 방금 낸 기술의 실제 피해량 (차지가 반영된 값) */
  private lastMoveDamage = 0;
  /** 회피가 끝나는 시각 */
  private dodgeUntil = 0;
  /** 다음 회피가 가능한 시각 */
  private dodgeReadyAt = 0;
  /** 착지 포즈가 유지되는 시각 */
  private landUntil = 0;
  /** 아이템을 집어드는 포즈가 유지되는 시각 */
  private itemGetUntil = 0;
  /** 프롬프트 시전 포즈가 유지되는 시각 */
  private promptUntil = 0;
  /** 도발 포즈가 유지되는 시각 */
  private tauntUntil = 0;
  /** 방어가 깨져 기절한 시각까지 */
  private dizzyUntil = 0;

  /* --- 캐릭터 고유 메커니즘 --------------------------------------- */
  /**
   * 고유 자원 스택.
   * 게이츠=지분, 머스크=부스터, 페니와이즈=풍선. 의미는 다르지만
   * "쌓였다가 쓰인다"는 형태가 같아 한 칸으로 다룬다.
   */
  private sigStacks = 0;
  /** 후속 입력 창이 열려 있는 시각까지 (잡스 — 원 모어 씽) */
  private sigWindowUntil = 0;
  /** 훔친 기술 (리누스 — 포크) */
  private forked: AttackConfig | null = null;
  /** 다음 자원 자동 충전 시각 (머스크 — 부스터) */
  private sigRegenAt = 0;
  /** 착지 스쿼시 판정을 위한 최대 낙하속도 기록 */
  private fallSpeed = 0;
  private lastSayAt = 0;

  /* --- 능력치 배율 (StockSystem이 갱신) --------------------------- */
  private tier: StockTier = StockTier.NORMAL;
  private atkMul = 1;
  private speedMul = 1;
  private cooldownMul = 1;
  /** 패시브로 인한 추가 공격력 배율 */
  private passiveMul = 1;

  /** 재사용 히트박스 (매 프레임 할당 방지) */
  private readonly hitboxRect = new Phaser.Geom.Rectangle();

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    cfg: CharacterConfig,
    side: Side,
    fighterId: string,
  ) {
    super(scene, x, y);
    this.cfg = cfg;
    this.side = side;
    this.fighterId = fighterId;

    /* 그림자 — 지면에 투영되어 높이감을 만든다 */
    this.shadow = scene.add
      .ellipse(x, STAGE.GROUND_Y + 4, 62, 14, 0x000000, 0.32)
      .setDepth(DEPTH.STAGE + 1);

    /* 떡상 오라 — 가산 합성으로 어두운 배경 위에서 발광하게 한다 */
    this.aura = scene.add.circle(0, -4, 54, cfg.colors.accent, 0.3);
    this.aura.setBlendMode(Phaser.BlendModes.ADD);
    this.aura.setVisible(false);

    /* SD 대두 아트 — 머리/몸통/팔다리 + 캐릭터별 소품(머리·안경·수염·입) */
    this.view = createFighterView(scene, cfg);
    this.visual = scene.add.container(0, 0, [this.aura, ...this.view.parts]);

    /* 머리 위 미니 게이지 [===🔥 220%===] */
    const gaugeY = -FIGHTER.BODY_H / 2 - 34;
    const gaugeBg = scene.add
      .rectangle(0, 0, GAUGE_W, GAUGE_H, 0x0b1020, 0.75)
      .setStrokeStyle(2, 0x000000, 0.6);
    this.gaugeFill = scene.add
      .rectangle(
        -GAUGE_W / 2 + 2,
        0,
        GAUGE_W - 4,
        GAUGE_H - 4,
        TIERS[StockTier.NORMAL].color,
      )
      .setOrigin(0, 0.5);
    this.gaugeText = scene.add
      .text(0, 0, '100%', {
        fontFamily: GAME.FONT,
        fontSize: '11px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    // 게이지 채움 색이 밝아도 숫자가 읽히도록 외곽선을 준다
    this.gaugeText.setStroke('#0b1020', 3);

    this.gauge = scene.add.container(0, gaugeY, [
      gaugeBg,
      this.gaugeFill,
      this.gaugeText,
    ]);

    this.add([this.visual, this.gauge]);
    this.setDepth(DEPTH.FIGHTER);
    scene.add.existing(this);

    /* 물리 바디 — 컨테이너는 원점이 중앙이므로 오프셋을 직접 맞춘다 */
    scene.physics.add.existing(this);
    this.body.setSize(FIGHTER.BODY_W, FIGHTER.BODY_H);
    this.body.setOffset(-FIGHTER.BODY_W / 2, -FIGHTER.BODY_H / 2);
    this.body.setCollideWorldBounds(false);
    this.body.setDragX(1400);
    // 대시 속도가 잘리지 않도록 상한을 넉넉히 잡는다
    this.body.setMaxVelocity(1400, 1700);

    this.updateGauge(STOCK.START, StockTier.NORMAL);
  }

  /* ================================================================ */
  /* 조작 API — 플레이어 입력과 AI가 동일하게 호출한다                */
  /* ================================================================ */

  /** 행동 가능 상태인가 (경직/공격/방어 중이 아닌가) */
  canAct(): boolean {
    return (
      this.alive &&
      !this.guarding &&
      !this.isDodging() &&
      this.attackPhase === 'none' &&
      this.scene.time.now >= this.stunUntil
    );
  }

  /** 좌우 이동. dir: -1 왼쪽, 0 정지, 1 오른쪽 */
  moveHorizontal(dir: -1 | 0 | 1): void {
    if (!this.alive || this.scene.time.now < this.stunUntil) return;

    // 공격·방어 중에는 이동 불가 (관성만 유지)
    if (this.attackPhase !== 'none' || this.guarding) return;
    // 대시·회피 중에는 그 속도를 덮어쓰지 않는다
    if (this.scene.time.now < this.dashUntil) return;
    if (this.isDodging()) return;

    if (dir === 0) {
      this.body.setAccelerationX(0);
      return;
    }

    const onGround = this.body.blocked.down || this.body.touching.down;
    const speed = this.cfg.stats.speed * this.speedMul * (this.mods.speedMul ?? 1);
    this.body.setVelocityX(speed * dir * (onGround ? 1 : FIGHTER.AIR_CONTROL));
    this.setFacing(dir);
  }

  /**
   * 점프 (2단 점프 지원).
   *
   * 패니 와이즈맨은 쌓인 풍선 수만큼 더 뛴다 — 때려서 번 기동력을
   * 공중에서 쓰는 구조라, 맞는 순간 전부 사라진다.
   */
  jump(): void {
    if (!this.canAct()) {
      /*
       * 지금은 못 뛰지만(후딜·경직 중) 눌린 것은 기억해 둔다.
       * 사람은 착지하는 순간에 정확히 못 누른다 — 조금 일찍 누른 것을
       * 버리면 "점프가 씹혔다"가 되고, 그 감각이 조작을 뻑뻑하게 만든다.
       */
      if (this.alive) this.jumpBufferedAt = this.scene.time.now;
      return;
    }

    let balloonJump = false;
    if (this.jumpsLeft <= 0) {
      if (this.cfg.signature.id !== 'balloon' || this.sigStacks <= 0) {
        // 공중에서 다 쓴 뒤 누른 것도 기억한다 — 착지하자마자 뛴다
        this.jumpBufferedAt = this.scene.time.now;
        return;
      }
      this.sigStacks--;
      balloonJump = true;
      this.spawnBalloonPop();
    }

    const first = !balloonJump && this.jumpsLeft === FIGHTER.MAX_JUMPS;
    const power = first ? this.cfg.stats.jump : this.cfg.stats.doubleJump;
    this.body.setVelocityY(power);
    this.jumpRising = true;
    this.jumpBufferedAt = 0;
    if (!balloonJump) this.jumpsLeft--;

    // 도약 시 위로 늘어나는 스트레치
    this.pulseSquash(0.82, 1.22, 110);
    sound.play(first ? 'jump' : 'doubleJump');

    if (!first) this.spawnDoubleJumpRing();
  }

  /**
   * 점프 버튼을 뗐다.
   *
   * 아직 올라가는 중이면 상승을 잘라 낮은 점프로 만든다.
   * 같은 버튼에 "낮게 톡"과 "높게 크게" 두 선택지가 생긴다 —
   * 대난투류에서 낮은 점프 공중공격이 성립하는 이유가 이것이다.
   */
  releaseJump(): void {
    if (!this.jumpRising) return;
    this.jumpRising = false;
    if (this.body.velocity.y < 0) {
      this.body.setVelocityY(this.body.velocity.y * FIGHTER.SHORT_HOP_MUL);
    }
  }

  /**
   * 점프 버튼 상태를 매 프레임 알려준다.
   *
   * 뗀 "순간"만 잡으면 프레임이 드문 환경에서 누르고 떼는 것이 통째로
   * 프레임 사이에 들어가 이벤트가 사라진다. 상태를 계속 넘겨받아
   * 매 프레임 조금씩 눌러 내리는 쪽이 확실하고, 뚝 끊기지 않아 더 부드럽다.
   */
  setJumpHeld(held: boolean): void {
    this.jumpHeld = held;
  }

  /**
   * 회피 — 무적으로 빠져나간다.
   *
   * ── 왜 넣는가 ──────────────────────────────────────────────────
   * 지금까지 방어 수단은 가드 하나였다. 가드는 그 자리에 서서 버티는 것이라
   * **몰리면 답이 없다** — 셋에게 둘러싸이면 가드가 깨질 때까지 맞는 게 전부다.
   *
   * 회피가 생기면 "맞기 직전에 빠져나간다"는 선택지가 늘고, 공격하는 쪽도
   * 상대가 회피할 자리를 읽어야 한다. 공격/가드 둘뿐이던 판이 셋이 된다.
   *
   * @param dir 0이면 제자리 회피, ±1이면 그 방향으로 구른다
   */
  dodge(dir: -1 | 0 | 1): boolean {
    const now = this.scene.time.now;
    if (!this.alive || now < this.dodgeReadyAt) return false;
    // 경직 중에는 안 된다 — 맞고도 빠져나가면 연속기가 성립하지 않는다
    if (this.attackPhase !== 'none' || now < this.stunUntil) return false;

    const onGround = this.body.blocked.down || this.body.touching.down;
    if (!onGround) return false;

    this.guarding = false;
    this.dodgeUntil = now + FIGHTER.DODGE_MS;
    this.dodgeReadyAt = now + FIGHTER.DODGE_COOLDOWN;
    /*
     * 무적은 지속보다 짧다. 회피가 끝나기 전에 무적이 풀리므로,
     * 아무 때나 굴러도 되는 것이 아니라 **타이밍을 재야** 한다.
     */
    this.invulnUntil = Math.max(this.invulnUntil, now + FIGHTER.DODGE_INVULN_MS);

    if (dir === 0) {
      this.body.setVelocityX(this.body.velocity.x * 0.2);
      this.pulseSquash(1.25, 0.72, 160);
    } else {
      const speed = this.cfg.stats.speed * FIGHTER.DODGE_SPEED_MUL;
      this.body.setVelocityX(speed * dir);
      this.setFacing(dir);
      this.pulseSquash(1.18, 0.84, 200);
    }

    this.spawnDodgeTrail(dir);
    sound.play('whiff', 0.3);
    return true;
  }

  /** 회피 중인가 — 이동·공격을 막는 데 쓴다 */
  isDodging(): boolean {
    return this.scene.time.now < this.dodgeUntil;
  }

  /** 강공격 버튼 상태 — 차지 유지 판정에 쓴다 */
  setHeavyHeld(held: boolean): void {
    this.holdingHeavy = held;
  }

  /**
   * 지금 모으고 있는 정도 (0~1). HUD 게이지가 읽는다.
   * 모으는 것이 보이지 않으면 그냥 "가끔 세게 나가는 기술"이 된다.
   */
  getChargeRatio(): number {
    if (!this.chargeMs) return 0;
    return Math.min(1, this.chargeMs / FIGHTER.CHARGE_MAX_MS);
  }

  /** 급강하 (S) — 공중에서 빠르게 낙하 */
  fastFall(): void {
    if (!this.alive) return;
    const onGround = this.body.blocked.down || this.body.touching.down;
    if (!onGround && this.body.velocity.y > -50) {
      this.body.setVelocityY(Math.max(this.body.velocity.y, 300) + 40);
    }
  }

  /**
   * 방어 자세 유지 (지상에서만).
   * 방어 중에는 이동·공격이 막히는 대신 피해와 넉백이 크게 줄어든다.
   */
  setGuard(on: boolean): void {
    if (!this.alive) {
      this.guarding = false;
      return;
    }
    const onGround = this.body.blocked.down || this.body.touching.down;
    const free =
      this.attackPhase === 'none' && this.scene.time.now >= this.stunUntil;

    this.guarding = on && onGround && free;
    if (this.guarding) this.body.setVelocityX(0);
  }

  isGuarding(): boolean {
    return this.guarding;
  }

  /**
   * 몸 크기를 바꾼다 (1 = 기본).
   * 그림·히트박스·물리 바디가 함께 커진다.
   */
  setSizeScale(scale: number): void {
    /*
     * 이미 파괴된 파이터에게도 불릴 수 있다.
     *
     * 거대화 기믹이 도는 중에 R로 판을 새로 시작하면, GimmickSystem.reset()이
     * 되돌리기를 실행하는 시점에는 그때의 파이터들이 이미 없다.
     * (파괴된 GameObject 는 body 를 잃는다)
     */
    if (!this.body) return;

    this.sizeScale = scale;

    const w = FIGHTER.BODY_W * scale;
    const h = FIGHTER.BODY_H * scale;
    this.body.setSize(w, h);
    this.body.setOffset(-w / 2, -h / 2);

    this.pulseSquash(scale > 1 ? 0.8 : 1.2, scale > 1 ? 1.25 : 0.85, 260);
  }

  /**
   * 아이템을 집어드는 순간의 포즈.
   * 짧게만 보여주고, 이후에는 들고 있는 포즈(itemHold)로 넘어간다.
   */
  playItemGet(): void {
    this.itemGetUntil = this.scene.time.now + 320;
    this.pulseSquash(1.16, 0.86, 200);
  }

  /** 프롬프트 오브를 깨고 외치는 포즈 */
  playPromptCast(): void {
    this.promptUntil = this.scene.time.now + 1600;
    this.pulseSquash(0.82, 1.24, 300);
  }

  /** 도발 (T) — 성능은 없고 캐릭터성만 있는 동작 */
  taunt(): boolean {
    if (!this.canAct()) return false;
    const onGround = this.body.blocked.down || this.body.touching.down;
    if (!onGround) return false;

    this.tauntUntil = this.scene.time.now + 700;
    this.body.setVelocityX(0);
    this.pulseSquash(0.9, 1.14, 260);
    this.say(this.pickQuote('surge'), this.cfg.colors.accent);
    return true;
  }

  /**
   * 방어가 깨진다.
   *
   * 방어로 버티기만 하는 플레이를 막는 장치다. 기절 중에는 아무것도 못 하고,
   * 그림도 눈이 도는 전용 포즈로 바뀌어 "지금 무방비"라는 걸 상대도 안다.
   */
  breakGuard(): void {
    if (!this.alive) return;

    this.guarding = false;
    this.dizzyUntil = this.scene.time.now + 1100;
    this.stunUntil = this.dizzyUntil;
    this.body.setVelocityX(0);
    this.pulseSquash(1.3, 0.74, 320);
    sound.play('gambleLose');
  }

  /** 기절 중인가 */
  isDizzy(): boolean {
    return this.scene.time.now < this.dizzyUntil;
  }

  /* ================================================================ */
  /* 캐릭터 고유 메커니즘                                             */
  /* ================================================================ */

  /**
   * 최근 windowMs 안에 낸 기술 이름 (없으면 null).
   * HUD가 매 프레임 물어보므로 여기서 시간까지 판단해 준다.
   */
  getRecentMoveName(windowMs = 900): string | null {
    return this.scene.time.now - this.lastMoveAt <= windowMs ? this.lastMove : null;
  }

  /** 방금 낸 기술의 실제 피해량 — 차지가 반영된 값 (검사·HUD용) */
  getRecentMoveDamage(): number {
    return this.lastMoveDamage;
  }

  /** HUD가 읽어가는 현재 자원량 */
  getSignatureStacks(): number {
    return this.sigStacks;
  }

  /** 후속 입력 창이 열려 있는가 (잡스) */
  isSignatureWindowOpen(): boolean {
    return this.scene.time.now < this.sigWindowUntil;
  }

  /** 훔쳐둔 기술 이름 (리누스 HUD용) */
  getForkedName(): string | null {
    return this.forked?.name ?? null;
  }

  /**
   * 타격에 성공했다 — CombatSystem이 호출한다.
   * 때리는 행위로 자원이 쌓이는 캐릭터가 여기서 이득을 본다.
   */
  onDealtHit(): void {
    const sig = this.cfg.signature;
    if (sig.id === 'shares' || sig.id === 'balloon') {
      this.sigStacks = Math.min(sig.max, this.sigStacks + 1);
    }
  }

  /** 스킬이 적중했다 — 잡스의 후속 입력 창이 여기서 열린다 */
  onSkillLanded(): void {
    if (this.cfg.signature.id !== 'oneMoreThing') return;
    this.sigWindowUntil = this.scene.time.now + 1600;
    this.say('One more thing!', this.cfg.colors.accent);
  }

  /**
   * 방어로 막아냈다 — 리누스가 그 기술을 훔친다.
   * 스킬·투사체는 훔치지 않는다 (되돌려줄 때 연출이 꼬인다).
   */
  onGuarded(atk: AttackConfig): void {
    if (this.cfg.signature.id !== 'fork') return;
    if (atk.type === 'skill' || atk.projectile) return;

    this.forked = atk;
    this.sigStacks = 1;
    this.say(`포크: ${atk.name}`, this.cfg.colors.accent);
  }

  /** 전투 승리 — 승리 포즈로 고정한다 */
  showVictory(): void {
    if (!this.alive) return;
    this.victorious = true;
    this.guarding = false;
    this.body.setVelocityX(0);
    this.pulseSquash(0.85, 1.2, 260);
  }

  /**
   * 대시 — 짧게 치고 나간다.
   *
   * 기본은 지상 전용이다. 머스크맨만 부스터를 태워 공중에서도 대시하며,
   * 그게 이 캐릭터가 유일하게 가진 복귀·이탈 수단이 된다.
   */
  dash(dir: -1 | 1): boolean {
    if (!this.canAct()) return false;

    const now = this.scene.time.now;
    if (now < this.dashReadyAt) return false;

    const onGround = this.body.blocked.down || this.body.touching.down;
    const booster = this.cfg.signature.id === 'booster';

    if (!onGround) {
      // 공중 대시는 부스터를 가진 캐릭터가 자원을 쓸 때만
      if (!booster || this.sigStacks <= 0) return false;
    }
    if (booster) {
      if (this.sigStacks <= 0) return false;
      this.sigStacks--;
    }

    this.dashReadyAt = now + FIGHTER.DASH_COOLDOWN;
    this.dashUntil = now + FIGHTER.DASH_MS;
    this.setFacing(dir);
    this.body.setVelocityX(
      this.cfg.stats.speed * this.speedMul * FIGHTER.DASH_SPEED_MUL * dir,
    );
    this.pulseSquash(1.28, 0.84, 150);
    sound.play('doubleJump');
    return true;
  }

  /** 지금 이 입력이 어떤 기술로 나가는가 (AI가 딜레이를 계산할 때도 쓴다) */
  resolveMove(intent: 'light' | 'heavy', dir: AttackDir): AttackConfig {
    const onGround = this.body.blocked.down || this.body.touching.down;
    const dashing = this.scene.time.now < this.dashUntil;

    // 직전 타의 여운이 남아 있으면 1타가 아니라 다음 타로 이어진다
    if (
      this.chainNext &&
      this.scene.time.now < this.chainUntil &&
      dir === 'neutral' &&
      onGround &&
      this.cfg.moves[this.chainNext].type === intent
    ) {
      return this.cfg.moves[this.chainNext];
    }

    return this.cfg.moves[resolveMoveSlot(intent, dir, onGround, dashing)];
  }

  /**
   * 약공격(J) / 강공격(K).
   *
   * 방향키(W/S)와 지상·공중 여부에 따라 서로 다른 기술이 나간다.
   * 같은 버튼이라도 상황마다 다른 그림·다른 판정이 나오게 하는 것이
   * 이 게임 전투의 핵심이다.
   */
  attack(intent: 'light' | 'heavy', dir: AttackDir = 'neutral'): boolean {
    if (!this.alive) return false;
    if (this.scene.time.now < this.stunUntil) return false;

    /*
     * 공격 도중 같은 버튼을 다시 눌렀다면 연속기 선입력이다.
     * 실제 발동은 판정이 끝나는 순간(후딜 진입)에 일어난다 —
     * 여기서 바로 잇게 하면 지금 나가던 타의 판정이 잘려나간다.
     */
    if (this.attackPhase !== 'none') {
      if (!this.canChainFrom(this.currentAttack, intent, dir)) return false;
      this.chainBuffered = Math.min(
        BaseCharacter.CHAIN_BUFFER_MAX,
        this.chainBuffered + 1,
      );
      return true;
    }

    // 방어는 공격으로 캔슬할 수 있다 (S를 누른 채 하단기를 내기 위해)
    this.guarding = false;

    this.beginAttack(this.resolveMove(intent, dir));
    return true;
  }

  /**
   * 지금 이 입력이 연속기로 이어질 수 있는가.
   *
   * 방향키를 섞으면(W+J 등) 연속기가 아니라 별개의 커맨드 기술이므로 끊는다.
   * 공중에서도 끊는다 — 지상 연속기를 공중에서 이어가면 계속 떠 있게 된다.
   */
  private canChainFrom(
    from: AttackConfig | null,
    intent: 'light' | 'heavy',
    dir: AttackDir,
  ): boolean {
    if (!from?.chain || dir !== 'neutral') return false;
    if (from.type !== intent) return false;
    return this.body.blocked.down || this.body.touching.down;
  }

  /**
   * 지금 이어 칠 수 있는 다음 타의 이름 (없으면 null).
   *
   * 연속기는 화면에 알려주지 않으면 존재 자체를 모른 채 끝난다.
   * HUD가 이 값을 띄워 "지금 한 번 더" 를 눈으로 보여준다.
   */
  getChainNextName(): string | null {
    const slot =
      this.currentAttack?.chain ??
      (this.scene.time.now < this.chainUntil ? this.chainNext : null);
    return slot ? this.cfg.moves[slot].name : null;
  }

  /**
   * 시그니처 스킬(L).
   *
   * 캐릭터 고유 메커니즘이 가장 크게 갈리는 지점이다.
   *  - 게이츠: 쌓인 지분을 태워 위력이 오른다
   *  - 잡스: 방금 맞혔다면 쿨다운 없이 한 번 더
   *  - 리누스: 훔쳐둔 기술이 있으면 스킬 대신 그것이 나간다
   */
  useSkill(): boolean {
    if (!this.canAct()) return false;

    const sig = this.cfg.signature;
    const now = this.scene.time.now;

    /* 잡스 — 후속 입력 창이 열려 있으면 쿨다운을 무시한다 */
    const freeCast =
      sig.id === 'oneMoreThing' && now < this.sigWindowUntil;

    if (!freeCast && !this.isSkillReady()) return false;

    /* 리누스 — 훔쳐둔 기술이 있으면 그것을 되돌려준다 */
    if (sig.id === 'fork' && this.forked) {
      const stolen: AttackConfig = {
        ...this.forked,
        name: `포크: ${this.forked.name}`,
        // 남의 기술이라 원본보다 약간 세다 — 막아낸 보상이 있어야 노릴 이유가 생긴다
        damage: this.forked.damage * 1.3,
        hitstop: this.forked.hitstop + 30,
      };
      this.forked = null;
      this.sigStacks = 0;

      this.skillReadyAt = now + 3000;
      this.beginAttack(stolen);
      this.say(stolen.name, this.cfg.colors.accent);
      return true;
    }

    let skill = this.cfg.moves.skill;

    /* 게이츠 — 지분을 태워 위력과 경직을 늘린다 */
    if (sig.id === 'shares' && this.sigStacks > 0) {
      const n = this.sigStacks;
      skill = {
        ...skill,
        name: `${skill.name} (지분 ${n})`,
        damage: skill.damage * (1 + n * 0.3),
        effectDuration: (skill.effectDuration ?? 0) + n * 220,
        hitstop: skill.hitstop + n * 14,
        shake: skill.shake * (1 + n * 0.15),
      };
      this.sigStacks = 0;
    }

    if (freeCast) {
      // 창을 소모한다 — 한 번뿐이라야 "지금이다"가 성립한다
      this.sigWindowUntil = 0;
    } else {
      const cooldown =
        (skill.cooldown ?? 10000) * this.cooldownMul * (this.mods.cooldownMul ?? 1);
      this.skillReadyAt = now + cooldown;
    }

    this.beginAttack(skill);
    this.say(this.pickQuote('skill'), this.cfg.colors.accent);
    return true;
  }

  /** 스킬 사용 가능 여부 */
  isSkillReady(): boolean {
    return this.scene.time.now >= this.skillReadyAt;
  }

  /** 남은 스킬 쿨다운 비율 (0 = 사용 가능, 1 = 방금 씀) */
  getSkillCooldownRatio(): number {
    const cooldown =
      (this.cfg.moves.skill.cooldown ?? 10000) *
      this.cooldownMul *
      (this.mods.cooldownMul ?? 1);
    const remain = this.skillReadyAt - this.scene.time.now;
    return Phaser.Math.Clamp(remain / cooldown, 0, 1);
  }

  /* ================================================================ */
  /* 공격 상태 머신                                                   */
  /* ================================================================ */

  private beginAttack(atk: AttackConfig): void {
    this.currentAttack = atk;
    this.attackPhase = 'startup';
    this.attackTimer = atk.startup;
    this.hitTargets.clear();
    this.body.setAccelerationX(0);

    /*
     * 방금 낸 기술을 적어 둔다.
     *
     * 커맨드가 열넷인데 화면에는 이름이 안 나오니, 플레이어는 자기가 무엇을
     * 냈는지 모른 채 버튼만 누르게 된다. 눌러서 뭐가 나왔는지 보여야
     * "이 캐릭터엔 기술이 많다"가 전달된다.
     */
    this.lastMove = atk.name;
    this.lastMoveDamage = atk.damage;
    this.lastMoveAt = this.scene.time.now;

    // 새 모션이 시작되면 이전 타의 여운은 무효가 된다
    // (선입력은 호출부가 남은 개수를 되돌려 놓는다)
    this.chainBuffered = 0;
    this.chainNext = null;
    this.chargeMs = 0;

    /* 선딜 예비동작 — 어느 방향으로 내는 기술인지 몸이 먼저 알려준다 */
    switch (atk.hitAnchor ?? 'front') {
      case 'up':
        // 무릎을 굽혔다가 위로 뻗는다
        this.pulseSquash(1.2, 0.82, atk.startup);
        break;
      case 'down':
        this.pulseSquash(1.16, 0.86, atk.startup);
        break;
      case 'around':
        this.pulseSquash(0.9, 1.14, atk.startup);
        break;
      default:
        this.pulseSquash(1.12, 0.9, atk.startup);
    }

    /* 상승기 — 시전과 동시에 자신이 솟구친다 */
    if (atk.selfLaunch) {
      this.body.setVelocityY(atk.selfLaunch);
      this.jumpsLeft = 0;
      sound.play('jump');
    }

    /*
     * 낙하 공격.
     *  - selfLaunch가 함께 있으면 솟구쳤다 정점에서 하강 (로켓 드롭)
     *  - 없으면 그 자리에서 즉시 내리꽂는다 (공중 급강하)
     */
    if (atk.divePlunge) {
      if (atk.selfLaunch) {
        this.diving = { atk, phase: 'rising' };
      } else {
        this.diving = { atk, phase: 'falling' };
        this.body.setVelocityY(atk.divePlunge.speed);
      }
    }

    /* 기술 고유 대사 — 캐릭터성을 가장 싸게 전달하는 수단 */
    if (atk.cry) this.say(atk.cry, this.cfg.colors.accent);
  }

  /**
   * 이 기술의 판정이 놓이는 자리.
   *
   * 상단기는 머리 위, 하단기는 발밑, 광역기는 몸 주변 전체에 놓인다.
   * 히트박스와 이펙트가 어긋나면 "왜 안 맞았는지" 알 수 없으므로
   * 두 곳 모두 이 계산 하나만 쓴다.
   */
  private computeHitArea(atk: AttackConfig): HitArea {
    const w = atk.range * this.sizeScale;
    const h = atk.hitHeight * this.sizeScale;
    // 몸 기준 좌표도 함께 커져야 판정이 그림 위에 얹힌다
    const halfW = (FIGHTER.BODY_W / 2) * this.sizeScale;
    const halfH = (FIGHTER.BODY_H / 2) * this.sizeScale;

    switch (atk.hitAnchor ?? 'front') {
      case 'up':
        /*
         * 상자 아래쪽이 상대의 상체에 걸치도록 내려 잡는다.
         * 머리 위로만 띄우면 대공 전용이 되어, 눈앞에 서 있는 상대를
         * 띄울 수 없다 — 콤보 시작기라는 역할이 사라진다.
         */
        return {
          cx: this.x + this.facing * (w * 0.28),
          cy: this.y - halfH - h / 2 + 34 * this.sizeScale,
          w,
          h,
        };
      case 'down':
        return {
          cx: this.x + this.facing * (halfW + w / 2),
          cy: this.y + halfH - h / 2 + 4 * this.sizeScale,
          w,
          h,
        };
      case 'around':
        // range가 전방 사거리가 아니라 좌우를 합친 전체 폭이 된다
        return { cx: this.x, cy: this.y + halfH - h / 2, w, h };
      default:
        return {
          cx: this.x + this.facing * (halfW + w / 2),
          cy: this.y - 6 * this.sizeScale,
          w,
          h,
        };
    }
  }

  /** 현재 활성 히트박스 (투사체 공격이거나 비활성이면 null) */
  getHitbox(): Phaser.Geom.Rectangle | null {
    if (this.attackPhase !== 'active' || !this.currentAttack) return null;
    const a = this.currentAttack;
    // 투사체 공격은 근접 판정이 없다 — 판정은 ProjectileSystem이 맡는다
    if (a.projectile) return null;

    const { cx, cy, w, h } = this.computeHitArea(a);
    this.hitboxRect.setTo(cx - w / 2, cy - h / 2, w, h);
    return this.hitboxRect;
  }

  /** 현재 공격 데이터 */
  getCurrentAttack(): AttackConfig | null {
    return this.currentAttack;
  }

  /** 이 공격 모션에서 해당 대상을 이미 때렸는가 */
  hasHit(targetId: string): boolean {
    return this.hitTargets.has(targetId);
  }

  /** 히트 기록 */
  markHit(targetId: string): void {
    this.hitTargets.add(targetId);
  }

  /** 공격 중(선딜 포함)인가 — AI 회피 판단에 쓰인다 */
  isAttacking(): boolean {
    return this.attackPhase === 'startup' || this.attackPhase === 'active';
  }

  /* ================================================================ */
  /* 피격 처리                                                        */
  /* ================================================================ */

  /** 무적 상태인가 */
  isInvulnerable(): boolean {
    return this.scene.time.now < this.invulnUntil;
  }

  /**
   * 물리적 피격 반응 (주가 계산은 StockSystem이 별도로 수행).
   * @param atk 맞은 공격 데이터
   * @param fromX 공격자의 X좌표 — 넉백 방향 계산용
   */
  receiveHit(atk: AttackConfig, fromX: number): void {
    if (!this.alive) return;

    const now = this.scene.time.now;
    const dir = this.x >= fromX ? 1 : -1;
    const guarded = this.guarding;

    // 무게가 무거울수록, 방어 중이면 더욱 덜 밀린다
    const kbScale =
      (1 / this.cfg.stats.weight) *
      (guarded ? FIGHTER.GUARD_KNOCKBACK_MUL : 1);

    this.body.setVelocity(
      atk.knockbackX * dir * kbScale,
      atk.knockbackY * kbScale,
    );

    const base =
      atk.effect === 'stun' ? (atk.effectDuration ?? atk.hitstun) : atk.hitstun;
    const stun = guarded ? base * 0.4 : base;
    this.stunUntil = now + stun;
    this.invulnUntil = now + FIGHTER.INVULN_MS;

    // 공격 모션 강제 취소 — 낙하 공격도 함께 끊어야 그대로 처박히지 않는다
    this.attackPhase = 'none';
    this.currentAttack = null;
    this.diving = null;
    this.jumpsLeft = 0;
    // 맞으면 연속기는 끊긴다. 이어치기가 공짜가 되지 않게 하는 안전장치다
    this.chainNext = null;
    this.chainBuffered = 0;
    // 연출 포즈도 끊는다 — 맞는 중에 도발 자세로 서 있으면 안 된다
    this.tauntUntil = 0;
    this.promptUntil = 0;

    /*
     * 풍선은 맞으면 전부 터진다.
     * 때려서 번 기동력을 잃는 것이 이 캐릭터가 감수하는 위험이다.
     */
    if (this.cfg.signature.id === 'balloon' && this.sigStacks > 0) {
      this.sigStacks = 0;
      this.spawnBalloonPop();
    }
    // 후속 입력 창도 닫힌다 — 맞고도 공짜 스킬이 남으면 너무 관대하다
    this.sigWindowUntil = 0;

    this.flash();
    this.pulseSquash(IMPACT.SQUASH_X, IMPACT.SQUASH_Y, IMPACT.SQUASH_MS);

    // 맞으면 공격자 쪽을 바라본다
    this.setFacing(dir === 1 ? -1 : 1);
  }

  /** 히트 플래시 — 1프레임 흰색 점멸 */
  flash(): void {
    this.view.flash();
  }

  /** 스쿼시 & 스트레치 */
  pulseSquash(sx: number, sy: number, duration: number): void {
    this.scene.tweens.killTweensOf(this.squash);
    this.squash.x = sx;
    this.squash.y = sy;
    this.scene.tweens.add({
      targets: this.squash,
      x: 1,
      y: 1,
      duration,
      ease: 'Back.easeOut',
    });
  }

  /** 상장폐지 (KO) */
  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.attackPhase = 'none';
    this.currentAttack = null;
    this.diving = null;
    this.chainNext = null;
    this.chainBuffered = 0;
    this.body.setVelocity(0, 0);
    this.body.setAllowGravity(false);
    this.body.enable = false;

    this.setFlame(0);
    this.aura.setVisible(false);
    this.auraTween?.stop();
    this.gauge.setVisible(false);
    this.shadow.setVisible(false);
    sound.play('ko');

    // 회색으로 식으며 위로 사라진다
    this.view.setPose('lose');
    this.view.setDefeated();

    this.scene.tweens.add({
      targets: this,
      y: this.y - 90,
      alpha: 0,
      angle: Phaser.Math.Between(-40, 40),
      duration: 700,
      ease: 'Cubic.easeIn',
    });
  }

  /* ================================================================ */
  /* 주가 연동 (StockSystem이 호출)                                   */
  /* ================================================================ */

  /** 머리 위 게이지 갱신 */
  updateGauge(value: number, tier: StockTier): void {
    const effect = TIERS[tier];
    const ratio = Phaser.Math.Clamp(value / STOCK.MAX, 0, 1);

    this.gaugeFill.width = Math.max(1, (GAUGE_W - 4) * ratio);
    this.gaugeFill.setFillStyle(effect.color);

    const flameIcon = effect.flame > 0 ? '🔥 ' : '';
    this.gaugeText.setText(`${flameIcon}${Math.round(value)}%`);
  }

  /** 떡상 등급 적용 — 능력치 배율과 오라/불꽃 연출을 갱신한다 */
  applyTier(tier: StockTier): void {
    const effect = TIERS[tier];
    this.tier = tier;
    this.atkMul = effect.atkMul;
    this.speedMul = effect.speedMul;
    this.cooldownMul = effect.cooldownMul;

    /* 오라 */
    this.auraTween?.stop();
    this.auraTween = undefined;

    if (effect.aura) {
      this.aura.setVisible(true);
      this.aura.setFillStyle(effect.color, 0.3);
      this.aura.setScale(1);
      this.auraTween = this.scene.tweens.add({
        targets: this.aura,
        scale: 1.18,
        alpha: { from: 0.55, to: 0.25 },
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.aura.setVisible(false);
    }

    /* 위기 등급이면 붉게 깜빡인다 */
    this.scene.tweens.killTweensOf(this.visual);
    if (tier === StockTier.CRISIS) {
      this.visual.setAlpha(1);
      this.scene.tweens.add({
        targets: this.visual,
        alpha: 0.45,
        duration: 260,
        yoyo: true,
        repeat: -1,
      });
    } else {
      this.visual.setAlpha(1);
    }

    this.setFlame(effect.flame);
  }

  /** 패시브(변동성 폭발 / 오픈소스)로 인한 공격력 배율 */
  setPassiveMultiplier(mul: number): void {
    this.passiveMul = mul;
  }

  /** 최종 공격력 배율 = 떡상 등급 × 패시브 × 아이템 */
  getDamageMultiplier(): number {
    return this.atkMul * this.passiveMul * (this.mods.atkMul ?? 1);
  }

  /* ================================================================ */
  /* 아이템                                                           */
  /* ================================================================ */

  /** 현재 적용 중인 아이템 효과 (없으면 빈 객체) */
  private get mods(): ItemMods {
    return this.item?.cfg.mods ?? {};
  }

  /** 지속형 아이템 장착. 같은 슬롯이라 기존 아이템은 교체된다 */
  equipItem(cfg: ItemConfig, until: number): void {
    if (!this.alive) return;
    this.clearItemVisual();

    this.item = { cfg, until };

    /* 아이템 오라 — 떡상 오라와 색이 겹치지 않게 링 형태로 그린다 */
    const aura = this.scene.add.circle(0, -4, 46);
    aura.setStrokeStyle(4, cfg.color, 0.9);
    aura.isFilled = false;
    aura.setBlendMode(Phaser.BlendModes.ADD);
    this.visual.addAt(aura, 0);
    this.itemAura = aura;

    this.scene.tweens.add({
      targets: aura,
      scale: 1.25,
      alpha: { from: 1, to: 0.35 },
      duration: 620,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    /* 머리 위 아이콘 */
    const icon = this.scene.add
      .text(0, -22, cfg.icon, { fontSize: '20px' })
      .setOrigin(0.5);
    this.gauge.add(icon);
    this.itemIcon = icon;

    this.pulseSquash(0.86, 1.18, 220);
  }

  /** 받는 피해 배율 (서킷브레이커 등) */
  getDamageTakenMultiplier(): number {
    return this.mods.damageTakenMul ?? 1;
  }

  /** 흡수 배율 가산 (레버리지 등) */
  getAbsorbBonus(): number {
    return this.mods.absorbBonus ?? 0;
  }

  /** 현재 아이템 (HUD 표시용) */
  getItem(): { cfg: ItemConfig; until: number } | null {
    return this.item;
  }

  private clearItemVisual(): void {
    if (this.itemAura) {
      this.scene.tweens.killTweensOf(this.itemAura);
      this.itemAura.destroy();
      this.itemAura = undefined;
    }
    this.itemIcon?.destroy();
    this.itemIcon = undefined;
  }

  /** 만료된 아이템을 떼어낸다 */
  private tickItem(time: number): void {
    if (!this.item) return;
    if (time < this.item.until) return;

    this.item = null;
    this.clearItemVisual();
  }

  getTier(): StockTier {
    return this.tier;
  }

  /* ================================================================ */
  /* 명대사                                                           */
  /* ================================================================ */

  /** 상황별 명대사 중 하나를 무작위로 고른다 */
  pickQuote(mood: keyof CharacterConfig['quotes']): string {
    const lines = this.cfg.quotes[mood];
    return lines[Phaser.Math.Between(0, lines.length - 1)] ?? '';
  }

  /** 머리 위 말풍선. 짧은 간격의 연속 호출은 무시된다. */
  say(text: string, color = 0xffffff): void {
    if (!text || !this.alive) return;

    const now = this.scene.time.now;
    if (now - this.lastSayAt < 900) return;
    // 다른 캐릭터가 방금 말했으면 양보한다
    if (now - lastGlobalSayAt < GLOBAL_SAY_GAP) return;

    this.lastSayAt = now;
    lastGlobalSayAt = now;

    const hex = `#${color.toString(16).padStart(6, '0')}`;
    const bubble = this.scene.add
      .text(this.x, this.y - 96, text, {
        fontFamily: GAME.FONT,
        fontSize: '16px',
        color: hex,
        backgroundColor: 'rgba(11,16,32,0.85)',
        padding: { x: 10, y: 6 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.DIALOGUE);
    bubble.setShadow(0, 0, '#000000', 6, true, true);

    this.scene.tweens.add({
      targets: bubble,
      y: bubble.y - 26,
      alpha: { from: 0, to: 1 },
      duration: 180,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: bubble,
          alpha: 0,
          y: bubble.y - 14,
          delay: 900,
          duration: 260,
          onComplete: () => bubble.destroy(),
        });
      },
    });
  }

  /* ================================================================ */
  /* 매 프레임 갱신                                                   */
  /* ================================================================ */

  override update(time: number, delta: number): void {
    if (!this.alive) return;

    this.tickItem(time);
    this.tickSignature(time);

    /* 공격 상태 머신 진행 */
    if (this.attackPhase !== 'none' && this.currentAttack) {
      /*
       * 선딜 구간에서 버튼을 계속 누르고 있으면 그 자리에 멈춰 모은다.
       * 타이머를 줄이지 않는 것만으로 "차지"가 된다 — 별도 상태가 필요 없다.
       */
      if (
        this.attackPhase === 'startup' &&
        this.holdingHeavy &&
        this.isChargeable(this.currentAttack) &&
        this.chargeMs < FIGHTER.CHARGE_MAX_MS
      ) {
        this.chargeMs += delta;
        this.tickChargeFx(time);
      } else {
        this.attackTimer -= delta;
      }
      if (this.attackTimer <= 0) {
        const atk = this.currentAttack;
        switch (this.attackPhase) {
          case 'startup': {
            /*
             * 모은 만큼 강해진 사본으로 갈아 끼운다.
             * 원본을 건드리면 그 캐릭터의 기술이 영구히 세지므로,
             * 이 한 번의 공격에만 쓰는 복사본을 만든다.
             */
            const charged = this.applyCharge(atk);
            this.currentAttack = charged;
            /*
             * 화면에 뜨는 이름·수치도 모은 뒤의 것으로 갈아 끼운다.
             * beginAttack 시점에는 얼마나 모을지 알 수 없어 원본이 적혀 있고,
             * 그대로 두면 "풀차지로 때렸는데 HUD엔 기본값"이 된다.
             */
            this.lastMove = charged.name;
            this.lastMoveDamage = charged.damage;
            this.lastMoveAt = time;
            this.attackPhase = 'active';
            this.attackTimer = charged.active;
            this.spawnSwing(charged);
            if (this.chargeMs >= FIGHTER.CHARGE_MIN_MS) this.spawnChargeBurst();
            this.chargeMs = 0;
            break;
          }
          case 'active':
            /*
             * 판정이 끝나는 순간이 연속기가 이어지는 지점이다.
             * 선입력이 있으면 후딜을 통째로 건너뛰고 다음 타로 넘어간다 —
             * 이 캔슬이 있어야 툭툭 끊기지 않고 몰아치는 리듬이 나온다.
             */
            if (this.chainBuffered > 0 && atk.chain) {
              // beginAttack이 버퍼를 비우므로 남은 입력을 되돌려 놓는다
              const carry = this.chainBuffered - 1;
              this.beginAttack(this.cfg.moves[atk.chain]);
              this.chainBuffered = carry;
              break;
            }
            this.attackPhase = 'recovery';
            this.attackTimer = atk.recovery;
            break;
          case 'recovery':
            this.attackPhase = 'none';
            this.currentAttack = null;
            this.hitTargets.clear();

            // 후딜이 끝난 뒤에도 잠깐은 이어 칠 수 있게 여운을 남긴다
            if (atk.chain) {
              this.chainNext = atk.chain;
              this.chainUntil = time + CHAIN.GRACE_MS;
            }
            break;
        }
      }
    }

    /* 낙하 공격 — 정점에서 내리꽂고, 착지하면 충격파 */
    this.tickDive();

    /* 착지 판정 — 점프 횟수 복구 + 착지 스쿼시 */
    const onGround = this.body.blocked.down || this.body.touching.down;
    if (onGround) {
      // 방금 착지한 프레임에만 스쿼시를 준다 (매 프레임 재생 방지)
      if (!this.wasOnGround && this.fallSpeed > FIGHTER.LAND_SQUASH_VY) {
        this.pulseSquash(1.22, 0.8, 120);
        sound.play('land', Phaser.Math.Clamp(this.fallSpeed / 1200, 0, 1));
        this.landUntil = time + 120;
      }
      this.jumpsLeft = FIGHTER.MAX_JUMPS;
      this.fallSpeed = 0;
      this.jumpRising = false;

      /*
       * 착지 직전에 눌린 점프를 이제 실행한다.
       * 이것이 있어야 "착지하자마자 다시 뛰기"가 손에 맞는다.
       */
      if (this.jumpBufferedAt && time - this.jumpBufferedAt <= FIGHTER.JUMP_BUFFER_MS) {
        this.jumpBufferedAt = 0;
        this.jump();
      }
    } else {
      this.fallSpeed = Math.max(this.fallSpeed, this.body.velocity.y);

      if (this.body.velocity.y >= 0) {
        this.jumpRising = false;
      } else if (this.jumpRising && !this.jumpHeld) {
        /*
         * 버튼을 뗐는데 아직 올라가는 중 — 추가 중력으로 눌러 내린다.
         * 짧게 누르면 낮게, 길게 누르면 높게. 같은 버튼에 두 선택지가 생긴다.
         */
        this.body.setVelocityY(
          this.body.velocity.y + (FIGHTER.LOW_JUMP_GRAVITY * delta) / 1000,
        );
      }
    }
    this.wasOnGround = onGround;

    /* 상태에 맞는 포즈 + 시간 기반 모션 */
    this.view.setPose(this.computePose(onGround));
    this.view.update(time, onGround);

    /* 시각 갱신 — 스쿼시와 몸 크기를 함께 곱한다 */
    this.visual.setScale(
      this.facing * this.squash.x * this.sizeScale,
      this.squash.y * this.sizeScale,
    );

    /* 그림자 — 지면에 고정되고, 높이 뜰수록 작고 옅어진다 */
    const groundY = STAGE.GROUND_Y + 4;
    const airGap = Phaser.Math.Clamp(
      (groundY - (this.y + FIGHTER.BODY_H / 2)) / 300,
      0,
      1,
    );
    this.shadow.setPosition(this.x, groundY);
    this.shadow.setScale(1 - airGap * 0.5);
    this.shadow.setAlpha(0.32 * (1 - airGap * 0.75));

    // 경직 중에는 게이지를 살짝 흔들어 피격 상태를 알린다
    this.gauge.x = time < this.stunUntil ? Phaser.Math.Between(-2, 2) : 0;
  }

  /* ================================================================ */
  /* 내부 헬퍼                                                        */
  /* ================================================================ */

  private setFacing(dir: -1 | 1): void {
    this.facing = dir;
  }

  /**
   * 로켓 드롭 진행.
   *
   * 솟구쳐 올라가다 정점(상승 속도가 0에 가까워지는 순간)에서
   * 강제로 내리꽂고, 지면에 닿으면 광역 충격파를 낸다.
   */
  private tickDive(): void {
    if (!this.diving) return;

    if (this.diving.phase === 'rising') {
      // 정점 도달 → 하강 전환
      if (this.body.velocity.y > -60) {
        this.diving.phase = 'falling';
        this.body.setVelocityY(this.diving.atk.divePlunge!.speed);
        this.pulseSquash(0.7, 1.4, 160);
        sound.play('skill');
      }
      return;
    }

    // 하강 중 — 착지하면 충격파
    const landed = this.body.blocked.down || this.body.touching.down;
    if (!landed) return;

    const atk = this.diving.atk;
    this.diving = null;
    this.pulseSquash(1.6, 0.55, 200);
    this.onShockwave?.(this, atk);
  }

  /**
   * 현재 상태에서 재생할 포즈를 결정한다.
   * 스프라이트 시트든 도형 아트든 이 한 곳이 판단 기준이 된다.
   */
  private computePose(onGround: boolean): Pose {
    if (!this.alive) return 'lose';
    if (this.victorious) return 'win';

    const now = this.scene.time.now;

    // 방어가 깨진 기절은 일반 경직보다 우선한다 (무방비 상태를 확실히 보여준다)
    if (now < this.dizzyUntil) return 'dizzy';

    /*
     * 경직 중 — 공중이면 공중 피격, 지상에서 크게 날아가면 넉백, 아니면 피격.
     * 연속기로 띄운 뒤의 공중 피격이 잦아져서 전용 포즈를 나눴다.
     */
    if (now < this.stunUntil) {
      if (!onGround) return 'hitAir';
      const flung =
        Math.abs(this.body.velocity.x) > 420 || this.body.velocity.y < -320;
      return flung ? 'knockback' : 'hit';
    }

    // 프롬프트 시전·도발은 전투 동작이 아니라 연출이라 공격보다 앞에 둔다
    if (now < this.promptUntil) return 'promptCast';
    if (now < this.tauntUntil) return 'taunt';

    if (this.guarding && onGround) return 'guard';

    // 기술마다 전용 포즈가 있다 (시트에 없으면 뷰가 대체 사슬을 따라간다)
    if (this.attackPhase !== 'none' && this.currentAttack) {
      return MOVE_POSE[this.currentAttack.slot];
    }

    if (now < this.dashUntil) return 'dash';
    // 올라갈 때와 떨어질 때를 나눈다 — 공중 체공 시간이 눈에 읽힌다
    if (!onGround) return this.body.velocity.y > 220 ? 'fall' : 'jump';

    // 착지 직후 짧게 무릎을 굽히는 자세 (스쿼시만으로는 무게가 덜 실린다)
    if (now < this.landUntil) return 'land';
    if (now < this.itemGetUntil) return 'itemGet';

    const vx = Math.abs(this.body.velocity.x);
    if (vx > this.cfg.stats.speed * 0.75) return 'run';
    if (vx > 40) return 'walk';

    // 아이템을 들고 있으면 손에 쥔 대기 자세로 서 있는다
    return this.item ? 'itemHold' : 'idle';
  }

  /** 공격 판정이 켜지는 순간의 스윙 이펙트 */
  private spawnSwing(atk: AttackConfig): void {
    sound.play('whiff');
    /*
     * 모션 길이는 판정 시간이 아니라 **눈에 보이는 꼬리**로 준다.
     * 판정은 60~120ms 남짓이라 그 길이로 움직이면 깜빡하고 끝난다.
     * 후딜까지가 한 동작으로 읽히는 구간이다.
     */
    this.view.triggerAttack(atk, atk.active + atk.recovery);

    // 돌진기 — 판정이 켜지는 순간 앞으로 치고 나간다
    if (atk.lunge) this.body.setVelocityX(this.facing * atk.lunge);

    // 투사체 공격이면 탄을 쏘고 근접 스윙은 그리지 않는다
    if (atk.projectile) {
      this.onSpawnProjectile?.(this, atk);
      return;
    }

    const area = this.computeHitArea(atk);
    const color = this.cfg.colors.accent;
    const ms = Math.max(120, atk.active);

    switch (atk.fx ?? 'slash') {
      case 'thrust':
        this.fxThrust(area, color, ms);
        break;
      case 'rising':
        this.fxRising(area, color, ms);
        break;
      case 'slam':
        this.fxSlam(area, color, ms);
        break;
      case 'spin':
        this.fxSpin(area, color, ms);
        break;
      default:
        this.fxSlash(area, color, ms);
    }
  }

  /* --- 기술별 스윙 이펙트 ------------------------------------------ */

  /** 베기 — 앞으로 넓게 퍼지는 호 */
  private fxSlash(a: HitArea, color: number, ms: number): void {
    const swing = this.scene.add
      .ellipse(a.cx, a.cy, a.w * 1.1, a.h * 0.9, color, 0.35)
      .setDepth(DEPTH.IMPACT);

    this.scene.tweens.add({
      targets: swing,
      scaleX: 1.4,
      scaleY: 0.7,
      alpha: 0,
      duration: ms,
      ease: 'Quad.easeOut',
      onComplete: () => swing.destroy(),
    });
  }

  /** 찌르기 — 가늘고 길게 뻗는 선 */
  private fxThrust(a: HitArea, color: number, ms: number): void {
    const line = this.scene.add
      .ellipse(this.x + this.facing * 20, a.cy, a.w * 0.5, a.h * 0.34, color, 0.5)
      .setDepth(DEPTH.IMPACT);

    this.scene.tweens.add({
      targets: line,
      x: a.cx + this.facing * a.w * 0.2,
      scaleX: 2.2,
      alpha: 0,
      duration: ms,
      ease: 'Quad.easeOut',
      onComplete: () => line.destroy(),
    });
  }

  /** 쳐올림 — 위로 솟구치는 기둥 */
  private fxRising(a: HitArea, color: number, ms: number): void {
    const column = this.scene.add
      .ellipse(a.cx, a.cy + a.h * 0.3, a.w * 0.7, a.h * 0.6, color, 0.42)
      .setDepth(DEPTH.IMPACT);

    this.scene.tweens.add({
      targets: column,
      y: a.cy - a.h * 0.35,
      scaleX: 0.6,
      scaleY: 1.6,
      alpha: 0,
      duration: ms * 1.1,
      ease: 'Cubic.easeOut',
      onComplete: () => column.destroy(),
    });
  }

  /** 내려찍기 — 지면을 따라 좌우로 퍼지는 납작한 링 */
  private fxSlam(a: HitArea, color: number, ms: number): void {
    for (const dir of [-1, 1]) {
      const wave = this.scene.add
        .ellipse(this.x, a.cy + a.h * 0.3, a.w * 0.25, a.h * 0.5)
        .setDepth(DEPTH.IMPACT);
      wave.isFilled = false;
      wave.setStrokeStyle(5, color, 0.9);

      this.scene.tweens.add({
        targets: wave,
        x: this.x + dir * a.w * 0.42,
        scaleX: 2.6,
        scaleY: 0.7,
        alpha: 0,
        duration: ms * 1.2,
        ease: 'Cubic.easeOut',
        onComplete: () => wave.destroy(),
      });
    }
  }

  /** 회전 — 몸 주위를 도는 링 */
  private fxSpin(a: HitArea, color: number, ms: number): void {
    const ring = this.scene.add
      .ellipse(this.x, this.y, a.w * 0.5, a.h * 0.5)
      .setDepth(DEPTH.IMPACT);
    ring.isFilled = false;
    ring.setStrokeStyle(5, color, 0.85);

    this.scene.tweens.add({
      targets: ring,
      scaleX: 2.2,
      scaleY: 1.6,
      angle: 180 * this.facing,
      alpha: 0,
      duration: ms,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * 고유 자원 갱신.
   * 지금은 부스터만 시간이 지나면 차오른다 — 나머지는 행동으로만 쌓인다.
   */
  private tickSignature(time: number): void {
    if (this.cfg.signature.id !== 'booster') return;
    if (this.sigStacks >= this.cfg.signature.max) {
      this.sigRegenAt = time + 2200;
      return;
    }
    if (time >= this.sigRegenAt) {
      this.sigStacks++;
      this.sigRegenAt = time + 2200;
    }
  }

  /** 풍선이 터지는 연출 */
  private spawnBalloonPop(): void {
    for (let i = 0; i < 4; i++) {
      const bit = this.scene.add
        .circle(
          this.x + Phaser.Math.Between(-20, 20),
          this.y - 10,
          Phaser.Math.Between(4, 8),
          0xef4444,
          0.95,
        )
        .setDepth(DEPTH.IMPACT);

      this.scene.tweens.add({
        targets: bit,
        x: bit.x + Phaser.Math.Between(-70, 70),
        y: bit.y - Phaser.Math.Between(30, 90),
        alpha: 0,
        scale: 0.3,
        duration: 420,
        ease: 'Quad.easeOut',
        onComplete: () => bit.destroy(),
      });
    }
    sound.play('doubleJump');
  }

  /** 2단 점프 시 발밑 링 이펙트 */
  private spawnDoubleJumpRing(): void {
    const ring = this.scene.add
      .circle(this.x, this.y + FIGHTER.BODY_H / 2, 12)
      .setStrokeStyle(3, this.cfg.colors.accent, 0.9)
      .setDepth(DEPTH.IMPACT);

    this.scene.tweens.add({
      targets: ring,
      scale: 3.2,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /* ================================================================ */
  /* 차지 강공격                                                       */
  /* ================================================================ */

  /**
   * 이 기술을 모을 수 있는가.
   *
   * 지상 중립 강공격(K)과 그 2타만 허용한다. 방향기까지 모을 수 있게 하면
   * 모든 강공격이 "일단 눌러 두고 상황 보는" 기술이 되어, 커맨드를 나눈
   * 의미가 사라진다. **하나만 모을 수 있어야 그 하나가 특별해진다.**
   */
  private isChargeable(atk: AttackConfig): boolean {
    if (atk.type !== 'heavy') return false;
    if (atk.slot !== 'heavy' && atk.slot !== 'heavy2') return false;
    return this.body.blocked.down || this.body.touching.down;
  }

  /** 모은 만큼 강해진 사본 (안 모았으면 원본 그대로) */
  private applyCharge(atk: AttackConfig): AttackConfig {
    if (this.chargeMs < FIGHTER.CHARGE_MIN_MS) return atk;

    const t = Math.min(1, this.chargeMs / FIGHTER.CHARGE_MAX_MS);
    const dmg = 1 + (FIGHTER.CHARGE_DAMAGE_MUL - 1) * t;
    const kb = 1 + (FIGHTER.CHARGE_KNOCKBACK_MUL - 1) * t;

    return {
      ...atk,
      // 이름에 표시를 붙인다 — HUD에 "인수 합병 (풀차지)" 로 뜬다
      name: t >= 0.98 ? `${atk.name} (풀차지)` : atk.name,
      damage: Math.round(atk.damage * dmg),
      knockbackX: Math.round(atk.knockbackX * kb),
      knockbackY: Math.round(atk.knockbackY * kb),
      hitstop: Math.round(atk.hitstop * (1 + 0.5 * t)),
      shake: atk.shake * (1 + 0.8 * t),
      // 모은 한 방은 판정도 조금 길다 — 모은 보람이 맞히기 쉬움으로도 온다
      active: Math.round(atk.active * (1 + 0.25 * t)),
      range: Math.round(atk.range * (1 + 0.12 * t)),
    };
  }

  /** 모으는 동안의 진동과 불티 */
  private tickChargeFx(time: number): void {
    if (this.chargeMs < FIGHTER.CHARGE_MIN_MS) return;

    // 몸을 떨리게 — 모으는 중이라는 것이 정지 화면에서도 읽혀야 한다
    const t = Math.min(1, this.chargeMs / FIGHTER.CHARGE_MAX_MS);
    this.visual.x = Math.sin(time * 0.06) * (1 + t * 2.5);

    if (time - this.lastChargeSpark < 90) return;
    this.lastChargeSpark = time;

    const spark = this.scene.add
      .circle(
        this.x + Phaser.Math.Between(-26, 26),
        this.y + Phaser.Math.Between(-10, 34),
        3 + t * 3,
        this.cfg.colors.accent,
        0.9,
      )
      .setDepth(DEPTH.IMPACT);

    this.scene.tweens.add({
      targets: spark,
      y: spark.y - 34,
      alpha: 0,
      duration: 300,
      onComplete: () => spark.destroy(),
    });
  }

  /** 모은 것을 놓는 순간의 방출 링 */
  private spawnChargeBurst(): void {
    this.visual.x = 0;
    const t = Math.min(1, this.chargeMs / FIGHTER.CHARGE_MAX_MS);

    const ring = this.scene.add
      .circle(this.x, this.y, 18)
      .setStrokeStyle(4 + t * 3, this.cfg.colors.accent, 1)
      .setDepth(DEPTH.IMPACT);

    this.scene.tweens.add({
      targets: ring,
      scale: 2.4 + t * 2,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    sound.play('surge', 0.3 + t * 0.6);
  }

  /**
   * 회피 잔상.
   *
   * 무적은 눈에 안 보인다. 잔상이 없으면 "왜 안 맞았지"가 되고,
   * 그러면 회피가 실력이 아니라 운으로 읽힌다. 지나간 자리를 남긴다.
   */
  private spawnDodgeTrail(dir: -1 | 0 | 1): void {
    const count = dir === 0 ? 1 : 4;

    for (let i = 0; i < count; i++) {
      const ghost = this.scene.add
        .circle(
          this.x - dir * i * 16,
          this.y,
          FIGHTER.BODY_W * 0.42,
          this.cfg.colors.accent,
          0.32 - i * 0.06,
        )
        .setDepth(DEPTH.FIGHTER - 1);

      this.scene.tweens.add({
        targets: ghost,
        alpha: 0,
        scale: 0.7,
        duration: 220 + i * 40,
        onComplete: () => ghost.destroy(),
      });
    }
  }

  /** 떡상 불꽃 파티클 강도 설정 */
  private setFlame(level: 0 | 1 | 2 | 3): void {
    if (level === 0) {
      this.flameEmitter?.stop();
      return;
    }

    if (!this.flameEmitter) {
      this.flameEmitter = this.scene.add.particles(0, 0, 'spark', {
        speed: { min: 40, max: 140 },
        angle: { min: 250, max: 290 },
        scale: { start: 0.9, end: 0 },
        alpha: { start: 0.9, end: 0 },
        lifespan: { min: 300, max: 620 },
        blendMode: Phaser.BlendModes.ADD,
        frequency: 60,
        quantity: 1,
        emitting: false,
      });
      this.flameEmitter.setDepth(DEPTH.AURA);
      this.flameEmitter.startFollow(this, 0, 10);
    }

    const preset = {
      1: { frequency: 90, quantity: 1, tint: 0xfacc15 },
      2: { frequency: 45, quantity: 2, tint: 0xfb923c },
      3: { frequency: 20, quantity: 3, tint: 0xffffff },
    }[level];

    this.flameEmitter.frequency = preset.frequency;
    this.flameEmitter.quantity = preset.quantity;
    this.flameEmitter.setParticleTint(preset.tint);
    this.flameEmitter.start();
  }

  override destroy(fromScene?: boolean): void {
    this.auraTween?.stop();
    this.flameEmitter?.destroy();
    this.shadow.destroy();
    this.view.destroy();
    super.destroy(fromScene);
  }
}

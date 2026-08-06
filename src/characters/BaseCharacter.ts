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
  /** 착지 포즈가 유지되는 시각 */
  private landUntil = 0;
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
      this.attackPhase === 'none' &&
      this.scene.time.now >= this.stunUntil
    );
  }

  /** 좌우 이동. dir: -1 왼쪽, 0 정지, 1 오른쪽 */
  moveHorizontal(dir: -1 | 0 | 1): void {
    if (!this.alive || this.scene.time.now < this.stunUntil) return;

    // 공격·방어 중에는 이동 불가 (관성만 유지)
    if (this.attackPhase !== 'none' || this.guarding) return;
    // 대시 중에는 대시 속도를 덮어쓰지 않는다
    if (this.scene.time.now < this.dashUntil) return;

    if (dir === 0) {
      this.body.setAccelerationX(0);
      return;
    }

    const onGround = this.body.blocked.down || this.body.touching.down;
    const speed = this.cfg.stats.speed * this.speedMul * (this.mods.speedMul ?? 1);
    this.body.setVelocityX(speed * dir * (onGround ? 1 : FIGHTER.AIR_CONTROL));
    this.setFacing(dir);
  }

  /** 점프 (2단 점프 지원) */
  jump(): void {
    if (!this.canAct()) return;
    if (this.jumpsLeft <= 0) return;

    const first = this.jumpsLeft === FIGHTER.MAX_JUMPS;
    const power = first ? this.cfg.stats.jump : this.cfg.stats.doubleJump;
    this.body.setVelocityY(power);
    this.jumpsLeft--;

    // 도약 시 위로 늘어나는 스트레치
    this.pulseSquash(0.82, 1.22, 110);
    sound.play(first ? 'jump' : 'doubleJump');

    if (!first) this.spawnDoubleJumpRing();
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
    this.sizeScale = scale;

    const w = FIGHTER.BODY_W * scale;
    const h = FIGHTER.BODY_H * scale;
    this.body.setSize(w, h);
    this.body.setOffset(-w / 2, -h / 2);

    this.pulseSquash(scale > 1 ? 0.8 : 1.2, scale > 1 ? 1.25 : 0.85, 260);
  }

  /** 전투 승리 — 승리 포즈로 고정한다 */
  showVictory(): void {
    if (!this.alive) return;
    this.victorious = true;
    this.guarding = false;
    this.body.setVelocityX(0);
    this.pulseSquash(0.85, 1.2, 260);
  }

  /** 대시 — 짧게 치고 나간다 */
  dash(dir: -1 | 1): boolean {
    if (!this.canAct()) return false;

    const now = this.scene.time.now;
    if (now < this.dashReadyAt) return false;

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

    return this.cfg.moves[resolveMoveSlot(intent, dir, onGround)];
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

  /** 시그니처 스킬(L) */
  useSkill(): boolean {
    if (!this.canAct()) return false;
    if (!this.isSkillReady()) return false;

    const skill = this.cfg.moves.skill;
    const cooldown =
      (skill.cooldown ?? 10000) * this.cooldownMul * (this.mods.cooldownMul ?? 1);
    this.skillReadyAt = this.scene.time.now + cooldown;

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

    // 새 모션이 시작되면 이전 타의 여운은 무효가 된다
    // (선입력은 호출부가 남은 개수를 되돌려 놓는다)
    this.chainBuffered = 0;
    this.chainNext = null;

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

    /* 공격 상태 머신 진행 */
    if (this.attackPhase !== 'none' && this.currentAttack) {
      this.attackTimer -= delta;
      if (this.attackTimer <= 0) {
        const atk = this.currentAttack;
        switch (this.attackPhase) {
          case 'startup':
            this.attackPhase = 'active';
            this.attackTimer = atk.active;
            this.spawnSwing(atk);
            break;
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
    } else {
      this.fallSpeed = Math.max(this.fallSpeed, this.body.velocity.y);
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

    const vx = Math.abs(this.body.velocity.x);
    if (vx > this.cfg.stats.speed * 0.75) return 'run';
    if (vx > 40) return 'walk';
    return 'idle';
  }

  /** 공격 판정이 켜지는 순간의 스윙 이펙트 */
  private spawnSwing(atk: AttackConfig): void {
    sound.play('whiff');
    this.view.triggerAttack(atk, atk.active);

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

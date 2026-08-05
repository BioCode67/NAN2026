import Phaser from 'phaser';
import { CHARACTERS } from '../config/characters';
import {
  AI_MEDIUM,
  DEPTH,
  FIGHTER,
  GAME,
  STAGE,
  STOCK,
  TIERS,
} from '../config/gameConfig';
import { BaseCharacter } from '../characters/BaseCharacter';
import { AISystem } from '../systems/AISystem';
import { CombatSystem } from '../systems/CombatSystem';
import { eventBus } from '../systems/EventBus';
import { ItemSystem } from '../systems/ItemSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';
import { sound } from '../systems/SoundSystem';
import { StockSystem } from '../systems/StockSystem';
import { StockTier } from '../types';
import type { BattleSceneData } from '../types';

/** HUD 한 칸(파이터 1명분) */
interface FighterHud {
  fighter: BaseCharacter;
  percent: Phaser.GameObjects.Text;
  tierLabel: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
  skillBar: Phaser.GameObjects.Rectangle;
  skillLabel: Phaser.GameObjects.Text;
  itemIcon: Phaser.GameObjects.Text;
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

  private ground!: Phaser.GameObjects.Rectangle;
  private platforms: Phaser.GameObjects.Rectangle[] = [];
  private fighters: BaseCharacter[] = [];
  private player!: BaseCharacter;
  private ais: AISystem[] = [];

  private stock!: StockSystem;
  private combat!: CombatSystem;
  private projectiles!: ProjectileSystem;
  private items!: ItemSystem;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private huds: FighterHud[] = [];
  private muteLabel!: Phaser.GameObjects.Text;
  /** 더블탭 대시 판정용 */
  private lastTapDir: -1 | 0 | 1 = 0;
  private lastTapAt = 0;

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
    this.disposers = [];
    this.koOrder = [];
    this.battleActive = false;

    this.buildBackground();
    this.buildStage();
    this.spawnFighters();
    this.setupSystems();
    this.buildHud();
    this.bindInput();
    this.bindEvents();
    this.playIntro();

    sound.startBgm();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
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
   */
  private buildBackground(): void {
    const KEY = 'battle-bg';

    if (!this.textures.exists(KEY)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);

      // 하늘 — 아래로 갈수록 밝아지는 4단 그라데이션
      const bands = [0x070b18, 0x0b1020, 0x131c36, 0x1b2748];
      bands.forEach((color, i) => {
        g.fillStyle(color, 1);
        g.fillRect(0, i * (GAME.HEIGHT / 4), GAME.WIDTH, GAME.HEIGHT / 4);
      });

      // 캔들스틱 실루엣
      g.setAlpha(0.1);
      for (let x = 30; x < GAME.WIDTH; x += 46) {
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
      for (let x = 0; x <= GAME.WIDTH; x += 48) {
        y = Phaser.Math.Clamp(y + Phaser.Math.Between(-42, 30), 120, 520);
        g.lineTo(x, y);
      }
      g.strokePath();

      g.generateTexture(KEY, GAME.WIDTH, GAME.HEIGHT);
      g.destroy();
    }

    this.add.image(0, 0, KEY).setOrigin(0).setDepth(DEPTH.BG);
  }

  private buildStage(): void {
    const width = STAGE.RIGHT - STAGE.LEFT;
    const cx = (STAGE.LEFT + STAGE.RIGHT) / 2;

    // 배경 밴드(0x1b2748)와 확실히 구분되는 밝기라야 발판이 눈에 들어온다
    this.ground = this.add
      .rectangle(cx, STAGE.GROUND_Y + STAGE.GROUND_H / 2, width, STAGE.GROUND_H, 0x3a4c80)
      .setDepth(DEPTH.STAGE);
    this.physics.add.existing(this.ground, true);

    // 상단 하이라이트 — 착지 지점을 명확히 보여준다
    this.add
      .rectangle(cx, STAGE.GROUND_Y + 3, width, 6, 0x93c5fd)
      .setDepth(DEPTH.STAGE + 1);

    // 하단 그림자 라인 — 두께감
    this.add
      .rectangle(cx, STAGE.GROUND_Y + STAGE.GROUND_H - 3, width, 6, 0x1b2444)
      .setDepth(DEPTH.STAGE + 1);

    // 아래로 뻗은 지지대
    this.add
      .rectangle(cx, STAGE.GROUND_Y + STAGE.GROUND_H + 60, width - 120, 120, 0x202c52)
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
    for (const p of STAGE.PLATFORMS) {
      const plat = this.add
        .rectangle(p.x, p.y, p.w, STAGE.PLATFORM_H, 0x3a4c80)
        .setDepth(DEPTH.STAGE);
      this.physics.add.existing(plat, true);

      const body = plat.body as Phaser.Physics.Arcade.StaticBody;
      body.checkCollision.down = false;
      body.checkCollision.left = false;
      body.checkCollision.right = false;

      this.add
        .rectangle(p.x, p.y - STAGE.PLATFORM_H / 2 + 2, p.w, 4, 0x93c5fd)
        .setDepth(DEPTH.STAGE + 1);

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
      this.stock.register(f);
      // 투사체 스킬(빌 게이츠맨의 블루스크린 등) 발사 연결
      f.onSpawnProjectile = (owner, atk) => this.projectiles.spawn(owner, atk);
    });
    this.combat.setFighters(this.fighters);
    this.combat.setProjectiles(this.projectiles);

    this.items = new ItemSystem(this, this.stock);
    this.items.setFighters(this.fighters);

    /* AI 부착 — 플레이어를 추적 대상으로 삼는다 */
    this.fighters
      .filter((f) => f.side === 'ai')
      .forEach((bot) => {
        this.ais.push(
          new AISystem(
            bot,
            () => this.pickAiTarget(bot),
            AI_MEDIUM,
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

    this.keys = kb.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      jump: Phaser.Input.Keyboard.KeyCodes.SPACE,
      light: Phaser.Input.Keyboard.KeyCodes.J,
      heavy: Phaser.Input.Keyboard.KeyCodes.K,
      skill: Phaser.Input.Keyboard.KeyCodes.L,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // 스페이스바로 페이지가 스크롤되지 않도록 캡처
    kb.addCapture([
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
    ]);

    kb.on('keydown-R', () => this.scene.start('Battle', this.battleData));
    kb.on('keydown-ESC', () => this.scene.start('Select'));
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
    const onGround = p.body.blocked.down || p.body.touching.down;

    /* S — 지상에서는 방어, 공중에서는 급강하 */
    p.setGuard(this.keys.down!.isDown && onGround);
    if (this.keys.down!.isDown && !onGround) p.fastFall();

    /* A/D 더블탭 → 대시 */
    if (JustDown(this.keys.left!) && this.checkDoubleTap(-1)) p.dash(-1);
    if (JustDown(this.keys.right!) && this.checkDoubleTap(1)) p.dash(1);

    p.moveHorizontal(left && !right ? -1 : right && !left ? 1 : 0);

    if (JustDown(this.keys.jump!) || JustDown(this.keys.up!)) p.jump();
    if (JustDown(this.keys.light!)) p.attack('light');
    if (JustDown(this.keys.heavy!)) p.attack('heavy');
    if (JustDown(this.keys.skill!)) this.castSkill(p);
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
        if (
          attacker &&
          this.stock.getTier(p.attackerId) <= StockTier.CRISIS &&
          Phaser.Math.FloatBetween(0, 1) < 0.4
        ) {
          attacker.say(attacker.pickQuote('comeback'), 0xef4444);
        } else if (target && Phaser.Math.FloatBetween(0, 1) < 0.18) {
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
    this.time.delayedCall(320, () => this.announce('READY?', '#facc15'));

    this.time.delayedCall(1200, () => {
      this.announce('FIGHT!', '#ff5a5a');
      this.battleActive = true;
      this.items.start();
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

    this.add
      .rectangle(0, 0, GAME.WIDTH, GAME.HEIGHT, 0x000000, 0.62)
      .setOrigin(0)
      .setDepth(DEPTH.OVERLAY)
      .setScrollFactor(0);

    const title = this.add
      .text(
        GAME.WIDTH / 2,
        280,
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
        358,
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

    this.add
      .text(GAME.WIDTH / 2, 430, 'R : 다시하기      ESC : 캐릭터 선택', {
        fontFamily: GAME.FONT,
        fontSize: '18px',
        color: '#8fa6d8',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY + 1);

    this.tweens.add({
      targets: title,
      scale: { from: 1.6, to: 1 },
      duration: 420,
      ease: 'Back.easeOut',
    });
  }

  /** 화면 중앙 대형 안내 문구 */
  private announce(text: string, color: string, hold = 700): void {
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
          onComplete: () => label.destroy(),
        });
      },
    });
  }

  /* ================================================================ */
  /* HUD                                                              */
  /* ================================================================ */

  private buildHud(): void {
    // 조작키 안내는 상단에 둔다 — 하단은 HUD 패널이 가득 차 겹친다
    this.add
      .text(
        GAME.WIDTH / 2,
        20,
        'WASD 이동 · SPACE 점프(2단) · S 방어 · AA/DD 대시 · J 약공격 · K 강공격 · L 시그니처 · R 재시작',
        {
          fontFamily: GAME.FONT,
          fontSize: '13px',
          color: '#5d739f',
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);

    this.muteLabel = this.add
      .text(GAME.WIDTH - 20, 14, sound.isMuted ? '🔇 M' : '🔊 M', {
        fontFamily: GAME.FONT,
        fontSize: '14px',
        color: '#5d739f',
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH.HUD);

    /* 인원수만큼 패널을 가로로 고르게 배치한다 (1P는 항상 맨 왼쪽) */
    const n = this.fighters.length;
    const totalW = n * HUD_PANEL_W + (n - 1) * HUD_GAP;
    const startX = (GAME.WIDTH - totalW) / 2;

    this.fighters.forEach((fighter, i) => {
      const isPlayer = fighter.side === 'player';
      const x = startX + i * (HUD_PANEL_W + HUD_GAP);
      const y = HUD_Y;

      this.add
        .rectangle(x, y, HUD_PANEL_W, HUD_PANEL_H, 0x0b1020, 0.8)
        .setOrigin(0)
        // 플레이어 패널만 테두리를 밝게 해 눈에 띄게 한다
        .setStrokeStyle(isPlayer ? 3 : 2, fighter.cfg.colors.accent, isPlayer ? 0.95 : 0.45)
        .setDepth(DEPTH.HUD);

      this.add
        .circle(x + 30, y + 39, 21, fighter.cfg.colors.body)
        .setStrokeStyle(3, fighter.cfg.colors.accent)
        .setDepth(DEPTH.HUD + 1);

      this.add
        .text(x + 58, y + 8, fighter.cfg.name, {
          fontFamily: GAME.FONT,
          fontSize: '14px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setDepth(DEPTH.HUD + 1);

      this.add
        .text(x + 58, y + 27, isPlayer ? '1P' : `CPU (${AI_MEDIUM.label})`, {
          fontFamily: GAME.FONT,
          fontSize: '10px',
          color: isPlayer ? '#4ade80' : '#7f93bd',
        })
        .setDepth(DEPTH.HUD + 1);

      const percent = this.add
        .text(x + HUD_PANEL_W - 12, y + 5, '100%', {
          fontFamily: GAME.FONT,
          fontSize: '22px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(1, 0)
        .setDepth(DEPTH.HUD + 1);

      const tierLabel = this.add
        .text(x + HUD_PANEL_W - 12, y + 30, '보통', {
          fontFamily: GAME.FONT,
          fontSize: '10px',
          color: '#cbd5e1',
        })
        .setOrigin(1, 0)
        .setDepth(DEPTH.HUD + 1);

      // 주가 진행바
      this.add
        .rectangle(x + 58, y + 48, HUD_BAR_W, 12, 0x1a2440)
        .setOrigin(0)
        .setDepth(DEPTH.HUD + 1);
      const bar = this.add
        .rectangle(x + 58, y + 48, HUD_BAR_W / 3, 12, TIERS[StockTier.NORMAL].color)
        .setOrigin(0)
        .setDepth(DEPTH.HUD + 2);

      // 스킬 쿨다운
      this.add
        .rectangle(x + 58, y + 64, HUD_BAR_W, 5, 0x1a2440)
        .setOrigin(0)
        .setDepth(DEPTH.HUD + 1);
      const skillBar = this.add
        .rectangle(x + 58, y + 64, HUD_BAR_W, 5, fighter.cfg.colors.accent)
        .setOrigin(0)
        .setDepth(DEPTH.HUD + 2);

      const skillLabel = this.add
        .text(x + 58 + HUD_BAR_W + 6, y + 60, 'L', {
          fontFamily: GAME.FONT,
          fontSize: '11px',
          color: '#4ade80',
          fontStyle: 'bold',
        })
        .setDepth(DEPTH.HUD + 2);

      // 장착 아이템 아이콘
      const itemIcon = this.add
        .text(x + HUD_PANEL_W - 12, y + 46, '', { fontSize: '18px' })
        .setOrigin(1, 0)
        .setDepth(DEPTH.HUD + 2);

      this.huds.push({
        fighter,
        percent,
        tierLabel,
        bar,
        skillBar,
        skillLabel,
        itemIcon,
      });
    });
  }

  private updateHud(): void {
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

      // 상장폐지된 파이터는 패널 전체를 어둡게
      hud.percent.setAlpha(hud.fighter.alive ? 1 : 0.4);
      hud.bar.setAlpha(hud.fighter.alive ? 1 : 0.4);
    }
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
    // 히트스탑 중이면 모든 갱신을 멈춘다 (타격감의 핵심)
    if (this.combat.tickHitstop(time)) {
      this.updateHud();
      return;
    }

    if (this.battleActive) {
      this.handleInput();
      for (const ai of this.ais) ai.update(time, delta);
    }

    for (const f of this.fighters) f.update(time, delta);

    this.projectiles.update(time, delta);

    if (this.battleActive) {
      this.combat.update(time);
      this.items.update(time, delta);
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
    sound.stopBgm();
  }
}

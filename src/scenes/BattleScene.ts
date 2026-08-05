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
}

/** HUD 게이지 바 길이 */
const HUD_BAR_W = 300;

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
  private fighters: BaseCharacter[] = [];
  private player!: BaseCharacter;
  private ais: AISystem[] = [];

  private stock!: StockSystem;
  private combat!: CombatSystem;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private huds: FighterHud[] = [];

  /** 전투 진행 중인가 (인트로/결과 화면에서는 false) */
  private battleActive = false;
  /** EventBus 구독 해제 함수들 */
  private disposers: Array<() => void> = [];

  constructor() {
    super({ key: 'Battle' });
  }

  create(data: BattleSceneData): void {
    this.battleData = data;
    this.fighters = [];
    this.ais = [];
    this.huds = [];
    this.disposers = [];
    this.battleActive = false;

    this.buildBackground();
    this.buildStage();
    this.spawnFighters();
    this.setupSystems();
    this.buildHud();
    this.bindInput();
    this.bindEvents();
    this.playIntro();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.cameras.main.fadeIn(280, 0, 0, 0);
  }

  /* ================================================================ */
  /* 스테이지 구성                                                    */
  /* ================================================================ */

  private buildBackground(): void {
    // 하늘 — 위로 갈수록 어두운 4단 그라데이션
    const bands = [0x070b18, 0x0b1020, 0x131c36, 0x1b2748];
    bands.forEach((color, i) => {
      this.add
        .rectangle(0, i * (GAME.HEIGHT / 4), GAME.WIDTH, GAME.HEIGHT / 4, color)
        .setOrigin(0)
        .setDepth(DEPTH.BG);
    });

    // 배경 주가 차트 — 게임 테마를 드러내는 장식
    const chart = this.add.graphics().setDepth(DEPTH.BG + 1).setAlpha(0.16);
    chart.lineStyle(4, 0x4ade80, 1);
    let y = 420;
    chart.beginPath();
    chart.moveTo(0, y);
    for (let x = 0; x <= GAME.WIDTH; x += 48) {
      y = Phaser.Math.Clamp(y + Phaser.Math.Between(-42, 30), 120, 520);
      chart.lineTo(x, y);
    }
    chart.strokePath();

    // 캔들스틱 실루엣
    const candles = this.add.graphics().setDepth(DEPTH.BG + 1).setAlpha(0.1);
    for (let x = 30; x < GAME.WIDTH; x += 46) {
      const h = Phaser.Math.Between(30, 150);
      const cy = Phaser.Math.Between(240, 470);
      const up = Phaser.Math.Between(0, 1) === 1;
      candles.fillStyle(up ? 0x4ade80 : 0xef4444, 1);
      candles.fillRect(x, cy - h / 2, 16, h);
      candles.fillRect(x + 6, cy - h / 2 - 14, 4, h + 28);
    }
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
    [STAGE.LEFT, STAGE.RIGHT].forEach((x) => {
      this.add
        .rectangle(x, STAGE.GROUND_Y - 200, 3, 400, 0xef4444, 0.2)
        .setDepth(DEPTH.STAGE);
    });
  }

  /* ================================================================ */
  /* 파이터 생성                                                      */
  /* ================================================================ */

  private spawnFighters(): void {
    const spawnY = STAGE.GROUND_Y - FIGHTER.BODY_H;

    /* 플레이어 */
    this.player = new BaseCharacter(
      this,
      STAGE.LEFT + 220,
      spawnY,
      CHARACTERS[this.battleData.playerId],
      'player',
      'P1',
    );
    this.player.facing = 1;
    this.fighters.push(this.player);

    /* AI 봇 (배열이므로 인원 확장이 자유롭다) */
    this.battleData.aiIds.forEach((id, i) => {
      const bot = new BaseCharacter(
        this,
        STAGE.RIGHT - 220 - i * 140,
        spawnY,
        CHARACTERS[id],
        'ai',
        `CPU${i + 1}`,
      );
      bot.facing = -1;
      this.fighters.push(bot);
    });

    /* 지면 충돌 + 파이터 간 밀림 */
    this.fighters.forEach((f) => this.physics.add.collider(f, this.ground));
    this.physics.add.collider(this.fighters, this.fighters);
  }

  private setupSystems(): void {
    this.stock = new StockSystem(eventBus);
    this.combat = new CombatSystem(this, this.stock, eventBus);

    this.fighters.forEach((f) => this.stock.register(f));
    this.combat.setFighters(this.fighters);

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
  }

  private handleInput(): void {
    const p = this.player;
    if (!p.alive) return;

    const left = this.keys.left!.isDown;
    const right = this.keys.right!.isDown;
    p.moveHorizontal(left && !right ? -1 : right && !left ? 1 : 0);

    const JustDown = Phaser.Input.Keyboard.JustDown;
    if (JustDown(this.keys.jump!) || JustDown(this.keys.up!)) p.jump();
    if (this.keys.down!.isDown) p.fastFall();
    if (JustDown(this.keys.light!)) p.attack('light');
    if (JustDown(this.keys.heavy!)) p.attack('heavy');
    if (JustDown(this.keys.skill!)) this.castSkill(p);
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
      this.player.say(this.player.pickQuote('intro'), this.player.cfg.colors.accent);
    });

    // AI 인트로 대사는 살짝 늦춰 겹치지 않게 한다
    this.time.delayedCall(1700, () => {
      this.fighters
        .filter((f) => f.side === 'ai')
        .forEach((f) => f.say(f.pickQuote('intro'), f.cfg.colors.accent));
    });
  }

  private checkBattleEnd(): void {
    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length > 1) return;

    this.battleActive = false;
    const winner = alive[0] ?? null;

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

    this.add
      .text(
        GAME.WIDTH / 2,
        358,
        winner ? `${winner.cfg.name} 생존 · 주가 ${this.stock.get(winner.fighterId)}%` : '전원 상장폐지',
        {
          fontFamily: GAME.FONT,
          fontSize: '20px',
          color: '#cbd5e1',
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
        'WASD 이동 · SPACE 점프(2단) · J 약공격 · K 강공격 · L 시그니처 · R 재시작',
        {
          fontFamily: GAME.FONT,
          fontSize: '13px',
          color: '#5d739f',
        },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);

    this.fighters.forEach((fighter) => {
      const isPlayer = fighter.side === 'player';
      const x = isPlayer ? 34 : GAME.WIDTH - 34 - 420;
      const y = 618;

      this.add
        .rectangle(x, y, 420, 84, 0x0b1020, 0.78)
        .setOrigin(0)
        .setStrokeStyle(2, fighter.cfg.colors.accent, 0.5)
        .setDepth(DEPTH.HUD);

      // 캐릭터 색 아바타
      this.add
        .circle(x + 40, y + 42, 25, fighter.cfg.colors.body)
        .setStrokeStyle(3, fighter.cfg.colors.accent)
        .setDepth(DEPTH.HUD + 1);

      this.add
        .text(x + 78, y + 9, fighter.cfg.name, {
          fontFamily: GAME.FONT,
          fontSize: '17px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setDepth(DEPTH.HUD + 1);

      this.add
        .text(x + 78, y + 31, isPlayer ? '1P' : `CPU (${AI_MEDIUM.label})`, {
          fontFamily: GAME.FONT,
          fontSize: '11px',
          color: '#7f93bd',
        })
        .setDepth(DEPTH.HUD + 1);

      const percent = this.add
        .text(x + 404, y + 5, '100%', {
          fontFamily: GAME.FONT,
          fontSize: '28px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(1, 0)
        .setDepth(DEPTH.HUD + 1);

      const tierLabel = this.add
        .text(x + 404, y + 38, '보통', {
          fontFamily: GAME.FONT,
          fontSize: '12px',
          color: '#cbd5e1',
        })
        .setOrigin(1, 0)
        .setDepth(DEPTH.HUD + 1);

      // 주가 진행바
      this.add
        .rectangle(x + 78, y + 55, HUD_BAR_W, 13, 0x1a2440)
        .setOrigin(0)
        .setDepth(DEPTH.HUD + 1);
      const bar = this.add
        .rectangle(x + 78, y + 55, HUD_BAR_W / 3, 13, TIERS[StockTier.NORMAL].color)
        .setOrigin(0)
        .setDepth(DEPTH.HUD + 2);

      // 스킬 쿨다운
      this.add
        .rectangle(x + 78, y + 73, HUD_BAR_W, 5, 0x1a2440)
        .setOrigin(0)
        .setDepth(DEPTH.HUD + 1);
      const skillBar = this.add
        .rectangle(x + 78, y + 73, HUD_BAR_W, 5, fighter.cfg.colors.accent)
        .setOrigin(0)
        .setDepth(DEPTH.HUD + 2);

      const skillLabel = this.add
        .text(x + 78 + HUD_BAR_W + 8, y + 68, 'L', {
          fontFamily: GAME.FONT,
          fontSize: '12px',
          color: '#4ade80',
          fontStyle: 'bold',
        })
        .setDepth(DEPTH.HUD + 2);

      this.huds.push({ fighter, percent, tierLabel, bar, skillBar, skillLabel });
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

    if (this.battleActive) {
      this.combat.update(time);
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
  }
}

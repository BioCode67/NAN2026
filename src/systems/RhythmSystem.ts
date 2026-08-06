import Phaser from 'phaser';
import { DEPTH, GAME } from '../config/gameConfig';
import { sound } from './SoundSystem';
import type { RhythmJudge } from '../types';

/** BGM과 같은 BPM — 화면의 박자와 귀의 박자가 어긋나면 안 된다 */
const BPM = 132;
/** 한 박자 길이 (ms) */
const BEAT_MS = 60000 / BPM;

/** 판정 구간 (박자로부터의 오차, ms) */
const PERFECT_MS = 105;
const GOOD_MS = 200;

/** 판정별 결과 */
const PERFECT: RhythmJudge = { label: 'PERFECT!', mul: 2.0, color: '#f472b6' };
const GOOD: RhythmJudge = { label: 'GOOD', mul: 1.25, color: '#facc15' };
const MISS: RhythmJudge = { label: 'OFF BEAT…', mul: 0.5, color: '#5d739f' };

/** 게이지 규격 */
const BAR_W = 420;
const BAR_H = 16;
/*
 * 상단 조작 안내(16·34)와 기믹 배너(58) 아래로 내려 잡는다.
 * 겹치면 둘 다 안 읽힌다.
 */
const BAR_Y = 128;

/**
 * 리듬 배틀 룰.
 *
 * 활성화되면 승부 방식 자체가 바뀐다 — 때린 순간이 박자에 맞았는지로
 * 피해량이 2배에서 절반까지 갈린다. 마구 누르는 쪽이 손해가 되므로
 * 같은 조작으로 전혀 다른 게임이 된다.
 *
 * BGM 스케줄러와 시계를 공유하지 않고 자체 박자 시계를 돌린다.
 * 음소거 상태에서도 룰은 똑같이 동작해야 하기 때문이다.
 */
export class RhythmSystem {
  private active = false;
  /** 박자 기준 시각 — 활성화 순간을 0박으로 삼는다 */
  private originAt = 0;
  /** 마지막으로 연출을 재생한 박자 번호 */
  private lastBeatIndex = -1;

  private hud?: Phaser.GameObjects.Container;
  private marker?: Phaser.GameObjects.Rectangle;
  private zone?: Phaser.GameObjects.Rectangle;
  private label?: Phaser.GameObjects.Text;

  constructor(private readonly scene: Phaser.Scene) {}

  isActive(): boolean {
    return this.active;
  }

  /* ================================================================ */
  /* 시작 / 종료                                                      */
  /* ================================================================ */

  start(time: number): void {
    if (this.active) {
      // 이미 돌고 있으면 박자를 다시 세우지 않는다 (박자가 튀어 오히려 헷갈린다)
      return;
    }
    this.active = true;
    this.originAt = time;
    this.lastBeatIndex = -1;
    this.buildHud();
  }

  stop(): void {
    this.active = false;
    this.hud?.destroy();
    this.hud = undefined;
    this.marker = undefined;
    this.zone = undefined;
    this.label = undefined;
  }

  /* ================================================================ */
  /* 판정                                                             */
  /* ================================================================ */

  /**
   * 이 순간의 타격이 박자에 맞았는지 판정한다.
   * 비활성 상태면 배율 1의 무판정을 돌려준다.
   */
  judge(time: number): RhythmJudge | null {
    if (!this.active) return null;

    const phase = (time - this.originAt) % BEAT_MS;
    // 박자까지 남은 거리 — 직전 박자와 다음 박자 중 가까운 쪽
    const off = Math.min(phase, BEAT_MS - phase);

    if (off <= PERFECT_MS) return PERFECT;
    if (off <= GOOD_MS) return GOOD;
    return MISS;
  }

  /* ================================================================ */
  /* 매 프레임                                                        */
  /* ================================================================ */

  update(time: number): void {
    if (!this.active || !this.marker || !this.zone) return;

    const elapsed = time - this.originAt;
    const phase = (elapsed % BEAT_MS) / BEAT_MS;

    /*
     * 마커는 좌 → 우로 한 박자를 훑고, 판정 구간은 양 끝이다.
     * (박자는 0 지점에 있으므로, 화면에서도 끝에서 만나야 직관적이다)
     */
    this.marker.x = -BAR_W / 2 + BAR_W * phase;

    /* 박자가 바뀌는 순간마다 게이지를 튕겨 박을 눈으로 세게 한다 */
    const beatIndex = Math.floor(elapsed / BEAT_MS);
    if (beatIndex !== this.lastBeatIndex) {
      this.lastBeatIndex = beatIndex;
      this.pulse();
    }
  }

  /** 판정 결과를 타격 지점에 띄운다 */
  showJudge(x: number, y: number, judge: RhythmJudge): void {
    const text = this.scene.add
      .text(x, y - 78, judge.label, {
        fontFamily: GAME.FONT,
        fontSize: judge.mul > 1 ? '26px' : '19px',
        color: judge.color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.FLOATING);
    text.setStroke('#0b1020', 6);

    this.scene.tweens.add({
      targets: text,
      y: text.y - 34,
      alpha: 0,
      scale: { from: 1.4, to: 1 },
      duration: 620,
      ease: 'Quad.easeOut',
      onComplete: () => text.destroy(),
    });

    if (judge.mul > 1) sound.play('uiConfirm');
  }

  /* ================================================================ */
  /* HUD                                                              */
  /* ================================================================ */

  private buildHud(): void {
    const bg = this.scene.add
      .rectangle(0, 0, BAR_W, BAR_H, 0x0b1020, 0.85)
      .setStrokeStyle(2, 0xf472b6, 0.8);

    /*
     * 판정 구간을 양 끝에 그린다.
     * 마커가 이 색 위를 지날 때 누르면 PERFECT — 규칙을 글로 읽지 않아도 보인다.
     */
    const zoneW = BAR_W * (PERFECT_MS / BEAT_MS);
    const zoneLeft = this.scene.add
      .rectangle(-BAR_W / 2, 0, zoneW, BAR_H - 4, 0xf472b6, 0.35)
      .setOrigin(0, 0.5);
    const zoneRight = this.scene.add
      .rectangle(BAR_W / 2, 0, zoneW, BAR_H - 4, 0xf472b6, 0.35)
      .setOrigin(1, 0.5);
    this.zone = zoneLeft;

    this.marker = this.scene.add.rectangle(0, 0, 5, BAR_H + 10, 0xffffff, 1);

    this.label = this.scene.add
      .text(0, -22, '🎵 리듬 배틀 — 박자에 맞춰 때려라', {
        fontFamily: GAME.FONT,
        fontSize: '14px',
        color: '#f472b6',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.label.setStroke('#0b1020', 4);

    this.hud = this.scene.add
      .container(GAME.WIDTH / 2, BAR_Y, [
        bg,
        zoneLeft,
        zoneRight,
        this.marker,
        this.label,
      ])
      .setDepth(DEPTH.HUD + 1)
      .setScrollFactor(0);
  }

  private pulse(): void {
    if (!this.hud) return;
    this.scene.tweens.killTweensOf(this.hud);
    this.hud.setScale(1.06);
    this.scene.tweens.add({
      targets: this.hud,
      scale: 1,
      duration: 130,
      ease: 'Quad.easeOut',
    });
  }

  reset(): void {
    this.stop();
  }
}

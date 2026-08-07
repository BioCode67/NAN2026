import Phaser from 'phaser';
import { GAME } from './gameConfig';

/**
 * Phaser 코어 설정.
 *
 * ── 왜 gameConfig 에서 떼어냈는가 ─────────────────────────────────
 * gameConfig 에는 캐릭터 수치의 기본값(MOVE_TEMPLATES)이 들어 있다.
 * 그 값들을 게임 밖에서 읽고 싶은 도구가 생겼는데(npm run balance),
 * 같은 파일에 phaser 를 import 하고 있으면 Node 에서 게임 엔진을 통째로
 * 끌고 오게 된다 — DOM 이 없어 그대로 터진다.
 *
 * 여기 있는 것은 브라우저에서만 의미가 있는 설정뿐이므로 따로 둔다.
 *
 * Scene 목록은 여기에 넣지 않는다.
 * (Scene들이 gameConfig 의 상수를 import 하므로 순환 참조가 생긴다.
 *  실제 scene 배열은 main.ts에서 조립한다.)
 */
export const PHASER_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: GAME.WIDTH,
  height: GAME.HEIGHT,
  backgroundColor: GAME.BG_COLOR,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GAME.GRAVITY },
      debug: false,
    },
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  // 브라우저가 스페이스바/방향키로 스크롤하지 않도록
  input: {
    keyboard: true,
    gamepad: false,
  },
};

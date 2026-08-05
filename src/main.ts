import Phaser from 'phaser';
import { PHASER_CONFIG } from './config/gameConfig';
import { BootScene } from './scenes/BootScene';
import { SelectScene } from './scenes/SelectScene';
import { BattleScene } from './scenes/BattleScene';

/**
 * 게임 진입점.
 *
 * Scene 목록을 여기서 조립하는 이유:
 * gameConfig가 Scene을 import하면 Scene ↔ config 순환 참조가 생긴다.
 */
const game = new Phaser.Game({
  ...PHASER_CONFIG,
  scene: [BootScene, SelectScene, BattleScene],
});

/** Phaser 부팅이 끝나면 HTML 초기 로딩 화면을 지운다 */
game.events.once(Phaser.Core.Events.READY, () => {
  const preloader = document.getElementById('preloader');
  if (!preloader) return;

  preloader.classList.add('hidden');
  window.setTimeout(() => preloader.remove(), 400);
});

export default game;

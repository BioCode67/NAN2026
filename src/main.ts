import Phaser from 'phaser';
import { PHASER_CONFIG } from './config/gameConfig';
import { sound } from './systems/SoundSystem';
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

/**
 * 브라우저 자동재생 정책상 AudioContext는 사용자 입력 이후에만 생성할 수 있다.
 * 첫 입력에서 한 번만 초기화한다.
 */
const unlockAudio = (): void => sound.unlock();
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

/** Phaser 부팅이 끝나면 HTML 초기 로딩 화면을 지운다 */
game.events.once(Phaser.Core.Events.READY, () => {
  const preloader = document.getElementById('preloader');
  if (!preloader) return;

  preloader.classList.add('hidden');
  window.setTimeout(() => preloader.remove(), 400);
});

export default game;

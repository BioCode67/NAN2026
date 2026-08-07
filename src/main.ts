import Phaser from 'phaser';
import { PHASER_CONFIG } from './config/phaserConfig';
import { sound } from './systems/SoundSystem';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
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
  scene: [BootScene, TitleScene, SelectScene, BattleScene],
});

/**
 * 개발 서버에서만 게임 인스턴스를 전역에 노출한다.
 *
 * 스모크 테스트가 캔버스 그림만 보고 판정하면 "그 기술이 정말 나갔는지"를
 * 확인할 수 없다 — 저사양 헤드리스에서는 프레임이 드물어 결정적인 순간을
 * 놓치기 때문이다. 실제 상태(좌표·주가·진행 중인 기술)를 직접 읽을 수 있게 한다.
 * `import.meta.env.DEV` 는 프로덕션 빌드에서 false로 접혀 통째로 제거된다.
 */
if (import.meta.env.DEV) {
  const w = window as Window & { game?: Phaser.Game; sound?: typeof sound };
  w.game = game;
  // 소리는 스크린샷에 안 남는다 — 스모크가 시퀀서 상태를 직접 읽는다
  w.sound = sound;
}

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

import Phaser from 'phaser';
import { PHASER_CONFIG } from './config/phaserConfig';
import { sound } from './systems/SoundSystem';
import { imageGenDebug } from './config/imageGen';
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

/*
 * 그림 생성 서버가 붙어 있는지 콘솔에서 바로 볼 수 있게 한다.
 *
 * 시연 자리에서 "그림이 안 나온다"의 원인은 대개 주소·CORS·키 셋 중
 * 하나인데, 그걸 알아내려고 코드를 열게 하면 안 된다.
 *
 *   sdStatus()                     — 지금 어디에 붙어 있나
 *   sdConnect('http://127.0.0.1:7860')  — 그 자리에서 주소를 바꾼다
 */
{
  const w = window as unknown as Record<string, unknown>;
  w.sdStatus = imageGenDebug;
  w.sdConnect = (url: string, key = '', mode = 'auto'): string => {
    try {
      localStorage.setItem('sd.url', url);
      localStorage.setItem('sd.key', key);
      localStorage.setItem('sd.mode', mode);
    } catch {
      return '이 브라우저에서는 저장할 수 없습니다';
    }
    return '저장했습니다. 새로고침하면 적용됩니다.';
  };
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

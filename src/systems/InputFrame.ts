import Phaser from 'phaser';

/**
 * 한 프레임분의 조작 입력.
 *
 * ── 왜 값으로 만드는가 ─────────────────────────────────────────────
 * 전투 코드가 키 객체를 직접 읽으면, 입력이 키보드에서 오는 경우만 성립한다.
 * 온라인 대전에서 상대의 입력은 회선으로 오고, 봇은 아예 이 경로를 안 쓴다.
 *
 * 입력을 **읽는 일**과 그 입력으로 **무엇을 하는가**를 갈라 두면,
 * 키보드에서 오든 회선에서 오든 그 아래는 같은 코드를 탄다.
 * 회선으로 보낼 때도 이 구조 그대로 비트 하나씩에 담으면 된다.
 */
export interface InputFrame {
  /* 누르고 있는가 */
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jumpHeld: boolean;
  heavyHeld: boolean;

  /* 이번 프레임에 새로 눌렸는가 */
  tapLeft: boolean;
  tapRight: boolean;
  tapJump: boolean;
  tapLight: boolean;
  tapHeavy: boolean;
  tapSkill: boolean;
  tapGrab: boolean;
  tapTaunt: boolean;
  /** 이번 프레임에 점프를 뗐는가 (숏홉) */
  releaseJump: boolean;
}

/** 아무것도 누르지 않은 프레임 */
export function emptyFrame(): InputFrame {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    jumpHeld: false,
    heavyHeld: false,
    tapLeft: false,
    tapRight: false,
    tapJump: false,
    tapLight: false,
    tapHeavy: false,
    tapSkill: false,
    tapGrab: false,
    tapTaunt: false,
    releaseJump: false,
  };
}

/**
 * 키보드에서 한 프레임을 읽는다.
 *
 * JustDown 은 한 번 읽으면 그 프레임의 "방금 눌림"을 소비한다. 같은 키를
 * 두 곳에서 각각 읽으면 뒤쪽은 언제나 false 가 된다 — 실제로 그것 때문에
 * 회피가 통째로 죽어 있었다. 그래서 프레임 시작에 여기서 한 번만 읽는다.
 *
 * 2P는 한 동작에 키가 둘씩 묶여 있다(숫자패드 / `, . / ; '` 계열).
 * 묶인 키를 **전부 한 번씩** 읽어야 한다 — 짧게 끊는 `||` 로 쓰면 앞엣것이
 * 참일 때 뒤엣것을 안 읽어, 그 키의 눌림이 다음 프레임까지 남아 한 박자
 * 늦게 발동한다.
 */
export function readKeyFrame(
  keys: Record<string, Phaser.Input.Keyboard.Key>,
): InputFrame {
  const JustDown = Phaser.Input.Keyboard.JustDown;
  const JustUp = Phaser.Input.Keyboard.JustUp;

  const anyOf = (
    names: string[],
    read: (k: Phaser.Input.Keyboard.Key) => boolean,
  ): boolean => {
    let hit = false;
    for (const n of names) {
      const k = keys[n];
      if (k && read(k)) hit = true;
    }
    return hit;
  };
  const held = (name: string) => keys[name]?.isDown ?? false;

  return {
    tapLeft: anyOf(['left'], JustDown),
    tapRight: anyOf(['right'], JustDown),
    tapJump: anyOf(['jump', 'jumpAlt'], JustDown),
    releaseJump: anyOf(['jump', 'jumpAlt'], JustUp),
    tapLight: anyOf(['light', 'lightAlt'], JustDown),
    tapHeavy: anyOf(['heavy', 'heavyAlt'], JustDown),
    tapSkill: anyOf(['skill', 'skillAlt'], JustDown),
    tapGrab: anyOf(['grab', 'grabAlt'], JustDown),
    tapTaunt: anyOf(['taunt'], JustDown),

    left: held('left'),
    right: held('right'),
    up: held('up'),
    down: held('down'),
    jumpHeld: held('jump') || held('jumpAlt'),
    heavyHeld: held('heavy') || held('heavyAlt'),
  };
}

/* ------------------------------------------------------------------ */
/* 회선으로 보내기                                                      */
/* ------------------------------------------------------------------ */

/**
 * 누르고 있는 상태만 비트로 접는다.
 *
 * "방금 눌림"은 보내지 않는다. 받는 쪽에서 **앞 프레임과 비교해** 직접
 * 알아내는 편이 확실하다 — 순간적인 탭이 전송 주기 사이에 통째로 들어가면
 * 그 눌림은 아무 데도 안 남기 때문이다. 대신 보내는 쪽이 그 사이에 있었던
 * 눌림을 모아 두었다가(sticky) 함께 실어 보낸다.
 */
export const NET_BITS = [
  'left',
  'right',
  'up',
  'down',
  'jumpHeld',
  'heavyHeld',
] as const;

/** 전송 사이에 스쳐 지나간 눌림 — 이것까지 보내야 빠른 탭이 살아남는다 */
export const NET_TAP_BITS = [
  'tapJump',
  'tapLight',
  'tapHeavy',
  'tapSkill',
  'tapGrab',
  'tapTaunt',
  'tapLeft',
  'tapRight',
  'releaseJump',
] as const;

export function packFrame(f: InputFrame): [number, number] {
  let held = 0;
  NET_BITS.forEach((k, i) => {
    if (f[k]) held |= 1 << i;
  });
  let taps = 0;
  NET_TAP_BITS.forEach((k, i) => {
    if (f[k]) taps |= 1 << i;
  });
  return [held, taps];
}

export function unpackFrame(held: number, taps: number): InputFrame {
  const f = emptyFrame();
  NET_BITS.forEach((k, i) => {
    if (held & (1 << i)) f[k] = true;
  });
  NET_TAP_BITS.forEach((k, i) => {
    if (taps & (1 << i)) f[k] = true;
  });
  return f;
}

/** 여러 프레임에 걸쳐 모은 눌림을 하나로 합친다 (전송 주기가 프레임보다 길 때) */
export function mergeTaps(into: InputFrame, from: InputFrame): void {
  for (const k of NET_TAP_BITS) {
    if (from[k]) into[k] = true;
  }
}

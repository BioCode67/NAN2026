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
/* 게임패드                                                            */
/* ------------------------------------------------------------------ */

/**
 * 게임패드에서 한 프레임을 읽는다.
 *
 * ── 왜 클래스인가 ─────────────────────────────────────────────────
 * 키보드의 JustDown 에 해당하는 것이 패드에는 없다. "방금 눌림"은
 * 앞 프레임과 비교해야 알 수 있으므로, 읽는 쪽이 앞 프레임을 기억해야
 * 한다. 사람마다 패드가 하나씩이니 기억도 사람마다 하나씩이다.
 *
 * 버튼 배치는 키보드의 Space·J·K·L·U 를 그대로 얹는다:
 *  - A(아래) 점프 · X(왼쪽) 약공격 · B(오른쪽) 강공격 · Y(위) 스킬
 *  - LB·RB 잡기 · LT·RT 가드(=아래 방향)
 *  - 스틱·십자키 이동, 셀렉트 도발
 * 점프가 제일 큰 엄지 자리(A)에 오는 배치다 — 이 게임은 숏홉과
 * 공중 연속기가 손맛의 절반이라, 점프를 제일 좋은 자리에 둔다.
 */
export class PadReader {
  /** 앞 프레임의 "누르고 있었는가" — 방금 눌림·뗌을 가려내는 기준 */
  private prev = {
    left: false,
    right: false,
    jump: false,
    light: false,
    heavy: false,
    skill: false,
    grab: false,
    taunt: false,
  };

  /** 스틱을 이 이상 기울여야 이동으로 친다 (드리프트 방지) */
  private static readonly DEADZONE = 0.35;
  /** 위·아래는 더 깊게 — 대각 입력이 위/아래 기술을 훔쳐가지 않게 */
  private static readonly DEADZONE_Y = 0.5;

  read(pad: Phaser.Input.Gamepad.Gamepad): InputFrame {
    const dz = PadReader.DEADZONE;
    const stickX = pad.leftStick?.x ?? 0;
    const stickY = pad.leftStick?.y ?? 0;

    const left = pad.left || stickX < -dz;
    const right = pad.right || stickX > dz;
    const up = pad.up || stickY < -PadReader.DEADZONE_Y;
    // 트리거(LT·RT)는 가드다 — 아래 방향과 같은 일을 한다
    const shield = pad.L2 > 0.5 || pad.R2 > 0.5;
    const down = pad.down || stickY > PadReader.DEADZONE_Y || shield;

    const jump = pad.A;
    const light = pad.X;
    const heavy = pad.B;
    const skill = pad.Y;
    // 어깨 버튼은 눌린 깊이(0~1)로 온다 — 절반 넘게 눌리면 눌린 것이다
    const grab = pad.L1 > 0.5 || pad.R1 > 0.5;
    const taunt = pad.buttons[8]?.pressed ?? false;

    const p = this.prev;
    const frame: InputFrame = {
      left,
      right,
      up,
      down,
      jumpHeld: jump,
      heavyHeld: heavy,
      tapLeft: left && !p.left,
      tapRight: right && !p.right,
      tapJump: jump && !p.jump,
      releaseJump: !jump && p.jump,
      tapLight: light && !p.light,
      tapHeavy: heavy && !p.heavy,
      tapSkill: skill && !p.skill,
      tapGrab: grab && !p.grab,
      tapTaunt: taunt && !p.taunt,
    };

    this.prev = { left, right, jump, light, heavy, skill, grab, taunt };
    return frame;
  }
}

/**
 * 두 입력원을 하나로 합친다 — 키보드와 패드 중 **어느 쪽을 눌러도** 통한다.
 *
 * 어느 쪽을 쓸지 고르게 하지 않는다. 패드를 꽂은 채 키보드를 만지면
 * 죽는 쪽이 이상한 것이고, 합집합이면 고를 것도 설정할 것도 없다.
 */
export function mergeFrames(into: InputFrame, from: InputFrame): InputFrame {
  for (const k of Object.keys(into) as Array<keyof InputFrame>) {
    into[k] = into[k] || from[k];
  }
  return into;
}

/** 메뉴에서 이번 프레임에 새로 눌린 것들 */
export interface PadMenuTaps {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** A 또는 스타트 — 결정 */
  ok: boolean;
  /** B — 닫기/뒤로 */
  back: boolean;
  /** Y — 상세 보기 */
  info: boolean;
  /** 스타트만 — 일시정지처럼 결정과 갈라야 하는 곳에서 쓴다 */
  start: boolean;
  /** 아무 버튼이든 (타이틀 화면의 "아무 키나 누르세요") */
  any: boolean;
}

/**
 * 메뉴 화면용 패드 읽기 — 꽂힌 패드 **전부**를 하나로 합쳐 본다.
 *
 * 전투는 "n번째 패드가 n번째 사람"이지만, 메뉴는 누가 눌러도 움직여야
 * 한다 — 2P의 패드만 손에 있는 사람이 화면 앞에서 아무것도 못 하면
 * 그게 더 이상하다.
 */
export class PadMenu {
  private prev = new Map<string, boolean>();
  /**
   * 이번 화면에서 아직 한 번도 안 읽었는가.
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────
   * 화면을 넘기는 그 버튼은 다음 화면이 처음 읽을 때도 **아직 눌려 있다.**
   * 사람 손가락은 16ms 안에 안 떨어진다. 앞 화면의 기억이 남아 있는 채로
   * 읽으면 그 눌림이 다음 화면에서 "방금 눌림"으로 한 번 더 읽힌다.
   *
   * 지금은 그것이 사고로 이어지지 않는다. 스타트로 확정하고 들어와도
   * togglePause 가 인트로 중(battleActive=false)에는 안 멈추고, 선택 화면의
   * 확정은 readyAt 이 0.48초 막는다. 하지만 그 둘은 **다른 이유로 있는
   * 자물쇠**다 — 인트로가 짧아지거나 확정 잠금이 없어지면 그때 조용히
   * 새기 시작하고, 원인은 여기가 아닌 곳에서 찾게 된다.
   *
   * 그래서 새는 자리에서 막는다. 화면이 바뀌면 prime() 을 부르고, 다음
   * 한 번은 **읽되 아무것도 내지 않는다** — 지금 눌려 있는 것은 앞 화면
   * 것이라고 보는 것이다.
   */
  private primed = false;

  /** 화면이 바뀌었다 — 지금 눌려 있는 것은 앞 화면에서 넘어온 것이다 */
  prime(): void {
    this.primed = false;
    this.prev.clear();
  }

  poll(plugin: Phaser.Input.Gamepad.GamepadPlugin | null | undefined): PadMenuTaps {
    const taps: PadMenuTaps = {
      left: false,
      right: false,
      up: false,
      down: false,
      ok: false,
      back: false,
      info: false,
      start: false,
      any: false,
    };
    const pads = (plugin?.gamepads ?? []).filter((p) => p && p.connected);
    const swallow = !this.primed;

    for (const pad of pads) {
      const sx = pad.leftStick?.x ?? 0;
      const sy = pad.leftStick?.y ?? 0;
      const start = pad.buttons[9]?.pressed ?? false;
      const now: Record<keyof PadMenuTaps, boolean> = {
        left: pad.left || sx < -0.5,
        right: pad.right || sx > 0.5,
        up: pad.up || sy < -0.5,
        down: pad.down || sy > 0.5,
        ok: pad.A || start,
        back: pad.B,
        info: pad.Y,
        start,
        any: pad.buttons.some((b) => b?.pressed),
      };
      for (const k of Object.keys(now) as Array<keyof PadMenuTaps>) {
        const key = `${pad.index}:${k}`;
        if (now[k] && !this.prev.get(key) && !swallow) taps[k] = true;
        this.prev.set(key, now[k]);
      }
    }

    this.primed = true;
    return taps;
  }
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

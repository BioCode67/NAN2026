/**
 * 온라인 대전 로비 — 방 만들기 / 코드로 참가.
 *
 * 프롬프트 입력과 같은 이유로 DOM 을 쓴다. 코드 입력은 붙여넣기가 되어야 하고
 * (상대가 카톡으로 보내 준다), 방 코드는 드래그해서 복사할 수 있어야 한다.
 * 캔버스 안에 그린 글자로는 둘 다 안 된다.
 */

export type LobbyChoice =
  | { kind: 'host' }
  | { kind: 'join'; code: string }
  | { kind: 'localHost' }
  | { kind: 'localGuest' }
  | { kind: 'cancel' };

let openRoot: HTMLDivElement | null = null;

const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

function shell(): HTMLDivElement {
  closeNetOverlay();
  const root = document.createElement('div');
  openRoot = root;
  root.setAttribute('data-testid', 'net-overlay');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    background: 'rgba(6, 9, 20, 0.88)',
    backdropFilter: 'blur(3px)',
    zIndex: '60',
    fontFamily: FONT,
    color: '#e8eeff',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(root);
  return root;
}

function title(root: HTMLElement, text: string, sub?: string): void {
  const h = document.createElement('div');
  h.textContent = text;
  Object.assign(h.style, {
    fontSize: '30px',
    fontWeight: 'bold',
    letterSpacing: '1px',
  } satisfies Partial<CSSStyleDeclaration>);
  root.appendChild(h);

  if (!sub) return;
  const p = document.createElement('div');
  p.textContent = sub;
  Object.assign(p.style, {
    fontSize: '15px',
    color: '#8fa6d8',
    textAlign: 'center',
    lineHeight: '1.6',
    maxWidth: '560px',
  } satisfies Partial<CSSStyleDeclaration>);
  root.appendChild(p);
}

function button(label: string, accent: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    fontFamily: FONT,
    fontSize: '18px',
    fontWeight: 'bold',
    padding: '14px 34px',
    borderRadius: '10px',
    border: `2px solid ${accent}`,
    background: 'rgba(11,16,32,0.9)',
    color: accent,
    cursor: 'pointer',
    minWidth: '240px',
  } satisfies Partial<CSSStyleDeclaration>);
  b.onmouseenter = () => {
    b.style.background = accent;
    b.style.color = '#0b1020';
  };
  b.onmouseleave = () => {
    b.style.background = 'rgba(11,16,32,0.9)';
    b.style.color = accent;
  };
  return b;
}

/** 방을 만들 것인가, 코드로 들어갈 것인가 */
export function openLobby(): Promise<LobbyChoice> {
  const root = shell();

  return new Promise((resolve) => {
    const done = (c: LobbyChoice) => {
      closeNetOverlay();
      resolve(c);
    };

    title(
      root,
      '온라인 대전',
      '최대 네 명이 붙는다. 한 사람이 방을 만들어 코드를 알려주고,\n' +
        '나머지가 그 코드로 들어온다. 빈자리는 봇이 채운다.\n' +
        '(브라우저 창 여러 개로 혼자 시험해 볼 수도 있다)',
    );

    const make = button('방 만들기', '#4ade80');
    make.setAttribute('data-testid', 'net-host');
    make.onclick = () => done({ kind: 'host' });

    const join = button('코드로 참가', '#38bdf8');
    join.setAttribute('data-testid', 'net-join');
    join.onclick = () => {
      root.innerHTML = '';
      title(root, '코드 입력', '상대가 알려준 다섯 글자를 넣어 주세요.');

      const input = document.createElement('input');
      input.setAttribute('data-testid', 'net-code');
      input.maxLength = 5;
      input.autocomplete = 'off';
      input.placeholder = 'ABCDE';
      Object.assign(input.style, {
        fontFamily: FONT,
        fontSize: '34px',
        fontWeight: 'bold',
        letterSpacing: '10px',
        textAlign: 'center',
        textTransform: 'uppercase',
        width: '280px',
        padding: '12px',
        borderRadius: '10px',
        border: '2px solid #38bdf8',
        background: 'rgba(11,16,32,0.95)',
        color: '#e8eeff',
        outline: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      root.appendChild(input);
      input.focus();

      const go = button('들어가기', '#38bdf8');
      go.setAttribute('data-testid', 'net-go');
      const submit = () => {
        const code = input.value.trim().toUpperCase();
        if (code.length < 3) {
          input.style.borderColor = '#ef4444';
          return;
        }
        done({ kind: 'join', code });
      };
      go.onclick = submit;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') done({ kind: 'cancel' });
        e.stopPropagation();
      };
      root.appendChild(go);

      const back = button('취소', '#8fa6d8');
      back.onclick = () => done({ kind: 'cancel' });
      root.appendChild(back);
    };

    /*
     * 같은 컴퓨터에서 탭 두 개로.
     *
     * 인터넷도 상대도 없이 전 과정을 그대로 밟을 수 있다. 보여 줄 때
     * 회선 사정에 기대지 않아도 되고, 혼자서도 확인할 수 있다.
     */
    const localHost = button('이 컴퓨터에서 — 방 만들기', '#facc15');
    localHost.setAttribute('data-testid', 'net-local-host');
    localHost.onclick = () => done({ kind: 'localHost' });

    const localGuest = button('이 컴퓨터에서 — 참가', '#facc15');
    localGuest.setAttribute('data-testid', 'net-local-guest');
    localGuest.onclick = () => done({ kind: 'localGuest' });

    const note = document.createElement('div');
    /*
     * 탭이 아니라 창이라고 적는다.
     *
     * 브라우저는 뒤에 있는 탭의 화면 갱신을 멈춘다. 탭 두 개로 열면
     * 앞에 있는 쪽만 돌아가서 "회선이 끊긴 것처럼" 보인다 —
     * 창 두 개를 나란히 놓으면 둘 다 계속 돈다.
     */
    note.textContent =
      '같은 주소를 새 창에서 열고 둘 중 하나씩 누르면 붙는다  ·  탭 말고 창으로 (뒤에 있는 탭은 브라우저가 멈춘다)';
    Object.assign(note.style, {
      fontSize: '13px',
      color: '#6c86c4',
      marginTop: '-6px',
    } satisfies Partial<CSSStyleDeclaration>);

    const cancel = button('취소', '#8fa6d8');
    cancel.onclick = () => done({ kind: 'cancel' });

    root.append(make, join, localHost, localGuest, note, cancel);

    root.tabIndex = -1;
    root.focus();
    root.onkeydown = (e) => {
      if (e.key === 'Escape') done({ kind: 'cancel' });
      e.stopPropagation();
    };
  });
}

/**
 * 방 코드를 크게 띄우고 상대를 기다린다.
 *
 * @param code 상대에게 불러 줄 코드
 * @param onCancel 기다리기를 그만두면 호출
 */
export function showWaiting(
  code: string,
  onCancel: () => void,
  onStart?: () => void,
): { setCount: (n: number) => void } {
  const root = shell();

  title(root, '사람을 기다리는 중…', '아래 코드를 알려주세요. 최대 네 명까지 들어올 수 있습니다.');

  const box = document.createElement('div');
  box.setAttribute('data-testid', 'net-room-code');
  box.textContent = code;
  Object.assign(box.style, {
    fontFamily: FONT,
    fontSize: '64px',
    fontWeight: 'bold',
    letterSpacing: '14px',
    padding: '18px 34px',
    borderRadius: '14px',
    border: '3px solid #4ade80',
    color: '#4ade80',
    background: 'rgba(11,16,32,0.95)',
    // 드래그해서 복사할 수 있어야 한다 — 그러라고 DOM 으로 만들었다
    userSelect: 'all',
  } satisfies Partial<CSSStyleDeclaration>);
  /*
   * 코드 상자가 숨을 쉰다.
   *
   * 대기 화면은 온라인 데모에서 가장 오래 노출되는 화면인데 완전한 정지
   * 화면이었다 — 죽은 것처럼 보이는 화면 앞에서 사람은 금방 접는다.
   */
  if (!document.getElementById('net-glow-style')) {
    const style = document.createElement('style');
    style.id = 'net-glow-style';
    style.textContent = `
      @keyframes net-glow {
        from { box-shadow: 0 0 6px rgba(74, 222, 128, 0.25); }
        to { box-shadow: 0 0 26px rgba(74, 222, 128, 0.65); }
      }
      @keyframes net-pop {
        0% { transform: scale(1); }
        40% { transform: scale(1.18); }
        100% { transform: scale(1); }
      }`;
    document.head.appendChild(style);
  }
  box.style.animation = 'net-glow 1.4s ease-in-out infinite alternate';
  root.appendChild(box);

  const copy = button('코드 복사', '#4ade80');
  copy.onclick = () => {
    void navigator.clipboard?.writeText(code).then(
      () => (copy.textContent = '복사했습니다'),
      () => (copy.textContent = '복사에 실패했습니다'),
    );
  };
  root.appendChild(copy);

  /*
   * 몇 명 들어와 있는지 보여준다.
   *
   * 방을 열어 놓고 기다리는 쪽은 상대가 들어왔는지 알 방법이 없다.
   * 숫자가 안 움직이면 코드를 잘못 불러 준 것이고, 움직이면 기다리면 된다 —
   * 그 차이를 알 수 있어야 사람이 답답해하지 않는다.
   */
  const count = document.createElement('div');
  count.setAttribute('data-testid', 'net-count');
  Object.assign(count.style, {
    fontSize: '18px',
    color: '#e8eeff',
    fontWeight: 'bold',
  } satisfies Partial<CSSStyleDeclaration>);
  root.appendChild(count);

  const start = button('이 인원으로 시작', '#4ade80');
  start.setAttribute('data-testid', 'net-start');
  start.disabled = true;
  start.style.opacity = '0.4';
  start.style.cursor = 'default';
  start.onclick = () => {
    if (start.disabled) return;
    closeNetOverlay();
    onStart?.();
  };
  root.appendChild(start);

  const cancel = button('그만두기', '#8fa6d8');
  cancel.onclick = () => {
    closeNetOverlay();
    onCancel();
  };
  root.appendChild(cancel);

  let lastCount = 1;
  const setCount = (n: number) => {
    const bots = Math.max(0, 4 - n);
    count.textContent =
      n <= 1
        ? '아직 아무도 안 들어왔습니다'
        : `${n}명 참가 중${bots ? ` · 빈자리 ${bots}칸은 봇` : ' · 자리가 다 찼습니다'}`;
    /*
     * 누가 들어온 그 순간을 튕겨서 알린다 — 데모의 하이라이트가
     * 글자 하나 바뀌는 것으로 지나가면 아무도 눈치채지 못한다.
     */
    if (n > lastCount) {
      count.style.color = '#4ade80';
      count.style.animation = 'none';
      void count.offsetWidth; // 리플로우 — 같은 애니메이션을 다시 튼다
      count.style.animation = 'net-pop 400ms ease-out';
    }
    lastCount = n;
    // 혼자서는 시작할 수 없다 — 그건 온라인이 아니라 그냥 1인 플레이다
    const ready = n >= 2;
    start.disabled = !ready;
    start.style.opacity = ready ? '1' : '0.4';
    start.style.cursor = ready ? 'pointer' : 'default';
  };
  setCount(1);

  return { setCount };
}

/** 진행 상황 한 줄 (연결 중 · 상대를 기다리는 중) */
export function showStatus(text: string, sub = ''): void {
  const root = shell();
  title(root, text, sub);
}

/** 실패를 알리고 닫는다 */
export function showError(message: string, onClose: () => void): void {
  const root = shell();
  title(root, '연결 실패', message);

  const ok = button('확인', '#ef4444');
  ok.setAttribute('data-testid', 'net-error-ok');
  ok.onclick = () => {
    closeNetOverlay();
    onClose();
  };
  root.appendChild(ok);
}

export function closeNetOverlay(): void {
  openRoot?.remove();
  openRoot = null;
}

/** 지금 로비가 떠 있는가 (씬 쪽에서 키 입력을 막는 데 쓴다) */
export function isNetOverlayOpen(): boolean {
  return !!openRoot;
}

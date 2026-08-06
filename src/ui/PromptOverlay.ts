import { PROMPT_EXAMPLES, PROMPT_PLACEHOLDER } from '../config/gimmicks';

/**
 * 프롬프트 입력 오버레이.
 *
 * 캔버스 위에 실제 HTML `<input>`을 띄운다. Phaser의 키보드 입력으로
 * 텍스트를 받으면 한글 IME(조합 중인 글자)를 다룰 수 없어 "안녕"을 치면
 * "ㅇㅏㄴ..." 이 들어온다. 한국어가 1순위인 게임이라 DOM 입력이 맞다.
 *
 * 열려 있는 동안 Phaser 키보드는 씬 쪽에서 꺼 둔다 —
 * 그렇지 않으면 프롬프트를 치는 동안 캐릭터가 같이 움직인다.
 */

/** 입력 제한 — 길게 써도 해석에 도움이 되지 않고 UI만 넘친다 */
const MAX_LENGTH = 60;
/** 이 시간 안에 입력하지 않으면 자동으로 넘어간다 */
const TIMEOUT_MS = 12000;

export interface PromptOverlayResult {
  /** 입력한 문장 (시간 초과·취소면 빈 문자열) */
  text: string;
  /** 사용자가 직접 확정했는가 */
  submitted: boolean;
}

let openOverlay: HTMLDivElement | null = null;

/**
 * 오버레이를 띄우고 입력이 끝날 때까지 기다린다.
 *
 * @param who 오브를 깬 파이터 이름 (헤더에 표시)
 * @param accent 강조색 (#rrggbb)
 */
export function openPromptOverlay(
  who: string,
  accent: string,
): Promise<PromptOverlayResult> {
  // 이미 열려 있으면 겹쳐 띄우지 않는다 (오브가 연달아 깨질 수 있다)
  closePromptOverlay();

  return new Promise((resolve) => {
    const root = document.createElement('div');
    openOverlay = root;
    root.setAttribute('data-testid', 'prompt-overlay');
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '18px',
      background: 'rgba(6, 9, 20, 0.82)',
      backdropFilter: 'blur(3px)',
      zIndex: '50',
      fontFamily:
        '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif',
      color: '#e8eeff',
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.textContent = `${who} — 프롬프트 획득!`;
    Object.assign(title.style, {
      fontSize: '30px',
      fontWeight: '700',
      color: accent,
      letterSpacing: '0.02em',
    } satisfies Partial<CSSStyleDeclaration>);

    const guide = document.createElement('div');
    guide.textContent = '무엇이든 입력하세요. 판이 그대로 바뀝니다.';
    Object.assign(guide.style, {
      fontSize: '15px',
      color: '#8fa6d8',
    } satisfies Partial<CSSStyleDeclaration>);

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = MAX_LENGTH;
    input.placeholder = PROMPT_PLACEHOLDER;
    input.setAttribute('data-testid', 'prompt-input');
    // 브라우저 자동완성이 뜨면 예시 문구를 가린다
    input.autocomplete = 'off';
    Object.assign(input.style, {
      width: 'min(620px, 78vw)',
      padding: '16px 20px',
      fontSize: '20px',
      borderRadius: '10px',
      border: `2px solid ${accent}`,
      background: 'rgba(11, 16, 32, 0.95)',
      color: '#ffffff',
      outline: 'none',
      textAlign: 'center',
      fontFamily: 'inherit',
    } satisfies Partial<CSSStyleDeclaration>);

    /* 예시 — 무엇을 쓸 수 있는지 안 보여주면 대부분 그냥 넘긴다 */
    const examples = document.createElement('div');
    Object.assign(examples.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      justifyContent: 'center',
      width: 'min(620px, 78vw)',
    } satisfies Partial<CSSStyleDeclaration>);

    for (const ex of PROMPT_EXAMPLES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = ex;
      Object.assign(chip.style, {
        padding: '7px 12px',
        fontSize: '13px',
        borderRadius: '999px',
        border: '1px solid #2f3f6b',
        background: 'rgba(20, 28, 51, 0.9)',
        color: '#cbd5e1',
        cursor: 'pointer',
        fontFamily: 'inherit',
      } satisfies Partial<CSSStyleDeclaration>);
      // 클릭하면 바로 확정 — 타이핑이 부담스러운 사람도 기믹을 볼 수 있어야 한다
      chip.onclick = () => finish(ex, true);
      examples.appendChild(chip);
    }

    const hint = document.createElement('div');
    Object.assign(hint.style, {
      fontSize: '13px',
      color: '#5d739f',
    } satisfies Partial<CSSStyleDeclaration>);

    root.append(title, guide, input, examples, hint);
    document.body.appendChild(root);

    /* 남은 시간 표시 — 멈춰 있는 이유를 알려준다 */
    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      const left = Math.max(0, TIMEOUT_MS - (Date.now() - startedAt));
      hint.textContent = `Enter 확정 · ESC 건너뛰기 · ${Math.ceil(left / 1000)}초 후 자동 진행`;
      if (left <= 0) finish(input.value, false);
    }, 200);

    let done = false;
    function finish(text: string, submitted: boolean): void {
      if (done) return;
      done = true;

      window.clearInterval(tick);
      root.remove();
      if (openOverlay === root) openOverlay = null;

      resolve({ text: text.trim(), submitted });
    }

    input.onkeydown = (e) => {
      // 게임 쪽으로 키가 새어 나가지 않게 한다
      e.stopPropagation();
      if (e.key === 'Enter') finish(input.value, true);
      else if (e.key === 'Escape') finish('', false);
    };

    // 포커스는 다음 프레임에 준다 (막 붙인 요소는 포커스를 놓칠 수 있다)
    requestAnimationFrame(() => input.focus());
  });
}

/** 씬이 내려갈 때 남아 있는 오버레이를 걷어낸다 */
export function closePromptOverlay(): void {
  openOverlay?.remove();
  openOverlay = null;
}

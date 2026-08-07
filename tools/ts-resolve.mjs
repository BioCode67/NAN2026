/**
 * Node 에서 src/ 의 TypeScript 모듈을 그대로 import 할 수 있게 한다.
 *
 *   node --experimental-strip-types --import ./tools/ts-resolve.mjs <스크립트>
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * src 안에서는 `import { gates } from './gates'` 처럼 확장자를 뺀다.
 * 번들러(Vite)는 이것을 풀지만 Node 의 ESM 은 못 푼다 — 규격상 확장자가
 * 있어야 한다. 그래서 캐릭터 스무 명의 수치를 게임 밖에서 읽으려면
 * 파일을 글자로 파싱하거나(정확도가 떨어진다) 소스를 고쳐야 했다.
 *
 * 여기서는 세 번째 길을 쓴다 — 해석 단계에 끼어들어 확장자를 붙여 본다.
 * 게임 코드는 한 글자도 손대지 않고, 도구는 실제 값을 그대로 읽는다.
 * (MOVE_TEMPLATES 기본값까지 얹힌 **최종 수치**라야 밸런스를 볼 수 있다)
 */

import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (err) {
          // 상대 경로만 손본다. 패키지 이름에 확장자를 붙이면 엉뚱한 것을 집는다
          if (!specifier.startsWith('.')) throw err;
          for (const suffix of ['.ts', '/index.ts']) {
            try {
              return await next(specifier + suffix, context);
            } catch {
              /* 다음 후보 */
            }
          }
          throw err;
        }
      }
    `),
  import.meta.url,
);

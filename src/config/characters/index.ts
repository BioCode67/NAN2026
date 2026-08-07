import type { CharacterConfig, CharacterId } from '../../types';

import { gates } from './gates';
import { jobs } from './jobs';
import { musk } from './musk';
import { linus } from './linus';
import { pepe } from './pepe';

/**
 * 로스터.
 *
 * ── 왜 파일을 나눴는가 ────────────────────────────────────────────
 * 다섯 명일 때는 한 파일에 다 있었다(868줄). 스무 명으로 늘리면 3,500줄이
 * 되는데, 그러면 세 가지가 한꺼번에 무너진다.
 *   - 한 명을 고치려고 3,500줄을 열게 된다
 *   - 두 세션이 서로 다른 캐릭터를 건드려도 같은 파일이라 충돌한다
 *   - 어디까지가 누구인지 눈으로 못 센다
 * 캐릭터 하나 = 파일 하나. 추가는 파일 하나 + 아래 두 줄이다.
 *
 * ── 캐릭터를 추가하려면 ───────────────────────────────────────────
 *   1. npm run char:new <id>            (뼈대 파일이 생긴다)
 *   2. src/types/index.ts 의 CharacterId 에 id 추가
 *   3. 이 파일에 import 한 줄 + ROSTER 에 한 줄
 *   4. npm run test:char                (빠진 것이 있으면 여기서 잡힌다)
 *
 * ── 순서가 곧 선택 화면 순서다 ────────────────────────────────────
 * 화면에 카드로 늘어서므로, 다루기 쉬운 캐릭터를 앞에 두는 편이 낫다.
 */
const ROSTER: CharacterConfig[] = [gates, jobs, musk, linus, pepe];

export const CHARACTERS = Object.fromEntries(
  ROSTER.map((c) => [c.id, c]),
) as Record<CharacterId, CharacterConfig>;

export const CHARACTER_ORDER: CharacterId[] = ROSTER.map((c) => c.id);

/** ID로 캐릭터 설정을 가져온다. */
export function getCharacter(id: CharacterId): CharacterConfig {
  return CHARACTERS[id];
}

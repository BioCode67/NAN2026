import type { CharacterConfig, CharacterId } from '../../types';

import { gates } from './gates';
import { jobs } from './jobs';
import { musk } from './musk';
import { linus } from './linus';
import { pepe } from './pepe';
import { buffett } from './buffett';
import { jensen } from './jensen';
import { satoshi } from './satoshi';
import { zuck } from './zuck';
import { bezos } from './bezos';
import { altman } from './altman';
import { son } from './son';
import { ant } from './ant';
import { bear } from './bear';
import { bull } from './bull';
import { guru } from './guru';
import { bot } from './bot';
import { chairman } from './chairman';
import { doom } from './doom';
import { whale } from './whale';

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
 * 화면에 10칸씩 두 줄로 늘어선다. 윗줄에는 조작이 무난한 쪽을,
 * 아랫줄에는 극단적인 쪽(최경량 개미 · 최중량 고래 · 카운터형)을 둔다.
 * 처음 켠 사람이 왼쪽 위부터 훑어도 무리 없이 시작할 수 있게 하는 배치다.
 */
const ROSTER: CharacterConfig[] = [
  // 윗줄 — 기본기가 무난한 쪽
  gates, jobs, musk, linus, pepe,
  buffett, jensen, satoshi, zuck, bezos,
  // 아랫줄 — 성향이 뚜렷한 쪽
  altman, son, ant, bear, bull,
  guru, bot, chairman, doom, whale,
];

export const CHARACTERS = Object.fromEntries(
  ROSTER.map((c) => [c.id, c]),
) as Record<CharacterId, CharacterConfig>;

export const CHARACTER_ORDER: CharacterId[] = ROSTER.map((c) => c.id);

/** ID로 캐릭터 설정을 가져온다. */
export function getCharacter(id: CharacterId): CharacterConfig {
  return CHARACTERS[id];
}

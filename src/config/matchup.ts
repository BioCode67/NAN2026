import { CHARACTERS, CHARACTER_ORDER } from './characters';
import type { CharacterId } from '../types';

/**
 * 이번 판의 상대를 고른다.
 *
 * ── 왜 그냥 무작위로 뽑지 않는가 ──────────────────────────────────
 * 다섯 명일 때는 고유 메커니즘도 다섯 종이라, 아무나 뽑아도 셋이 전부 달랐다.
 * 스무 명이 되면서 메커니즘 하나를 네 명이 나눠 쓴다. 이제 무작위로 뽑으면
 * 열 판 중 두어 판은 봇 셋이 같은 메커니즘으로 나오고, 그러면 이름과 색만
 * 다른 셋을 상대하게 된다 — 로스터를 스무 명으로 늘린 이유가 사라진다.
 *
 * 그래서 메커니즘이 겹치지 않는 쪽을 먼저 집는다. 캐릭터 자체는 여전히
 * 무작위이므로 매 판 얼굴은 달라지고, 싸우는 방식만 매번 셋으로 갈린다.
 * (플레이어가 고른 메커니즘도 피한다 — 자기 거울상을 상대하는 재미는 적다)
 *
 * @param avoid 최근에 나온 상대들. 연승 도전에서 같은 얼굴이 연달아 나오는 것을 막는다
 * @param exclude 절대 뽑으면 안 되는 캐릭터. 2인 대전에서 2P가 고른 사람이 여기 들어간다
 */
export function pickOpponents(
  playerId: CharacterId,
  count: number,
  avoid: CharacterId[] = [],
  exclude: CharacterId[] = [],
): CharacterId[] {
  /*
   * exclude 는 avoid 와 다르다.
   *
   * avoid 는 "되도록 피한다"라 자리가 모자라면 다시 등장한다. 그런데 2P가
   * 고른 캐릭터가 봇으로도 나오면 같은 얼굴 둘이 한 판에 서게 되고,
   * 누가 사람인지 구별할 수 없게 된다. 이건 양보하면 안 되는 조건이다.
   */
  const shuffled = shuffle(
    CHARACTER_ORDER.filter((id) => id !== playerId && !exclude.includes(id)),
  );

  /*
   * 최근에 나온 얼굴을 뒤로 민다. 아예 빼지 않는 이유는 로스터가 작아졌을 때
   * (혹은 avoid 가 길어졌을 때) 뽑을 사람이 없어지기 때문이다 —
   * 순서만 밀어 두면 자리가 남을 때 자연스럽게 다시 등장한다.
   */
  const pool = [
    ...shuffled.filter((id) => !avoid.includes(id)),
    ...shuffled.filter((id) => avoid.includes(id)),
  ];

  const usedMechanism = new Set<string>([
    CHARACTERS[playerId]!.signature.id,
    // 2P가 쓰는 메커니즘도 겹치지 않게 — 넷이 전부 다른 방식으로 싸운다
    ...exclude.map((id) => CHARACTERS[id]!.signature.id),
  ]);
  const picked: CharacterId[] = [];

  for (const id of pool) {
    if (picked.length >= count) break;
    const sig = CHARACTERS[id]!.signature.id;
    if (usedMechanism.has(sig)) continue;
    usedMechanism.add(sig);
    picked.push(id);
  }

  // 메커니즘 종류보다 자리가 많으면(로스터가 작을 때) 남은 자리는 그냥 채운다
  for (const id of pool) {
    if (picked.length >= count) break;
    if (!picked.includes(id)) picked.push(id);
  }

  return picked;
}

/** 제자리를 건드리지 않는 셔플 (Fisher–Yates) */
function shuffle<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

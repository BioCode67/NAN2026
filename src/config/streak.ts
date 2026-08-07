import { AI_MEDIUM } from './gameConfig';
import type { AIDifficulty } from '../types';

/**
 * 연승 도전.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 캐릭터 스무 명에 무대 넷을 만들어 놨는데, 한 번 켜서 한 판 하고 끝나면
 * 그중 다섯 명과 한 곳밖에 못 본다. 만든 것의 4분의 3이 안 보이는 셈이다.
 *
 * 이기면 곧바로 다음 상대가 나오게 하면, 한 번 앉은 자리에서 로스터가
 * 계속 굴러간다. **판을 다시 고르러 나가지 않아도 되는 것**이 핵심이다 —
 * 선택 화면으로 돌아가는 순간 대부분은 거기서 그만둔다.
 *
 * ── 어려워지는 방식 ───────────────────────────────────────────────
 * 봇을 강하게 만드는 축은 여럿이지만, 여기서는 **판단 주기와 반응 지연**만
 * 줄인다. 피해량이나 체력을 손대면 "봇이 잘한다"가 아니라 "봇이 치트를
 * 쓴다"로 느껴지기 때문이다. 같은 규칙 안에서 더 빨리 판단할 뿐이다.
 *
 * 회복도 전부 해 주지는 않는다. 아슬아슬하게 이겼으면 다음 판도 아슬아슬하게
 * 시작해야 연승이 쌓이는 맛이 난다. 다만 바닥에서 시작하면 그냥 끝나므로
 * 하한을 둔다.
 */

/** 이 연승 수에서 봇이 얼마나 빨라지는가 */
export function streakDifficulty(streak: number): AIDifficulty {
  // 다섯 판이면 최대치 — 그 이상은 사람이 감당할 수 있는 범위를 넘는다
  const t = Math.min(1, streak / 5);

  return {
    ...AI_MEDIUM,
    label: streak === 0 ? AI_MEDIUM.label : `${streak}연승`,
    decisionInterval: Math.round(AI_MEDIUM.decisionInterval * (1 - 0.45 * t)),
    reactionDelay: Math.round(AI_MEDIUM.reactionDelay * (1 - 0.5 * t)),
    evadeChance: Math.min(0.6, AI_MEDIUM.evadeChance + 0.22 * t),
    heavyRatio: Math.min(0.6, AI_MEDIUM.heavyRatio + 0.2 * t),
    attackCooldown: Math.round(AI_MEDIUM.attackCooldown * (1 - 0.35 * t)),
  };
}

/**
 * 다음 판을 시작할 주가.
 *
 * 이긴 순간의 주가를 그대로 들고 가되, 너무 낮으면 올려 준다.
 * 300%로 끝났다고 300%로 시작하면 다음 판이 시시해지므로 상한도 둔다.
 */
export function carryOverStock(finalStock: number): number {
  return Math.round(Math.max(70, Math.min(150, finalStock)));
}

/** 연승 수에 붙는 이름 — 결과 화면에 띄운다 */
export function streakTitle(streak: number): string {
  if (streak >= 15) return '전설의 큰손';
  if (streak >= 10) return '시장 지배자';
  if (streak >= 7) return '상한가 행진';
  if (streak >= 5) return '떡상 가도';
  if (streak >= 3) return '연승 중';
  return '';
}

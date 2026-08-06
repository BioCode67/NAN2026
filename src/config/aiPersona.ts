import type { SignatureId } from '../types';

/**
 * 봇 성격표.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 캐릭터마다 고유 메커니즘을 만들어 놨지만 봇은 아무도 그걸 쓰지 않았다.
 * 게이츠 봇은 지분이 1도 안 쌓인 채로 블루스크린을 던지고, 리누스 봇은
 * 방어를 한 번도 하지 않아 포크를 영원히 못 쓴다. 그러면 네 명이 붙어도
 * 이름표만 다른 같은 봇 넷과 싸우는 것이고, 캐릭터를 고를 이유가 절반 사라진다.
 *
 * 그래서 봇에게도 그 캐릭터의 사용법을 준다. 맞는 쪽에서 "아, 저 캐릭터는
 * 저렇게 쓰는 거구나"를 배우게 하는 것이 목적이다 — 봇을 강하게 만드는 게 아니라.
 *
 * 성격은 고유 메커니즘(SignatureId)에 붙인다. 이 게임에서 그게 곧 캐릭터의
 * 정체성이라 1:1로 대응하고, 새 캐릭터를 넣어도 메커니즘만 정하면 성격이 따라온다.
 */
export interface AiPersona {
  /** 로그·테스트에서 사람이 읽을 이름 */
  label: string;
  /**
   * 스킬을 지르기 전에 모을 최소 자원.
   * 게이츠는 지분을 쌓아야 의미가 있고, 리누스는 훔친 기술이 있어야 한다.
   */
  skillMinStacks: number;
  /**
   * 그래도 이만큼(ms) 참았으면 그냥 지른다.
   *
   * 이 값이 없으면 조건이 영영 안 맞을 때 스킬을 한 번도 안 쓰는 봇이 된다.
   * 아끼다 못 쓰는 것보다는 어설프게라도 쓰는 쪽이 보는 사람에게 낫다.
   */
  skillPatience: number;
  /** 상대 공격에 반응할 때, 물러나는 대신 막을 확률 */
  guardChance: number;
  /** 한 번 막기 시작하면 유지하는 시간(ms) */
  guardMs: number;
  /** 공중 대시를 쓰는가 (머스크만) */
  useAirDash: boolean;
  /** 스킬 적중 후 후속 입력 창을 노리는가 (잡스만) */
  useFollowUp: boolean;
  /**
   * 자원이 쌓여 있을 때 회피 확률에 곱하는 값.
   * 맞으면 잃는 것이 있는 캐릭터(풍선·지분)는 더 사린다.
   */
  evadeMulWhenLoaded: number;
}

const DEFAULT: AiPersona = {
  label: '기본',
  skillMinStacks: 0,
  skillPatience: 0,
  guardChance: 0.12,
  guardMs: 420,
  useAirDash: false,
  useFollowUp: false,
  evadeMulWhenLoaded: 1,
};

export const AI_PERSONAS: Record<SignatureId, AiPersona> = {
  /* 게이츠 — 참았다 터뜨린다. 지분이 없으면 스킬을 아낀다 */
  shares: {
    ...DEFAULT,
    label: '지분을 모았다 터뜨린다',
    skillMinStacks: 4,
    skillPatience: 5200,
    evadeMulWhenLoaded: 1.2,
  },

  /* 잡스 — 맞히면 곧바로 한 번 더. 창이 열리면 무조건 지른다 */
  oneMoreThing: {
    ...DEFAULT,
    label: '맞히면 곧바로 한 번 더',
    useFollowUp: true,
  },

  /* 머스크 — 부스터로 붙고 부스터로 뺀다 */
  booster: {
    ...DEFAULT,
    label: '공중 대시로 붙었다 뺀다',
    guardChance: 0.08,
    useAirDash: true,
  },

  /*
   * 리누스 — 막는 것이 곧 공격 준비다.
   * 그래서 회피 대신 방어를 크게 늘렸다. 훔친 기술이 생겨야 스킬을 쓴다.
   */
  fork: {
    ...DEFAULT,
    label: '막아서 훔치고 되돌려준다',
    skillMinStacks: 1,
    skillPatience: 6500,
    guardChance: 0.68,
    guardMs: 520,
  },

  /* 펩 — 풍선을 벌고 나면 맞기를 꺼린다 */
  balloon: {
    ...DEFAULT,
    label: '풍선을 벌고 안 맞으려 든다',
    guardChance: 0.18,
    evadeMulWhenLoaded: 1.5,
  },
};

export function personaFor(id: SignatureId): AiPersona {
  return AI_PERSONAS[id] ?? DEFAULT;
}

/* ------------------------------------------------------------------ */
/* 판단                                                                */
/* ------------------------------------------------------------------ */

/** 스킬 시전 판단에 필요한 것만 추린 상태 */
export interface SkillState {
  /** 쿨다운이 돌아왔는가 */
  ready: boolean;
  /** 고유 자원 (지분 · 훔친 기술 · 풍선 …) */
  stacks: number;
  /** 후속 입력 창이 열려 있는가 (잡스) */
  windowOpen: boolean;
  /** 스킬이 준비된 채로 흘려보낸 시간(ms) */
  readyForMs: number;
  /** 사거리 안에 상대가 있는가 */
  inRange: boolean;
}

/**
 * 지금 스킬을 쓸 것인가.
 *
 * FSM에서 떼어낸 순수 함수다. 봇이 캐릭터를 제대로 쓰는지는 화면으로
 * 확인하기 어렵고(스킬 한 번 보려고 한 판을 지켜봐야 한다), 조건이
 * 미묘하게 어긋나면 "가끔 안 쓰는 것 같다" 정도로만 보여 놓치기 쉽다.
 * 그래서 판단만 떼어 브라우저 없이 검사할 수 있게 했다.
 */
export function shouldCastSkill(persona: AiPersona, s: SkillState): boolean {
  if (!s.inRange) return false;

  // 후속 입력 창은 쿨다운을 무시한다 — 이 창이 곧 잡스의 정체성이다
  if (persona.useFollowUp && s.windowOpen) return true;

  if (!s.ready) return false;
  if (s.stacks >= persona.skillMinStacks) return true;

  // 조건이 안 맞아도 너무 오래 아꼈으면 그냥 쓴다
  return s.readyForMs >= persona.skillPatience;
}

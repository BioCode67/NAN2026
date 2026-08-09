#!/usr/bin/env node
/**
 * 밸런스 분석기.
 *
 *   npm run balance            표만 본다
 *   npm run balance -- --full  기술 단위까지 본다
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 다섯 명일 때는 직접 다 해 보고 감으로 맞출 수 있었다. 스무 명이 되면
 * 한 명씩 붙여 보는 조합만 190가지다. 사람이 다 해 볼 수 없다.
 *
 * 그런데 이 게임의 수치는 전부 데이터다. 기술 하나에 피해·선딜·판정·후딜이
 * 있으니 **초당 피해**가 계산되고, 패시브에는 기대 배율이 있고, 스탯에는
 * 이동속도와 무게가 있다. 즉 "이 캐릭터가 남들보다 얼마나 센가"는
 * 플레이 없이도 상당 부분 계산된다.
 *
 * 이 도구가 잡으려는 것은 미세 조정이 아니다. **혼자 튀는 캐릭터**다.
 * 스무 명 중 하나가 두 배 세면 그 한 명 때문에 나머지 열아홉이 의미를 잃는다.
 * 그런 사고는 눈으로 안 보이고, 표로 보면 즉시 보인다.
 *
 * ── 무엇을 믿고 무엇을 믿지 말아야 하는가 ─────────────────────────
 * 여기 나오는 수치는 **모델**이지 실제 승률이 아니다. 실제로는 판정 모양,
 * 봇의 성격, 맵 구조가 다 끼어든다. 그래서 이 도구는 "누가 이긴다"를
 * 말하지 않고 "누가 표에서 혼자 튄다"만 말한다. 거기서부터는 사람이 본다.
 */

import { CHARACTERS, CHARACTER_ORDER } from '../src/config/characters/index.ts';

const FULL = process.argv.includes('--full');

/* ------------------------------------------------------------------ */
/* 모델                                                                */
/* ------------------------------------------------------------------ */

/** 기술 하나가 끝날 때까지 걸리는 시간(ms) */
const durationOf = (m) => m.startup + m.active + m.recovery;

/** 초당 피해 — 이 게임에서 "세다"의 1차 정의 */
const dpsOf = (m) => (m.damage / durationOf(m)) * 1000;

/**
 * 패시브가 기대적으로 얼마나 이득인가.
 *
 * 흡수형은 "때릴 때마다 피해량의 몇 배를 내 주가로 가져오는가"가 그대로
 * 기대값이다. 공격 배율형은 조건이 붙으므로, 그 조건이 붙어 있는 시간의
 * 비율을 곱해 기대 배율로 바꾼다.
 *
 * 조건 비율은 관측이 아니라 가정이다 — 주가는 100%에서 시작해 아래로도
 * 위로도 움직이고, 임계값이 낮을수록 그 구간에 오래 머문다. 정확한 값이
 * 아니라 **캐릭터끼리 같은 자로 재는 것**이 목적이다.
 */
function passiveValue(p) {
  switch (p.type) {
    case 'absorb_flat':
      return { absorb: p.absorbRatio ?? 1, atkMul: 1 };
    case 'absorb_chance':
      return { absorb: (p.chance ?? 0) * (p.absorbRatio ?? 1), atkMul: 1 };
    case 'absorb_random':
      return { absorb: ((p.minRatio ?? 1) + (p.maxRatio ?? 1)) / 2, atkMul: 1 };
    case 'power_when_low': {
      // 임계값이 높을수록 그 아래에 머무는 시간이 길다
      const share = Math.min(0.5, ((p.threshold ?? 60) / 100) * 0.45);
      return { absorb: 0, atkMul: 1 + ((p.powerMul ?? 1) - 1) * share };
    }
    case 'power_when_high': {
      // 위쪽 구간은 이기고 있어야 도달하므로 아래쪽보다 짧게 잡는다
      const share = Math.max(0.15, 0.55 - ((p.threshold ?? 120) - 100) / 200);
      return { absorb: 0, atkMul: 1 + ((p.powerMul ?? 1) - 1) * share };
    }
    default:
      return { absorb: 0, atkMul: 1 };
  }
}

/**
 * 스킬 특수 효과를 피해량으로 환산한다.
 *
 * dot 은 그대로 더하면 된다(초당 피해 x 지속). stun 은 피해가 아니라
 * **시간**을 뺏는 것이므로, 그 사이에 평균적으로 몇 대를 더 넣을 수 있는지로
 * 환산한다 — 이 게임의 약공격이 대략 초당 27 이므로 그 절반쯤을 잡는다
 * (붙어 있어야 하고, 넉백으로 떨어지기도 하므로 전부 챙기지는 못한다).
 * gamble 은 기대값이 0에 가깝다 — 크게 얻거나 크게 잃는다.
 */
function effectValue(sk) {
  const dur = (sk.effectDuration ?? 0) / 1000;
  switch (sk.effect) {
    case 'dot':
      return (sk.effectValue ?? 0) * dur;
    case 'stun':
      return dur * 13;
    default:
      return 0;
  }
}

/**
 * 고유 메커니즘이 스킬을 얼마나 부풀리는가.
 *
 * 조작으로 얻는 것이라 정확히 재려면 플레이 기록이 필요하다. 여기서는
 * "무엇이 스킬에 직접 붙는가"만 1차 근사로 잡는다 — 목적이 순위가 아니라
 * 혼자 튀는 캐릭터 찾기이므로, 방향만 맞으면 충분하다.
 */
function signatureBoost(id) {
  switch (id) {
    // 맞으면 쿨다운 없이 한 번 더 — 성공 시 두 배, 실패하면 그대로
    case 'oneMoreThing':
      return 1.5;
    // 쌓인 지분을 태워 강해진다
    case 'shares':
      return 1.35;
    // 막아낸 기술을 되돌려준다 — 방어에 성공해야 붙는다
    case 'fork':
      return 1.2;
    default:
      return 1;
  }
}

/**
 * 캐릭터 하나의 지표.
 *
 * 지표를 여러 개 두는 이유 — 총합 하나만 보면 "이동이 빠른 대신 약한"
 * 설계와 "그냥 약한" 설계가 같은 칸에 앉는다. 축을 나눠야 그 둘이 갈린다.
 */
function measure(c) {
  const m = c.moves;
  const { absorb, atkMul } = passiveValue(c.passive);

  /* 연속기 — 이 게임에서 가장 자주 나가는 흐름 */
  const chain = [m.light, m.light2, m.light3];
  const chainDamage = chain.reduce((n, x) => n + x.damage, 0);
  const chainMs = chain.reduce((n, x) => n + durationOf(x), 0);
  const chainDps = (chainDamage / chainMs) * 1000;

  /* 강공격 — 한 방을 노리는 흐름 */
  const heavy = [m.heavy, m.heavy2];
  const heavyDps =
    (heavy.reduce((n, x) => n + x.damage, 0) /
      heavy.reduce((n, x) => n + durationOf(x), 0)) *
    1000;

  /*
   * 스킬 — 쿨다운까지 넣어야 실제 기여가 나온다.
   *
   * 표에 적힌 damage 만 보면 스티븐 호킹처럼 "약하게 때리고 오래 갉는" 설계가
   * 통째로 저평가된다. 특수 효과를 피해량으로 환산해 더한다.
   */
  const sk = m.skill;
  const skillTotal = sk.damage + effectValue(sk);
  const skillDps =
    ((skillTotal * signatureBoost(c.signature.id)) /
      (durationOf(sk) + (sk.cooldown ?? 10000))) *
    1000;

  const all = Object.values(m);
  // 투사체는 사거리 칸이 0이다(탄이 날아간다) — 평균을 끌어내리므로 뺀다
  const melee = all.filter((x) => !x.projectile);
  const reach = melee.reduce((n, x) => n + x.range, 0) / melee.length;
  const topHit = Math.max(...all.map((x) => x.damage));

  /*
   * 공격 지표 — 세 흐름을 섞는다.
   * 연속기에 무게를 크게 두는 이유는 실제로 그것이 가장 많이 나가기 때문이다.
   */
  const offense = (chainDps * 0.5 + heavyDps * 0.35 + skillDps * 6) * atkMul;

  /*
   * 기동 — 이동속도·점프·2단점프를 한 자로 묶는다.
   * 부스터(공중 대시)와 풍선(점프 추가)은 조작으로 얻는 기동이므로 여기에 얹는다.
   */
  const mobilityBonus =
    c.signature.id === 'booster' || c.signature.id === 'balloon' ? 1.15 : 1;
  const mobility =
    (c.stats.speed / 270 + -c.stats.jump / 720 + -c.stats.doubleJump / 640) *
    mobilityBonus;

  /* 생존 — 무게(넉백 저항)와 흡수(맞고도 회복)를 함께 본다 */
  const survival = c.stats.weight + absorb * 0.45;

  return {
    id: c.id,
    name: c.name,
    chainDps,
    heavyDps,
    skillDps,
    reach,
    topHit,
    offense,
    mobility,
    survival,
    absorb,
    atkMul,
    signature: c.signature.id,
  };
}

/* ------------------------------------------------------------------ */
/* 통계                                                                */
/* ------------------------------------------------------------------ */

const stats = CHARACTER_ORDER.map((id) => measure(CHARACTERS[id]));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2))) || 1;
};

const field = (k) => {
  const xs = stats.map((s) => s[k]);
  return { mu: mean(xs), sigma: sd(xs) };
};

const AXES = ['offense', 'mobility', 'survival', 'reach'];
const norm = Object.fromEntries(AXES.map((k) => [k, field(k)]));
const z = (s, k) => (s[k] - norm[k].mu) / norm[k].sigma;

/**
 * 종합 점수.
 *
 * 축을 그냥 더한다 — 어느 축이 실제로 더 중요한지는 플레이해 봐야 알고,
 * 지금 필요한 것은 순위가 아니라 **혼자 떨어져 있는 사람**을 찾는 것이다.
 * 가중치를 붙이면 그 가중치가 곧 결론이 되어 버린다.
 */
const total = (s) => AXES.reduce((n, k) => n + z(s, k), 0);
const totals = stats.map(total);
const tSigma = sd(totals);
const tMu = mean(totals);

/* ------------------------------------------------------------------ */
/* 출력                                                                */
/* ------------------------------------------------------------------ */

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 1) => v.toFixed(n).padStart(6);
const bar = (zv) => {
  // -2σ ~ +2σ 를 13칸에 그린다. 가운데가 평균
  const i = Math.max(0, Math.min(12, Math.round((zv + 2) * 3)));
  return '·'.repeat(i) + '█' + '·'.repeat(12 - i);
};

console.log(`밸런스 — 캐릭터 ${stats.length}명\n`);
console.log(
  `${pad('캐릭터', 18)}${pad('공격', 8)}${pad('기동', 8)}${pad('생존', 8)}${pad('사거리', 8)}  종합  분포`,
);
console.log('─'.repeat(84));

/*
 * 두 개의 선을 둔다.
 *   1.5σ — "봐 둘 것". 일부러 극단으로 만든 캐릭터가 여기 걸리는 것은 정상이다
 *   2.5σ — "이건 사고". 스무 명 중 혼자 이만큼 떨어지는 것은 설계가 아니라 실수다
 * 하나만 두면 둘 중 하나가 된다 — 너무 자주 울려서 무시하게 되거나, 영영 안 울리거나.
 */
const WATCH = 1.5;
const BROKEN = 2.5;

const ranked = [...stats].sort((a, b) => total(b) - total(a));
for (const s of ranked) {
  const t = total(s);
  const d = Math.abs(t - tMu) / tSigma;
  const flag =
    d > BROKEN ? (t > tMu ? ' ◀◀ 너무 강함' : ' ◀◀ 너무 약함')
    : d > WATCH ? (t > tMu ? ' ◀ 상위' : ' ◀ 하위')
    : '';
  console.log(
    pad(s.name, 18) +
      num(z(s, 'offense'), 2) +
      '  ' +
      num(z(s, 'mobility'), 2) +
      '  ' +
      num(z(s, 'survival'), 2) +
      '  ' +
      num(z(s, 'reach'), 2) +
      '  ' +
      num(t, 1) +
      '  ' +
      bar(t / 2) +
      flag,
  );
}

console.log(
  `\n(숫자는 표준편차 단위. 0이 평균, +1이면 스무 명 중 위에서 세 번째쯤)`,
);

/* --- 축별 극단 ------------------------------------------------------ */

console.log('\n축별 양 끝');
for (const k of AXES) {
  const label = { offense: '공격', mobility: '기동', survival: '생존', reach: '사거리' }[k];
  const sorted = [...stats].sort((a, b) => b[k] - a[k]);
  console.log(
    `  ${pad(label, 6)} 최고 ${pad(sorted[0].name, 16)} ↔ 최저 ${sorted[sorted.length - 1].name}`,
  );
}

/* ------------------------------------------------------------------ */
/* 규칙 위반 — 통계가 아니라 "이건 확실히 잘못됐다"                     */
/* ------------------------------------------------------------------ */

/*
 * 통계적 이상치는 설계 의도일 수 있다(개미는 일부러 약하다).
 * 아래 것들은 의도일 수 없는 종류다 — 복붙하다 숫자를 안 고쳤거나,
 * 단위를 잘못 적었거나, 상수를 잘못 옮긴 흔적이다.
 */

const problems = [];

for (const id of CHARACTER_ORDER) {
  const c = CHARACTERS[id];
  const at = `${c.name}`;

  for (const [slot, m] of Object.entries(c.moves)) {
    const d = dpsOf(m);

    // 후딜에 비해 지나치게 싼 한 방 — 계속 눌러도 되는 기술이 되어 버린다
    if (d > 90) {
      problems.push(`${at} ${m.name}(${slot}): 초당 ${d.toFixed(0)} — 너무 싸다 (기준 90)`);
    }
    // 반대로 아무도 안 쓸 기술
    if (d < 12) {
      problems.push(`${at} ${m.name}(${slot}): 초당 ${d.toFixed(0)} — 쓸 이유가 없다 (기준 12)`);
    }
    // 판정이 시작도 안 했는데 끝나는 기술
    if (m.active < 40) {
      problems.push(`${at} ${m.name}(${slot}): 판정 ${m.active}ms — 맞출 수 없다`);
    }
    // 투사체 기술은 근접 히트박스를 안 쓴다 — 사거리 0이 정상이다
    if (m.range < 40 && !m.projectile) {
      problems.push(`${at} ${m.name}(${slot}): 사거리 ${m.range} — 닿지 않는다`);
    }
  }

  const sk = c.moves.skill;
  if (!sk.cooldown) problems.push(`${at}: 스킬에 쿨다운이 없다`);
  else if (sk.cooldown < 6000 || sk.cooldown > 16000) {
    problems.push(`${at}: 스킬 쿨다운 ${sk.cooldown}ms — 범위(6~16초) 밖`);
  }

  // 연속기가 뒤로 갈수록 약해지면 이어 칠 이유가 없다
  const [a, b, cc] = [c.moves.light, c.moves.light2, c.moves.light3];
  if (!(a.damage <= b.damage && b.damage < cc.damage)) {
    problems.push(
      `${at}: 연속기 피해가 ${a.damage} → ${b.damage} → ${cc.damage} — 뒤로 갈수록 커야 한다`,
    );
  }
}

console.log('\n규칙 검사');
if (problems.length) {
  problems.forEach((p) => console.log(`  ✗ ${p}`));
} else {
  console.log('  ✓ 초당 피해 · 판정 · 사거리 · 쿨다운 · 연속기 증가 — 전원 정상 범위');
}

/* --- 기술 단위 상세 ------------------------------------------------- */

if (FULL) {
  console.log('\n기술별 초당 피해');
  for (const id of CHARACTER_ORDER) {
    const c = CHARACTERS[id];
    const rows = Object.entries(c.moves)
      .map(([slot, m]) => `${slot}=${dpsOf(m).toFixed(0)}`)
      .join(' ');
    console.log(`  ${pad(c.name, 16)} ${rows}`);
  }
}

/* ------------------------------------------------------------------ */

const dev = (s) => Math.abs(total(s) - tMu) / tSigma;
const watch = ranked.filter((s) => dev(s) > WATCH && dev(s) <= BROKEN);
const broken = ranked.filter((s) => dev(s) > BROKEN);
const spread = total(ranked[0]) - total(ranked[ranked.length - 1]);

console.log(`\n요약`);
console.log(`  규칙 위반    ${problems.length}건`);
console.log(
  `  전체 폭      ${spread.toFixed(1)} (${ranked[0].name} ↔ ${ranked[ranked.length - 1].name})`,
);
console.log(
  `  봐 둘 것     ${watch.length}명` + (watch.length ? ` — ${watch.map((s) => s.name).join(', ')}` : ''),
);
console.log(
  `  고쳐야 할 것 ${broken.length}명` + (broken.length ? ` — ${broken.map((s) => s.name).join(', ')}` : ''),
);

if (!problems.length && !broken.length) {
  console.log('\n통과 — 스무 명이 한 표 안에 들어와 있다.');
}
console.log(
  '\n(이 표는 모델이지 승률이 아니다. 판정 모양·봇 성격·맵은 계산에 없다.\n' +
    ' 실제로 이겨야 할 이유가 없는 캐릭터를 찾는 것이 목적이다)',
);

process.exit(problems.length || broken.length ? 1 : 0);

#!/usr/bin/env node
/**
 * 온라인 방 관리 테스트 — 브라우저 없이.
 *
 *   npm run test:net
 *
 * ── 왜 브라우저 검사(smoke:online)로 충분하지 않은가 ─────────────────
 * 창을 실제로 붙여 보는 검사는 이 환경에서 **세 개까지**만 열린다.
 * 헤드리스 브라우저가 네 번째 창에 그림판을 못 내주기 때문인데, 하필
 * 자리 관리에서 틀리기 쉬운 것들이 전부 그 너머에 있다 —
 * 자리가 꽉 찼을 때, 나간 자리를 다시 쓸 때, 소식이 끊겼을 때.
 *
 * 그 부분은 그림이 필요 없다. 같은 컴퓨터 회선(BroadcastChannel)은 Node 에도
 * 있으므로, 게임을 띄우지 않고 **회선 계층만** 떼어 확인한다.
 * 초 단위로 끝나고 매번 같은 답이 나온다.
 */

import { NetSystem, MAX_PLAYERS } from '../src/systems/NetSystem.ts';

const problems = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => problems.push(msg);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 방 이름을 검사마다 다르게 — 앞 검사의 창이 남아 끼어들지 않도록 */
let roomSeq = 0;
const nextRoom = () => `test-${++roomSeq}`;

const opened = [];
/** 참가자 하나를 만들어 방에 넣는다 */
async function joinAs(role, room) {
  const n = new NetSystem();
  opened.push(n);
  await n.connectLocal(role, room);
  return n;
}

console.log('온라인 방 관리\n');

/* ------------------------------------------------------------------ */
/* 네 명까지 들어가고, 다섯 번째는 이유를 듣는다                        */
/* ------------------------------------------------------------------ */
{
  const room = nextRoom();
  const host = await joinAs('host', room);

  const guests = [];
  for (let i = 1; i < MAX_PLAYERS; i++) {
    guests.push(await joinAs('guest', room));
  }
  await wait(120);

  const slots = guests.map((g) => g.slot);
  const want = Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 1);

  if (slots.join() !== want.join()) {
    bad(`자리 번호가 1,2,3 순서로 나오지 않습니다 — ${slots.join()}`);
  } else if (host.playerCount !== MAX_PLAYERS) {
    bad(`호스트가 센 인원이 ${host.playerCount}명입니다 (${MAX_PLAYERS}이어야 합니다)`);
  } else {
    ok(`${MAX_PLAYERS}명이 자리 1·2·3 을 순서대로 받는다`);
  }

  /*
   * 다섯 번째.
   *
   * 못 들어가는 것 자체는 정상이다. 확인하려는 것은 **이유를 듣는가**다 —
   * 전에는 아무 답도 없어서, 들어가려던 사람은 한참 뒤에 "방을 연 창이
   * 없습니다"라는 엉뚱한 말을 들었다. 방은 있었고 자리가 없었을 뿐인데.
   */
  const late = new NetSystem();
  opened.push(late);
  const why = await late.connectLocal('guest', room).then(
    () => '',
    (err) => (err instanceof Error ? err.message : String(err)),
  );

  if (!why) {
    bad('자리가 꽉 찼는데 다섯 번째가 들어가졌습니다');
  } else if (!why.includes('가득')) {
    bad(`다섯 번째가 들은 이유가 엉뚱합니다 — "${why}"`);
  } else {
    ok(`다섯 번째는 곧바로 이유를 듣는다 — "${why}"`);
  }
}

/* ------------------------------------------------------------------ */
/* 나간 자리를 다시 쓴다                                                */
/* ------------------------------------------------------------------ */
{
  const room = nextRoom();
  const host = await joinAs('host', room);
  const a = await joinAs('guest', room);
  const b = await joinAs('guest', room);
  await wait(120);

  const left = [];
  host.onLeft = (slot) => left.push(slot);

  // 1번 자리가 나간다
  a.close();
  await wait(160);

  if (left.join() !== '1') {
    bad(`나간 자리를 판에 알리지 않았습니다 — 알린 것 [${left.join()}]`);
  } else {
    ok('나간 자리를 판에 알린다');
  }

  /*
   * 새 사람은 **비어 있는 1번**을 받아야 한다.
   *
   * 길이만 보고 번호를 주면 2번 다음이라 3번이 나가고, 그다음은 4번·5번 —
   * 자리 수보다 큰 번호는 화면에 없는 캐릭터를 조종하게 된다.
   */
  const c = await joinAs('guest', room);
  await wait(120);

  if (c.slot !== 1) {
    bad(`빈 1번 자리를 두고 ${c.slot}번을 줬습니다`);
  } else if (host.playerCount !== 3) {
    bad(`인원이 3명이어야 하는데 ${host.playerCount}명입니다`);
  } else {
    ok('나간 자리를 새 사람이 물려받는다 (번호가 늘어나지 않는다)');
  }

  void b;
}

/* ------------------------------------------------------------------ */
/* 인사 없이 사라진 자리                                                */
/* ------------------------------------------------------------------ */
{
  const room = nextRoom();
  const host = await joinAs('host', room);
  const g = await joinAs('guest', room);
  await wait(120);

  /*
   * 입력이 오는 동안에는 조용한 자리가 아니다.
   *
   * 참가자는 매 프레임 자기 입력을 보낸다. 그 소식이 오는 한 그 자리에는
   * 사람이 앉아 있는 것이고, 잠깐 버벅였다고 봇으로 바꿔서는 안 된다.
   */
  g.sendInput(0, 0);
  await wait(30);

  if (host.quietSlots(1000).length) {
    bad('입력이 오는 자리를 조용하다고 판단했습니다');
  } else {
    ok('입력이 오는 자리는 살아 있다고 본다');
  }

  /*
   * 창을 그냥 닫으면(=인사가 없으면) 침묵으로 알아채야 한다.
   * 여기서는 인사 없이 사라진 상황을 그대로 만든다 — 시간만 흐르게 둔다.
   */
  await wait(320);
  const quiet = host.quietSlots(250);

  if (quiet.join() !== '1') {
    bad(`조용해진 자리를 못 찾았습니다 — 찾은 것 [${quiet.join()}]`);
  } else {
    ok('소식이 끊긴 자리를 침묵으로 찾아낸다 (인사가 없어도)');
  }

  const left = [];
  host.onLeft = (slot) => left.push(slot);
  host.dropSlot(1, '소식이 끊겼습니다.');

  if (left.join() !== '1') {
    bad('조용한 자리를 비웠는데 판에 알리지 않았습니다');
  } else if (host.playerCount !== 1) {
    bad(`자리를 비운 뒤 인원이 ${host.playerCount}명입니다 (1이어야 합니다)`);
  } else {
    ok('조용한 자리를 비우면 판이 이어받을 수 있다');
  }
}

/* ------------------------------------------------------------------ */
/* 듣는 쪽이 터져도 자리 정리는 끝난다                                   */
/* ------------------------------------------------------------------ */
{
  /*
   * 로비 소식을 듣는 것은 화면이고, 화면은 사라진다.
   * 사라진 화면의 처리기가 예외를 던지면 그것이 자리 정리 도중에 튀어나와
   * **정리를 통째로 멈춘다.** 실제로 그래서 "나간 사람의 자리가 판에 그대로
   * 남는" 일이 있었다 — 나간 것은 회선이 아는데 판이 못 들었다.
   */
  const room = nextRoom();
  const host = await joinAs('host', room);
  const g = await joinAs('guest', room);
  await wait(120);

  host.onLobby = () => {
    throw new Error('사라진 화면인 척');
  };
  const left = [];
  host.onLeft = (slot) => left.push(slot);

  g.close();
  await wait(160);

  if (left.join() !== '1') {
    bad('로비 처리기가 터지자 자리 정리가 중간에 멈췄습니다');
  } else {
    ok('듣는 쪽이 터져도 자리 정리는 끝난다');
  }
}

/* ------------------------------------------------------------------ */

for (const n of opened) {
  try {
    n.close();
  } catch {
    /* 이미 닫혔으면 그만이다 */
  }
}

console.log('');
if (problems.length) {
  console.log(`실패 — ${problems.length}건`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log('통과 — 자리 관리가 네 명까지 어긋나지 않는다');

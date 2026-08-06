/**
 * 만들어야 할 그림 목록 — "무엇을, 어떤 프롬프트로, 어디에".
 *
 * 이 표를 gen-art(자동 생성)와 art-in(손으로 받은 것 정리)이 함께 쓴다.
 * 두 도구가 각자 경로를 들고 있으면 한쪽만 고쳐져서, 자동으로 만든 그림과
 * 손으로 넣은 그림이 서로 다른 자리에 놓이게 된다.
 */

import { STAGES, UI_ARTS } from './art-scenes.mjs';
import { BATCHES, CHARACTERS } from './art-characters.mjs';

/**
 * 비율은 프롬프트 글로도 적혀 있지만, 모델이 받아주면 지정하는 쪽이 훨씬 잘 맞는다.
 * 지원하지 않는 모델이면 gemini.mjs 가 알아서 빼고 다시 건다.
 */
export const RATIO = {
  stage: '21:9', // 월드가 1920x720(8:3)이라 가장 가까운 표준 비율
  bg: '16:9',
  logo: '21:9', // 3:1 로고. 표준 비율 중 가장 가로로 긴 것
  strip: '21:9', // 가로로 이어 붙인 칸 (아이콘 6칸 · 오브 4칸 · 캐릭터 6칸)
};

/** 만들 수 있는 것 전체 목록 */
export function buildCatalog() {
  const items = [];

  for (const st of STAGES) {
    items.push({
      id: st.id,
      group: 'scenes',
      label: `배경 · ${st.name}`,
      prompt: `art-source/prompts/scenes/${st.id}-${st.name}.txt`,
      out: `public/bg/${st.key}.png`,
      ratio: RATIO.stage,
    });
  }

  for (const ui of UI_ARTS) {
    items.push({
      id: ui.id,
      group: 'scenes',
      label: `UI · ${ui.name}`,
      prompt: `art-source/prompts/scenes/${ui.id}-${ui.name}.txt`,
      out: `public/ui/${ui.key}.png`,
      ratio: ui.kind === 'logo' ? RATIO.logo : ui.kind === 'sheet' ? RATIO.strip : RATIO.bg,
    });
  }

  for (const [charId, c] of Object.entries(CHARACTERS)) {
    for (const b of BATCHES) {
      items.push({
        id: `${charId}-b${b.id}`,
        group: charId,
        label: `${c.inGameName} · ${b.id}묶음 ${b.title}`,
        prompt: `art-source/prompts/${charId}/${b.id}-${b.title}.txt`,
        // merge-sheets 가 찾는 이름 그대로 (art-source/<key>_b<n>.png)
        out: `art-source/${c.key}_b${b.id}.png`,
        ratio: RATIO.strip,
      });
    }
  }

  return items;
}

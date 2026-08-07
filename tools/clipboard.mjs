/**
 * 클립보드에 글을 넣는다.
 *
 * 프롬프트 파일을 편집기로 열어 → 전체 선택 → 복사. 그림 한 장마다 이걸 한다.
 * 파일 경로는 도구가 이미 알고 있으므로, 사람이 열어볼 이유가 없다.
 *
 * 운영체제마다 다른 명령을 쓰지만 없을 수도 있다(리눅스 서버 등).
 * 못 넣으면 조용히 false를 돌려주고, 부르는 쪽이 "파일을 열어 복사하세요"로
 * 안내하면 된다. 이것 때문에 작업이 막히면 안 된다.
 */

import { spawnSync } from 'node:child_process';

/**
 * @param text 넣을 글
 * @param file 같은 내용이 담긴 파일 경로 (있으면 인코딩 사고가 적은 쪽을 쓴다)
 * @returns 성공 여부
 */
export function copyToClipboard(text, file) {
  const run = (cmd, args, input) => {
    const r = spawnSync(cmd, args, { input, encoding: 'utf8' });
    return !r.error && r.status === 0;
  };

  if (process.platform === 'win32') {
    /*
     * clip.exe 는 stdin을 UTF-8로 읽지 않아 한글이 깨진다.
     * PowerShell로 파일을 UTF-8로 읽어 넣는 쪽이 확실하다.
     * (경로에 한글과 공백이 있으므로 -LiteralPath 로 넘긴다)
     */
    if (file) {
      const quoted = file.replace(/'/g, "''");
      return run('powershell', [
        '-NoProfile',
        '-Command',
        `Get-Content -LiteralPath '${quoted}' -Raw -Encoding UTF8 | Set-Clipboard`,
      ]);
    }
    return run('powershell', ['-NoProfile', '-Command', 'Set-Clipboard -Value $input'], text);
  }

  if (process.platform === 'darwin') return run('pbcopy', [], text);

  // 리눅스 — 웨이랜드/X11 중 있는 것으로
  return (
    run('wl-copy', [], text) ||
    run('xclip', ['-selection', 'clipboard'], text) ||
    run('xsel', ['--clipboard', '--input'], text)
  );
}

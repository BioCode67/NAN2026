import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { globSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 같은 그림의 무거운 원본은 배포에 싣지 않는다.
 *
 * public/ 에는 생성기가 뱉은 PNG 원본과 `npm run art:opt` 이 만든 webp가
 * 나란히 있다. 원본은 다시 뽑을 때 비교하려고 남겨 두는 것이므로 저장소에는
 * 있어야 하지만, 심사자가 브라우저로 여는 배포본에는 필요 없다.
 * (게임은 webp가 있으면 그쪽을 읽는다 — src/config/artAssets.ts)
 *
 * 20MB를 그대로 올리면 그것만으로 "안 켜지는 게임"이 된다.
 */
function dropRedundantOriginals(): Plugin {
  return {
    name: 'drop-redundant-originals',
    apply: 'build',
    closeBundle() {
      const dist = resolve(process.cwd(), 'dist');
      let freed = 0;

      for (const webp of globSync('**/*.webp', { cwd: dist })) {
        const png = resolve(dist, webp.replace(/\.webp$/i, '.png'));
        try {
          freed += statSync(png).size;
          rmSync(png);
        } catch {
          // webp만 있는 그림 — 지울 원본이 없는 것은 정상이다
        }
      }

      if (freed > 0) {
        this.info(`원본 PNG 제외 — ${(freed / 1048576).toFixed(1)}MB 덜 배포합니다`);
      }
    },
  };
}

export default defineConfig({
  // 상대 경로 빌드: GitHub Pages / Netlify / itch.io 등 하위 경로 호스팅에서도 바로 동작한다.
  base: './',

  plugins: [dropRedundantOriginals()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 3000,
    open: true,
  },

  build: {
    outDir: 'dist',
    /*
     * 배포본에는 소스맵을 싣지 않는다.
     * 맵 파일만 10MB라 배포 산출물이 네 배가 되는데, 정작 플레이어는
     * 내려받지 않는다(개발자 도구를 열어야 요청된다). 소스는 GitHub에 있다.
     * 배포본을 직접 디버깅할 일이 생기면 SOURCEMAP=1 로 켠다.
     */
    sourcemap: !!process.env.SOURCEMAP,
    // Phaser 번들이 크므로 경고 임계값을 올린다.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});

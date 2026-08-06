import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    /*
     * 저장소 루트의 dist/ 로 내보낸다.
     *
     * 배포 환경이 결과물 폴더를 어떻게 정하든 걸리지 않게 하기 위해서다.
     * Vite 를 감지해 기본값 "dist" 를 기대하든, 설정 파일의 outputDirectory 를 읽든
     * 결국 같은 곳을 가리키게 된다. web/dist 로 두면 앞의 경우에 못 찾는다.
     */
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});

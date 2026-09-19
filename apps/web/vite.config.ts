import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// apps/web/vite.config.ts — W-024. The dev proxy forwards /api to the
// bisellium server (apps/server/src/http.ts) with changeOrigin so the
// browser's own Origin header never reaches it: http.ts line 261 refuses
// any write that carries one.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4477",
        changeOrigin: true,
      },
    },
  },
});

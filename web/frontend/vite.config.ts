// vite.config.ts —— 控制台构建配置（dev 代理 /api 与 /events 到主机 8080）
// 修改记录：2026-08-13 创建（阶段 11）
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/events": "http://127.0.0.1:8080",
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

// eslint.config.js —— ESLint 9 flat config
// 说明：覆盖 src/ 与 tests/；容器侧（container/）由独立 tsconfig + bun 生态管理，不在此 lint。
// 修改记录：
//   2026-08-12 创建（阶段 0）
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "container/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // 宿主代码禁止 catch-all 吞异常（借鉴 nanoclaw eslint-plugin-no-catch-all 的理念，用规则近似）
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // 前端静态脚本：浏览器全局（ESLint 9 flat config 不认 eslint-env 注释）
    files: ["src/web/static/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
);

/**
 * main.tsx —— 控制台入口
 *
 * 修改记录：2026-08-13 创建（阶段 11）
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * providers/index.ts —— provider 主机侧容器贡献自注册 barrel
 *
 * 职责：副作用导入 openai/ollama/claude 的容器贡献注册（密钥 -e 透传）。
 * 关键导出：无（副作用 barrel，由 src/index.ts 导入）
 *
 * 修改记录：2026-08-13 创建（收束期补 key 接线）
 */
import "./openai.js";
import "./ollama.js";
import "./claude.js";

/*
 * 修改记录：
 *   2026-08-24 补齐未完成清单：添加 ollama 独立导入
 */

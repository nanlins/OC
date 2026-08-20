# memory-kb

> 用途：知识库（RAG）模块——分块、embedding 向量检索、关键词召回、引用溯源、宿主/容器 KB 同步

## 内容清单
- `memory-kb.ts`：递归分块（400/overlap 60）+ BM25-lite 检索 + 可注入 EmbedFn + cosine 向量检索 + exportKbToDir

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 embedding 向量检索 + exportKbToDir
# kb-search — 群组知识库检索

用途：kb_search——在容器内检索 KB 目录（默认 /workspace/agent/kb，可经 OC_KB_DIR 注入）。

关键约束：
- 只在 KB 目录内读取（resolve 后前缀校验），文件数/深度有上限（防资源放大）。
- 检索打分用 CJK bigram / latin 分词 + 覆盖率；低于阈值的结果不返回。
- 结果附 source 引用（文件路径），模型引用时须用该 source，不得编造。
- KB 内容由宿主 memory-kb 同步（`oc kb sync`）到群组目录；容器只读不改。

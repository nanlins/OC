---
name: memory-management
description: 记忆维护——一文件一概念、索引即核心、记模式不记实例、事实更正即更新。
---

# Memory Management

记忆目录 /workspace/agent/memory/。规则（OKF v0.1）：

1. 一文件一概念；frontmatter `type` 标注类型（person/project/preference/...）。
2. index.md 是核心数据：Core Memory（常驻事实）+ Map（概念文件清单）。
3. 记模式不记实例：写"用户偏好简洁回复"，不写"2026-08-13 用户说回复要简洁"。
4. 事实更正即更新原文件，不追加矛盾副本。
5. 单文件超 16K 字符时瘦身：合并近义概念、删除过期事实。
6. 会话结束前自检：本轮是否产生值得记住的事实？有则写入。

# Makefile —— 快捷命令入口
# 修改记录：
#   2026-08-12 创建（阶段 0）
.PHONY: dev build test test-unit test-integration lint typecheck format check

dev:            ## 本地开发启动主机
	pnpm run dev

build:          ## 编译主机 TypeScript
	pnpm run build

test:           ## 全部测试（CI 全 Mock，不真调 LLM/Docker/网络）
	pnpm test

test-unit:
	pnpm test:unit

test-integration:
	pnpm test:integration

lint:           ## ESLint
	pnpm lint

typecheck:      ## tsc --noEmit
	pnpm typecheck

format:         ## Prettier 格式化
	pnpm format

check: lint typecheck test   ## 提交前全量自检
	@echo "all checks passed"

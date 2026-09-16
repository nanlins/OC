/**
 * config-deploy.test.ts —— 部署相关配置旋钮测试（WEB_HOST / OC_GROUPS_DIR / OC_DATA_DIR）
 *
 * 职责：锁定容器化部署依赖的三个配置行为——监听地址可配且默认回环（fail-closed）、
 *       GROUPS_DIR 与 DATA_DIR 可被环境变量覆盖成宿主绝对路径。
 * 承重不变量：GROUPS_DIR 会被原样交给 `docker run -v`，由宿主 daemon 解析；
 *   主机跑在容器里时若不可覆盖，daemon 会在宿主上自动创建空目录，Agent 拿到空 workspace
 *   且【不报错】。这条测试就是那个静默失效模式的防线。
 * 关键导出：无（纯测试）
 *
 * 修改记录：2026-09-16 创建（配合 docker-compose.yml 修复）
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { join } from "node:path";

/** config.ts 在加载期一次性求值，所以每个用例都要重置模块注册表后再动态导入 */
async function loadConfig() {
  vi.resetModules();
  return import("../../src/config.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("WEB_HOST", () => {
  it("默认绑定回环地址（fail-closed：未配 WEB_TOKEN 时只有本机可达）", async () => {
    vi.stubEnv("WEB_HOST", "");
    delete process.env.WEB_HOST;
    const cfg = await loadConfig();
    expect(cfg.WEB_HOST).toBe("127.0.0.1");
  });

  it("可覆盖为 0.0.0.0（容器化部署必需，否则发布的端口从宿主不可达）", async () => {
    vi.stubEnv("WEB_HOST", "0.0.0.0");
    const cfg = await loadConfig();
    expect(cfg.WEB_HOST).toBe("0.0.0.0");
  });
});

describe("GROUPS_DIR / DATA_DIR 可覆盖为宿主绝对路径", () => {
  it("未设 OC_GROUPS_DIR 时回落 PROJECT_ROOT/groups", async () => {
    delete process.env.OC_GROUPS_DIR;
    const cfg = await loadConfig();
    expect(cfg.GROUPS_DIR).toBe(join(cfg.PROJECT_ROOT, "groups"));
  });

  it("设了 OC_GROUPS_DIR 就逐字采用（不做相对解析）", async () => {
    vi.stubEnv("OC_GROUPS_DIR", "/host/repo/groups");
    const cfg = await loadConfig();
    expect(cfg.GROUPS_DIR).toBe("/host/repo/groups");
  });

  it("STORE_DIR 跟随 OC_DATA_DIR，保证会话双 DB 也落在宿主可见路径", async () => {
    vi.stubEnv("OC_DATA_DIR", "/host/repo/data");
    const cfg = await loadConfig();
    expect(cfg.DATA_DIR).toBe("/host/repo/data");
    expect(cfg.STORE_DIR).toBe(join("/host/repo/data", "v2-sessions"));
  });
});

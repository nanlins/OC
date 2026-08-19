/**
 * __tests__/dashboard.test.tsx —— Dashboard 组件测试（mock fetch 投影 → 计数卡渲染正确）
 *
 * 关键导出：无（vitest 测试套件）
 *
 * 修改记录：2026-08-13 创建（阶段 11）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Dashboard } from "../pages/Dashboard.js";
import { actions } from "../store/app-store.js";

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const ROUTES: Record<string, unknown> = {
  "/api/groups": [
    { id: "g1", name: "alpha", folder: "/g/alpha", agent_provider: "anthropic", created_at: "2026-08-13T00:00:00Z" },
    { id: "g2", name: "beta", folder: "/g/beta", agent_provider: null, created_at: "2026-08-13T00:00:00Z" },
  ],
  "/api/sessions": [
    { id: "s1", agent_group_id: "g1", messaging_group_id: "mg1", thread_id: null, status: "active", container_status: "running", last_active: "2026-08-13T01:00:00Z" },
    { id: "s2", agent_group_id: "g2", messaging_group_id: null, thread_id: null, status: "idle", container_status: "stopped", last_active: null },
  ],
  "/api/wirings": [],
  "/api/approvals": [
    { id: "ap1", action: "shell.exec", status: "pending", title: "reboot", agent_group_id: "g1", created_at: "2026-08-13T02:00:00Z" },
    { id: "ap2", action: "file.write", status: "resolved", title: null, agent_group_id: null, created_at: "2026-08-13T02:10:00Z" },
  ],
  "/api/audit": [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => ok(ROUTES[url] ?? []));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  actions.stop();
  vi.unstubAllGlobals();
});

describe("Dashboard", () => {
  it("渲染投影计数正确（群组 2 / 活跃会话 1 / 待审批 1）", async () => {
    await actions.refresh();
    render(<Dashboard />);
    const nums = document.querySelectorAll(".card .num");
    expect(nums[0]?.textContent).toBe("2");
    expect(nums[1]?.textContent).toBe("1");
    expect(nums[2]?.textContent).toBe("1");
  });

  it("拉取全部 5 个投影端点且渲染中文标题", async () => {
    await actions.refresh();
    render(<Dashboard />);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    for (const path of ["/api/groups", "/api/sessions", "/api/wirings", "/api/approvals", "/api/audit"]) {
      expect(urls).toContain(path);
    }
    expect(screen.getByText("事件直播")).toBeTruthy();
    expect(screen.getByText("活跃会话")).toBeTruthy();
  });
});

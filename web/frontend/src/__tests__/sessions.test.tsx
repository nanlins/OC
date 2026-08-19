/**
 * __tests__/sessions.test.tsx —— Sessions 组件测试（展开消息按钮 → 拉取并渲染消息）
 *
 * 关键导出：无（vitest 测试套件）
 *
 * 修改记录：2026-08-13 创建（阶段 11）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sessions } from "../pages/Sessions.js";
import { actions } from "../store/app-store.js";

const LONG_CONTENT = "x".repeat(120);

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const ROUTES: Record<string, unknown> = {
  "/api/groups": [],
  "/api/sessions": [
    { id: "s1", agent_group_id: "g1", messaging_group_id: "mg1", thread_id: null, status: "active", container_status: "running", last_active: "2026-08-13T01:00:00Z" },
  ],
  "/api/wirings": [],
  "/api/approvals": [],
  "/api/audit": [],
  "/api/sessions/s1/messages": [
    { id: "m1", kind: "user", status: "done", trigger: 0, content: LONG_CONTENT, timestamp: "2026-08-13T01:00:01Z" },
  ],
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

describe("Sessions", () => {
  it("点击消息按钮后调 sessionMessages 并渲染截断到 80 字符的内容", async () => {
    await actions.refresh();
    render(<Sessions />);
    expect(screen.getByText("s1")).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "消息" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.map((c) => c[0])).toContain("/api/sessions/s1/messages"));
    expect((await screen.findAllByText(/x{80}/)).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/x{81}/).length).toBe(0);
  });

  it("再次点击消息按钮会收起消息列表", async () => {
    await actions.refresh();
    render(<Sessions />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "消息" }));
    await screen.findAllByText(/x{80}/);
    await user.click(screen.getByRole("button", { name: "消息" }));
    await vi.waitFor(() => expect(screen.queryAllByText(/x{80}/).length).toBe(0));
  });
});

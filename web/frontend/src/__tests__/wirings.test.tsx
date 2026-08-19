/**
 * __tests__/wirings.test.tsx —— Wirings 组件测试（双选择提交 → POST /api/wirings body 正确）
 *
 * 关键导出：无（vitest 测试套件）
 *
 * 修改记录：2026-08-13 创建（阶段 11）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Wirings } from "../pages/Wirings.js";
import { actions } from "../store/app-store.js";

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const ROUTES: Record<string, unknown> = {
  "/api/groups": [
    { id: "g1", name: "alpha", folder: "/g/alpha", agent_provider: null, created_at: "2026-08-13T00:00:00Z" },
  ],
  "/api/sessions": [],
  "/api/wirings": [
    { id: "w0", messaging_group_id: "mg0", agent_group_id: "g1", engage_mode: "mention", sender_scope: "allowlist", session_mode: "per-thread", priority: 10 },
  ],
  "/api/approvals": [],
  "/api/audit": [],
  "/api/messaging-groups": [
    { id: "mg1", channel_type: "im", platform_id: "p1", instance: "default", unknown_sender_policy: "deny", denied_at: null, created_at: "2026-08-13T00:00:00Z" },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, _init?: { method?: string; body?: string }) => ok(ROUTES[url] ?? []));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  actions.stop();
  vi.unstubAllGlobals();
});

describe("Wirings", () => {
  it("渲染既有接线与两组下拉选项", async () => {
    await actions.refresh();
    render(<Wirings />);
    expect(screen.getByText("mg0")).toBeTruthy();
    expect(await screen.findByRole("option", { name: "im/p1" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "alpha" })).toBeTruthy();
  });

  it("选择后提交 POST /api/wirings 且 body 正确", async () => {
    await actions.refresh();
    render(<Wirings />);
    await screen.findByRole("option", { name: "im/p1" });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("messaging-group"), "mg1");
    await user.selectOptions(screen.getByLabelText("agent-group"), "g1");
    await user.click(screen.getByRole("button", { name: "创建接线" }));

    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBe(12));
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/wirings" && c[1]?.method === "POST");
    expect(call).toBeTruthy();
    expect(call?.[1]?.method).toBe("POST");
    expect(JSON.parse(call?.[1]?.body ?? "")).toEqual({ messagingGroupId: "mg1", agentGroupId: "g1" });
  });
});

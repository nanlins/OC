/**
 * __tests__/approvals.test.tsx —— Approvals 组件测试（待审批渲染 + 批准/拒绝 POST 断言）
 *
 * 关键导出：无（vitest 测试套件）
 *
 * 修改记录：2026-08-13 创建（阶段 11）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Approvals } from "../pages/Approvals.js";
import { actions } from "../store/app-store.js";

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const ROUTES: Record<string, unknown> = {
  "/api/groups": [],
  "/api/sessions": [],
  "/api/wirings": [],
  "/api/approvals": [
    { id: "ap1", action: "shell.exec", status: "pending", title: "rm -rf /tmp/x", agent_group_id: "g1", created_at: "2026-08-13T02:00:00Z" },
    { id: "ap2", action: "file.write", status: "resolved", title: null, agent_group_id: null, created_at: "2026-08-13T02:10:00Z" },
  ],
  "/api/audit": [],
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

function resolveCall(): [string, { method?: string; body?: string } | undefined] | undefined {
  return fetchMock.mock.calls.find((c) => c[0] === "/api/approvals/resolve") as
    | [string, { method?: string; body?: string } | undefined]
    | undefined;
}

describe("Approvals", () => {
  it("仅渲染 pending 审批且点击批准后 POST /api/approvals/resolve body 正确", async () => {
    await actions.refresh();
    render(<Approvals />);
    expect(screen.getByText("rm -rf /tmp/x")).toBeTruthy();
    expect(screen.queryByText("file.write")).toBeNull();

    await userEvent.setup().click(screen.getByRole("button", { name: "批准" }));
    await vi.waitFor(() => expect(resolveCall()).toBeTruthy());
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBe(11));
    const call = resolveCall();
    expect(call?.[1]?.method).toBe("POST");
    expect(JSON.parse(call?.[1]?.body ?? "")).toEqual({ id: "ap1", decision: "approve" });
  });

  it("点击拒绝后 POST body decision 为 reject", async () => {
    await actions.refresh();
    render(<Approvals />);
    await userEvent.setup().click(screen.getByRole("button", { name: "拒绝" }));
    await vi.waitFor(() => expect(resolveCall()).toBeTruthy());
    const call = resolveCall();
    expect(JSON.parse(call?.[1]?.body ?? "")).toEqual({ id: "ap1", decision: "reject" });
  });
});

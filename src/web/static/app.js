// app.js —— 控制台前端：轮询投影 + SSE 直播 + 审批动作
// 修改记录：2026-08-13 创建（阶段 9）
"use strict";

function rows(tableId, data, cells) {
  const tb = document.querySelector(`#${tableId} tbody`);
  tb.innerHTML = "";
  for (const r of data) {
    const tr = document.createElement("tr");
    for (const c of cells(r)) {
      const td = document.createElement("td");
      if (c instanceof Node) td.appendChild(c);
      else td.textContent = String(c ?? "");
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
}

async function refresh() {
  const [groups, sessions, approvals, audit] = await Promise.all([
    fetch("/api/groups").then((r) => r.json()),
    fetch("/api/sessions").then((r) => r.json()),
    fetch("/api/approvals").then((r) => r.json()),
    fetch("/api/audit").then((r) => r.json()),
  ]);
  rows("groups", groups, (g) => [g.id, g.name, g.folder, g.agent_provider]);
  rows("sessions", sessions, (s) => [s.id, s.agent_group_id, s.status, s.container_status, s.last_active]);
  rows("approvals", approvals.filter((a) => a.status === "pending"), (a) => {
    const approve = document.createElement("button");
    approve.textContent = "approve";
    approve.onclick = () => resolveApproval(a.id, "approve");
    const reject = document.createElement("button");
    reject.textContent = "reject";
    reject.onclick = () => resolveApproval(a.id, "reject");
    return [a.id, a.action, a.title, approve, reject];
  });
  rows("audit", audit, (a) => [a.action, a.actor, a.decision, a.reason]);
}

async function resolveApproval(id, decision) {
  await fetch("/api/approvals/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, decision }),
  });
  refresh();
}

function connectSse() {
  const es = new EventSource("/events");
  const badge = document.getElementById("sse-state");
  es.onopen = () => {
    badge.textContent = "SSE 已连接";
    badge.className = "badge on";
  };
  es.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    const li = document.createElement("li");
    li.textContent = `${data.at ?? ""} ${data.type} ${JSON.stringify(data.payload ?? {})}`;
    const ul = document.getElementById("events");
    ul.prepend(li);
    while (ul.children.length > 100) ul.removeChild(ul.lastChild);
    refresh();
  };
  es.onerror = () => {
    badge.textContent = "SSE 断开";
    badge.className = "badge off";
  };
}

refresh();
connectSse();
setInterval(refresh, 10000);

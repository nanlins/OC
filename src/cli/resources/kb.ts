/**
 * cli/resources/kb.ts —— KB 资源命令（add/sync）
 *
 * 职责：kb add 写宿主 memory-kb；kb sync 物化到群组 kb/ 目录（容器 kb_search 读取）。
 * 关键导出：registerKbResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCommand } from "../registry.js";
import { getAgentGroup } from "../../db/agent-groups.js";
import { addDocument, exportKbToDir } from "../../modules/memory-kb.js";
import { resolveGroupFolderPath } from "../../group-folder.js";
import { join } from "node:path";

export function registerKbResource(): void {
  // fix-plan：KB 资源——add 写宿主 memory-kb；sync 物化到群组 kb/ 目录（容器 kb_search 读取）
  registerCommand({
    resource: "kb",
    verb: "add",
    scope: "host",
    description: "Add a document to a host knowledge base.",
    flags: [
      { name: "kb", description: "Knowledge base name.", default: "kb" },
      { name: "title", description: "Document title.", required: true },
      { name: "text", description: "Document body.", required: true },
      { name: "source", description: "Optional provenance label." },
    ],
    handler: (args) => {
      const kb = (args.flags.kb as string) ?? "kb";
      const title = args.flags.title as string | undefined;
      const text = args.flags.text as string | undefined;
      if (!title || !text)
        throw Object.assign(new Error("kb add requires --title and --text"), { code: "invalid-args" });
      const docId = addDocument(kb, title, text, args.flags.source as string | undefined);
      return { ok: true, kb, docId };
    },
  });
  registerCommand({
    resource: "kb",
    verb: "sync",
    scope: "host",
    description: "Materialize a knowledge base into a group's kb/ dir for container kb_search.",
    flags: [
      { name: "kb", description: "Knowledge base name.", required: true },
      { name: "group", description: "Agent group id.", required: true },
    ],
    handler: (args) => {
      const kb = args.flags.kb as string | undefined;
      const groupId = args.flags.group as string | undefined;
      if (!kb || !groupId)
        throw Object.assign(new Error("kb sync requires --kb and --group"), { code: "invalid-args" });
      const group = getAgentGroup(groupId);
      if (!group) throw Object.assign(new Error(`agent group not found: ${groupId}`), { code: "not-found" });
      const kbDir = join(resolveGroupFolderPath(group.folder), "kb");
      const synced = exportKbToDir(kb, kbDir);
      return { ok: true, kb, group: group.folder, synced };
    },
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */

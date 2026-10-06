/**
 * 002-destinations.ts -- Central agent_destinations allowlist table.
 *
 * Responsibility: explicit per-group destination grants that writeDestinations()
 * folds into each session's inbound.db `destinations` projection alongside the
 * derived rows (other agent groups + wired channels). The session projection
 * stays the container-visible routing table and a2a ACL; this table is the
 * operator-managed override layer that `oc destinations add/remove` writes.
 *
 * Key exports: migration002
 * Invariant: FK to agent_groups.id with ON DELETE CASCADE -- removing a group
 * must never leave orphan grants behind (migration runner also re-checks FKs).
 *
 * Modification record:
 *   2026-10-04  Created (P2-11: incremental migration split)
 *   2026-10-05  Added `type` column; documented the projection relationship
 */
import type { Migration } from "./index.js";

export const migration002: Migration = {
  version: 2,
  name: "agent-destinations-table",
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_destinations (
        agent_group_id TEXT NOT NULL,
        destination    TEXT NOT NULL,
        type           TEXT NOT NULL DEFAULT 'agent',
        created_at     TEXT NOT NULL,
        PRIMARY KEY (agent_group_id, destination),
        FOREIGN KEY (agent_group_id) REFERENCES agent_groups(id) ON DELETE CASCADE
      );
    `);
  },
};

/*
 * Modification record:
 *   2026-10-04  Created (P2-11: incremental migration for agent_destinations)
 *   2026-10-05  Added type/created_at columns for the projection override layer
 */

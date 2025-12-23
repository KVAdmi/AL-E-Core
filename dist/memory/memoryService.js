"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRelevantMemories = getRelevantMemories;
exports.saveMemory = saveMemory;
// src/services/memoryService.ts
const client_1 = require("../db/client");
const TABLE = 'public.ae_memory';
async function getRelevantMemories(workspaceId, userId, mode, limit = 20) {
    try {
        const { rows } = await client_1.db.query(`
      SELECT memory
      FROM ${TABLE}
      WHERE workspace_id = $1
        AND user_id_uuid = $2
        AND mode = $3
      ORDER BY created_at DESC
      LIMIT $4;
      `, [workspaceId, userId, mode, limit]);
        return rows.map((r) => r.memory);
    }
    catch (err) {
        console.error('[MemoryService] Error leyendo memorias:', err);
        return [];
    }
}
async function saveMemory(memory) {
    const importance = memory.importance ?? 1;
    try {
        await client_1.db.query(`
      INSERT INTO ${TABLE} (workspace_id, user_id_uuid, mode, memory, importance)
      VALUES ($1, $2, $3, $4, $5);
      `, [
            memory.workspaceId,
            memory.userId,
            memory.mode,
            memory.memory,
            importance,
        ]);
        console.log('[MemoryService] Memoria guardada:', memory.workspaceId, memory.userId, memory.mode);
    }
    catch (err) {
        console.error('[MemoryService] Error guardando memoria:', err);
    }
}

// src/services/memoryService.ts
import { db as pool } from '../db/client';

export type AssistantMemory = {
  workspaceId: string;
  userId: string;
  mode: string;
  memory: string;
  importance?: number;
};

const TABLE = 'public.ae_memory';

export async function getRelevantMemories(
  workspaceId: string,
  userId: string,
  mode: string,
  limit: number = 20
): Promise<string[]> {
  try {
    const { rows } = await pool.query(
      `
      SELECT memory
      FROM ${TABLE}
      WHERE workspace_id = $1
        AND user_id_uuid = $2
        AND mode = $3
      ORDER BY created_at DESC
      LIMIT $4;
      `,
      [workspaceId, userId, mode, limit]
    );

    return rows.map((r) => r.memory as string);
  } catch (err) {
    console.error('[MemoryService] Error leyendo memorias:', err);
    return [];
  }
}

export async function saveMemory(memory: AssistantMemory): Promise<void> {
  const importance = memory.importance ?? 1;

  try {
    await pool.query(
      `
      INSERT INTO ${TABLE} (workspace_id, user_id_uuid, mode, memory, importance)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [
        memory.workspaceId,
        memory.userId,
        memory.mode,
        memory.memory,
        importance,
      ]
    );

    console.log(
      '[MemoryService] Memoria guardada:',
      memory.workspaceId,
      memory.userId,
      memory.mode
    );
  } catch (err) {
    console.error('[MemoryService] Error guardando memoria:', err);
  }
}
import { Request, Response } from 'express';
import { db } from '../db/client';

export async function getDebugMemories(req: Request, res: Response) {
  try {
    const result = await db.query(`
      SELECT *
      FROM public.assistant_memories
      ORDER BY created_at DESC
      LIMIT 10;
    `);

    return res.json({
      ok: true,
      rows: result.rows,
      count: result.rowCount
    });

  } catch (error: any) {
    console.error('[DebugMemories][ERROR]', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
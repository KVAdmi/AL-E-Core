"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDebugMemories = getDebugMemories;
const client_1 = require("../db/client");
async function getDebugMemories(req, res) {
    try {
        const result = await client_1.db.query(`
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
    }
    catch (error) {
        console.error('[DebugMemories][ERROR]', error);
        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
}

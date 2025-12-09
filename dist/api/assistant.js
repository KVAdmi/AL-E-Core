"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assistantRouter = void 0;
const express_1 = __importDefault(require("express"));
const assistantService_1 = require("../services/assistantService");
const memoryService_1 = require("../memory/memoryService");
const os = __importStar(require("os"));
const router = express_1.default.Router();
exports.assistantRouter = router;
/**
 * GET /api/ai/ping
 * Endpoint de diagnóstico inmediato
 */
router.get('/ping', (req, res) => {
    res.json({
        ok: true,
        message: "AL-E Core vivo",
        timestamp: Date.now()
    });
});
/**
 * POST /api/ai/chat
 * Endpoint principal para interactuar con L.U.C.I / AL-E
 */
router.post('/chat', async (req, res) => {
    console.log("[AL-E CORE] Chat endpoint invocado");
    console.log("[AL-E CHAT] Request recibido");
    console.log("Headers:", req.headers);
    console.log("Body:", req.body);
    console.log("[AL-E CORE] Body recibido:", req.body);
    try {
        // Extraer y validar payload
        const payload = {
            workspaceId: req.body.workspaceId,
            userId: req.body.userId,
            mode: req.body.mode,
            messages: req.body.messages
        };
        // Log del payload recibido antes de procesar
        console.log("[AL-E CORE] /api/ai/chat payload recibido:", {
            hasMessages: !!payload.messages,
            messagesLength: Array.isArray(payload.messages) ? payload.messages.length : "n/a",
            workspaceId: payload.workspaceId,
            userId: payload.userId,
            mode: payload.mode
        });
        // Validación básica de estructura
        if (!payload.messages || !Array.isArray(payload.messages)) {
            return res.status(400).json({
                error: "INVALID_MESSAGES",
                message: "messages debe ser un array con al menos un mensaje de usuario"
            });
        }
        // Validar que haya al menos un mensaje de usuario y que no esté vacío
        const hasUserMessage = payload.messages.some(msg => msg.role === 'user');
        if (payload.messages.length === 0 || !hasUserMessage) {
            return res.status(400).json({
                error: "NO_USER_MESSAGE",
                message: "Debe incluir al menos un mensaje con role 'user'"
            });
        }
        // GUARDAR MEMORIA: Último mensaje del usuario
        const lastUserMessage = payload.messages
            .filter((m) => m.role === 'user')
            .slice(-1)[0]; // Usar slice(-1)[0] en lugar de .at(-1)
        if (lastUserMessage && typeof lastUserMessage.content === 'string') {
            // Por ahora, guardamos SIEMPRE el último mensaje del usuario como memoria
            await (0, memoryService_1.saveMemory)({
                workspaceId: payload.workspaceId || 'default',
                userId: payload.userId || 'anonymous',
                mode: payload.mode || 'universal',
                memory: lastUserMessage.content,
                importance: 1,
            });
        }
        // Procesar solicitud
        const response = await (0, assistantService_1.processAssistantRequest)(payload);
        // Reconocimiento simple de acciones basado en texto
        function detectActions(text) {
            const actions = [];
            const t = (text || '').toLowerCase();
            // Citas
            if (/(agend(a|ar)|cita|reunión|appointment)/.test(t)) {
                actions.push({ type: 'CREATE_APPOINTMENT', payload: {} });
            }
            if (/(reprogram(a|ar)|mueve|cambia|update).*(cita|reunión|appointment)/.test(t)) {
                actions.push({ type: 'UPDATE_APPOINTMENT', payload: {} });
            }
            // Tareas
            if (/(tarea|task|pendiente).*(crear|create)/.test(t) || /(crear|create).*(tarea|task)/.test(t)) {
                actions.push({ type: 'CREATE_TASK', payload: {} });
            }
            if (/(actualiza|update|modifica|editar).*(tarea|task)/.test(t)) {
                actions.push({ type: 'UPDATE_TASK', payload: {} });
            }
            // Recordatorios
            if (/(recordatorio|reminder).*(crear|create)/.test(t) || /(crear|create).*(recordatorio|reminder)/.test(t)) {
                actions.push({ type: 'CREATE_REMINDER', payload: {} });
            }
            if (/(actualiza|update|modifica).*(recordatorio|reminder)/.test(t)) {
                actions.push({ type: 'UPDATE_REMINDER', payload: {} });
            }
            // Documentos
            if (/(documento|contrato|informe|reporte).*(gener(a|ar)|create|generate)/.test(t) || /(gener(a|ar)|create|generate).*(documento|contrato|informe|reporte)/.test(t)) {
                actions.push({ type: 'GENERATE_DOCUMENT', payload: {} });
            }
            return actions;
        }
        // Heurística simple de memorias: detectar frases tipo "mi nombre es ...", "vivo en ...", "mi correo es ..."
        function detectMemories(text) {
            const memories = [];
            const matchName = text.match(/mi nombre es\s+([A-Za-zÀ-ÿ'\-\s]+)/i);
            if (matchName)
                memories.push({ kind: 'user_name', value: matchName[1].trim() });
            const matchCity = text.match(/(vivo en|resido en)\s+([A-Za-zÀ-ÿ'\-\s]+)/i);
            if (matchCity)
                memories.push({ kind: 'user_city', value: matchCity[2].trim() });
            const matchEmail = text.match(/mi correo es\s+([\w._%+-]+@[\w.-]+\.[A-Za-z]{2,})/i);
            if (matchEmail)
                memories.push({ kind: 'user_email', value: matchEmail[1].trim() });
            return memories;
        }
        const userLastMsg = (payload.messages || []).filter(m => m.role === 'user').slice(-1)[0];
        const userText = userLastMsg?.content || '';
        // Extracción de detalles para citas
        function extractAppointmentDetails(userMessage) {
            const text = userMessage || '';
            const t = text.trim();
            // Fecha y hora
            let date = null;
            let time = null;
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const toYYYYMMDD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            if (/\bmañana\b/i.test(t)) {
                const d = new Date(now);
                d.setDate(d.getDate() + 1);
                date = toYYYYMMDD(d);
            }
            else if (/\bhoy\b/i.test(t)) {
                date = toYYYYMMDD(now);
            }
            else if (/\bpasado mañana\b/i.test(t)) {
                const d = new Date(now);
                d.setDate(d.getDate() + 2);
                date = toYYYYMMDD(d);
            }
            // Hora: HH:mm o formatos comunes "a las 10", "a las 10:30", con am/pm
            const timeMatch = t.match(/\b(\d{1,2})(:(\d{2}))?\b\s*(am|pm)?/i);
            if (timeMatch) {
                let hour = parseInt(timeMatch[1], 10);
                const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
                const ampm = timeMatch[4]?.toLowerCase();
                if (ampm === 'pm' && hour < 12)
                    hour += 12;
                if (ampm === 'am' && hour === 12)
                    hour = 0;
                time = `${pad(hour)}:${pad(minute)}`;
            }
            // Ubicación
            let location = null;
            const locMatch = t.match(/(en\s+|ubicaci[óo]n:\s*)([A-Za-zÀ-ÿ0-9'\-\s]+)/i);
            if (locMatch) {
                location = locMatch[2].trim();
            }
            else if (/\b(dentista|doctor|cl[ií]nica|oficina)\b/i.test(t)) {
                location = t.match(/\b(dentista|doctor|cl[ií]nica|oficina)\b/i)?.[0] || null;
            }
            // Título y notas
            let title = 'Cita';
            if (/dentista/i.test(t))
                title = 'Cita con el dentista';
            else if (/reuni[óo]n/i.test(t))
                title = 'Reunión';
            else if (/cita/i.test(t))
                title = 'Cita';
            const notes = t;
            return { title, date, time, location, notes };
        }
        // Detectar intención de crear cita y construir acción con detalles
        const actions = [];
        const appointmentIntent = /(agend(ar|a)\s+(una\s+)?cita|program(ar|a)\s+(una\s+)?reuni[óo]n|cita\s+(mañana|hoy|pasado mañana|el)\b|cita\s+con\s+el\s+dentista)/i.test(userText);
        if (appointmentIntent) {
            const details = extractAppointmentDetails(userText);
            actions.push({
                type: 'CREATE_APPOINTMENT',
                payload: {
                    title: details.title,
                    date: details.date,
                    time: details.time,
                    location: details.location,
                    notes: details.notes
                }
            });
        }
        else {
            const genericActions = detectActions(userText + '\n' + (response.content || ''));
            genericActions.forEach(a => actions.push(a));
        }
        const memories_to_add = detectMemories(userText + '\n' + (response.content || ''));
        // Respuesta normalizada
        res.json({
            answer: response.content || '',
            actions,
            memories_to_add
        });
    }
    catch (error) {
        // Log completo del error
        if (error instanceof Error) {
            console.error('[ASSISTANT_ERROR] /api/ai/chat:', error.stack || error);
        }
        else {
            console.error('[ASSISTANT_ERROR] /api/ai/chat:', error);
        }
        // Respuesta de error más clara y controlada
        res.status(500).json({
            error: 'ASSISTANT_ERROR',
            message: error instanceof Error ? (error.message || 'Error interno en AL-E Core') : 'Error interno en AL-E Core',
            timestamp: new Date().toISOString()
        });
    }
});
/**
 * GET /api/ai/ping
 * Endpoint de diagnóstico inmediato
 */
router.get('/ping', async (req, res) => {
    return res.json({
        ok: true,
        message: "AL-E Core vivo",
        timestamp: Date.now()
    });
});
/**
 * GET /api/ai/status
 * Endpoint para verificar el estado del servicio de asistente
 */
router.get('/status', async (req, res) => {
    try {
        res.json({
            status: 'ok',
            service: 'AL-E Assistant',
            version: '1.0.0',
            modes: ['universal', 'legal', 'medico', 'seguros', 'contabilidad'],
            provider: 'openai',
            memory: {
                enabled: true,
                connection: 'ok',
                schema: 'public.assistant_memories'
            },
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        console.error('Error en status endpoint:', error);
        res.status(500).json({
            status: 'error',
            service: 'AL-E Assistant',
            error: error instanceof Error ? error.message : 'Error desconocido',
            timestamp: new Date().toISOString()
        });
    }
});
/**
 * GET /api/ai/memories
 * Endpoint para verificar memorias guardadas (debug)
 */
router.get('/memories', async (req, res) => {
    try {
        const { workspaceId, userId, mode, limit } = req.query;
        const { getRelevantMemories } = await Promise.resolve().then(() => __importStar(require('../memory/memoryService')));
        const memories = await getRelevantMemories(workspaceId || 'default', userId || 'anonymous', mode || 'universal', parseInt(limit) || 10);
        res.json({
            memories,
            count: memories.length,
            query: { workspaceId, userId, mode, limit }
        });
    }
    catch (error) {
        console.error('Error obteniendo memorias:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
});
/**
 * GET /api/ai/debugtest
 * Endpoint simple de prueba
 */
router.get('/debugtest', async (req, res) => {
    try {
        res.json({
            message: "Debug test endpoint working",
            timestamp: new Date().toISOString()
        });
    }
    catch (err) {
        console.error('[DebugTest][ERROR]', err);
        res.status(500).json({
            error: 'Error in debug test'
        });
    }
});
/**
 * GET /api/ai/debug/ip
 * Endpoint de prueba de red simple
 */
router.get('/debug/ip', async (req, res) => {
    try {
        const os = await Promise.resolve().then(() => __importStar(require('os')));
        const networkInterfaces = os.networkInterfaces();
        let serverIp = null;
        for (const [name, interfaces] of Object.entries(networkInterfaces)) {
            if (interfaces) {
                for (const iface of interfaces) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        serverIp = iface.address;
                        break;
                    }
                }
            }
            if (serverIp)
                break;
        }
        return res.json({
            serverHost: req.hostname,
            serverIp: serverIp,
            publicIp: null
        });
    }
    catch (err) {
        return res.status(500).json({
            error: err instanceof Error ? err.message : String(err)
        });
    }
});
/**
 * GET /api/ai/debug/outbound
 * Endpoint para probar conectividad externa
 */
router.get('/debug/outbound', async (req, res) => {
    try {
        const response = await fetch("https://api.ipify.org?format=json");
        const data = await response.json();
        return res.json({ ok: true, ip: data.ip });
    }
    catch (err) {
        return res.status(500).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err)
        });
    }
});
/**
 * GET /api/ai/debug/memories
 * Endpoint para debug directo de la tabla assistant_memories
 */
router.get('/debug/memories', async (req, res) => {
    try {
        const { db: pool } = await Promise.resolve().then(() => __importStar(require('../db/client')));
        const result = await pool.query(`
      SELECT id, workspace_id, user_id, mode, memory, importance, created_at
      FROM public.assistant_memories
      ORDER BY created_at DESC
      LIMIT 5;
    `);
        return res.json({ rows: result.rows });
    }
    catch (err) {
        console.error('[DebugMemories][ERROR]', err);
        return res.status(500).json({
            message: 'Error accessing memories table',
            error: err instanceof Error ? err.message : String(err)
        });
    }
});
/**
 * GET /api/ai/debug/ip
 * Endpoint de prueba de red simple
 */
router.get('/debug/ip', (req, res) => {
    const interfaces = os.networkInterfaces();
    let serverIp = 'unknown';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                serverIp = iface.address;
                break;
            }
        }
    }
    res.json({
        serverHost: req.hostname,
        serverIp: serverIp,
        publicIp: null
    });
});
/**
 * GET /api/ai/debug/outbound
 * Prueba de conectividad externa
 */
router.get('/debug/outbound', async (req, res) => {
    try {
        const response = await fetch("https://api.ipify.org?format=json");
        const data = await response.json();
        res.json({ ok: true, ip: data.ip });
    }
    catch (err) {
        res.status(500).json({
            ok: false,
            error: err instanceof Error ? err.message : String(err)
        });
    }
});

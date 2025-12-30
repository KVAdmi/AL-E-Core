"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const multer_1 = __importDefault(require("multer"));
const env_1 = require("./config/env");
const chat_1 = __importDefault(require("./api/chat")); // NUEVO endpoint con guardado garantizado
const files_1 = __importDefault(require("./api/files")); // Endpoint de ingesta estructural
const voice_1 = require("./api/voice");
const sessions_1 = require("./api/sessions");
const memory_1 = __importDefault(require("./api/memory")); // Memoria explícita
const profile_1 = __importDefault(require("./api/profile")); // Personalización de usuario
const health_1 = __importDefault(require("./api/health")); // Health checks
const email_1 = __importDefault(require("./api/email")); // Email accounts (SMTP/IMAP manual)
const mail_1 = __importDefault(require("./api/mail")); // Mail send/inbox
const calendar_1 = __importDefault(require("./api/calendar")); // Calendario interno
const telegram_1 = __importDefault(require("./api/telegram")); // Telegram bot por usuario
const runtime_capabilities_1 = __importDefault(require("./api/runtime-capabilities")); // Runtime capabilities
const documentText_1 = require("./utils/documentText");
const notificationWorker_1 = require("./workers/notificationWorker");
const app = (0, express_1.default)();
// Configurar multer para subida de archivos en memoria
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024, // 15MB por archivo
        files: 5 // Máximo 5 archivos
    },
});
// CORS configurado usando ALE_ALLOWED_ORIGINS
const allowedOrigins = process.env.ALE_ALLOWED_ORIGINS
    ? process.env.ALE_ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [
        'https://al-eon.com',
        'http://localhost:3000',
        'http://localhost:3001'
    ];
const netlifyRegex = /^https:\/\/.+\.netlify\.app$/;
console.log('[CORS] Orígenes permitidos:', allowedOrigins);
// Configuración CORS exacta como se especificó
const corsOptions = {
    origin: (origin, callback) => {
        console.log('[CORS] Verificando origin:', origin);
        // Permitir requests sin origin (mobile apps, Postman, etc.)
        if (!origin) {
            console.log('[CORS] Origin sin definir - PERMITIDO');
            return callback(null, true);
        }
        // Verificar si el origin está en la lista de permitidos
        if (allowedOrigins.includes(origin)) {
            console.log('[CORS] Origin en lista permitida - PERMITIDO:', origin);
            return callback(null, true);
        }
        // Verificar si es un dominio de Netlify
        if (netlifyRegex.test(origin)) {
            console.log('[CORS] Origin Netlify - PERMITIDO:', origin);
            return callback(null, true);
        }
        console.log('[CORS] Origin BLOQUEADO:', origin);
        console.log('[CORS] Lista de permitidos:', allowedOrigins);
        callback(new Error('Not allowed by CORS: ' + origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
// Configurar CORS globalmente
app.use((0, cors_1.default)(corsOptions));
// Middleware específico para manejar preflight OPTIONS en todas las rutas
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        const origin = req.headers.origin;
        console.log('[OPTIONS] Handling preflight for:', req.path, 'from origin:', origin);
        if (!origin || allowedOrigins.includes(origin) || (origin && netlifyRegex.test(origin))) {
            res.header('Access-Control-Allow-Origin', origin || '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, DELETE');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.header('Access-Control-Allow-Credentials', 'true');
            return res.sendStatus(200);
        }
        return res.sendStatus(403);
    }
    next();
});
app.use(express_1.default.json({ limit: '10mb' }));
// Middleware para procesar archivos en /api/ai/chat
app.use('/api/ai/chat', upload.array('files', 5), async (req, res, next) => {
    try {
        const files = req.files || [];
        if (files.length > 0) {
            console.log(`[UPLOAD] ${files.length} archivo(s) recibido(s)`);
            // Extraer texto de los archivos
            const docs = await (0, documentText_1.extractTextFromFiles)(files);
            // Parsear messages si viene como string (multipart/form-data)
            let messages = req.body.messages;
            if (typeof messages === 'string') {
                messages = JSON.parse(messages);
            }
            // Inyectar documentos como contexto en el primer mensaje del sistema
            if (docs.length && Array.isArray(messages)) {
                const docsBlock = (0, documentText_1.documentsToContext)(docs);
                messages = [
                    {
                        role: "system",
                        content: "Tienes documentos adjuntos. Analízalos y responde basándote en su contenido.\n" +
                            docsBlock,
                    },
                    ...messages,
                ];
                req.body.messages = messages;
                console.log(`[UPLOAD] ${docs.length} documento(s) procesado(s) e inyectados en el contexto`);
            }
        }
        // Normalizar campos que pueden venir como string en multipart
        if (req.body.workspaceId)
            req.body.workspaceId = String(req.body.workspaceId);
        if (req.body.workspace_id)
            req.body.workspace_id = String(req.body.workspace_id);
        if (req.body.userId)
            req.body.userId = String(req.body.userId);
        if (req.body.user_id)
            req.body.user_id = String(req.body.user_id);
        if (req.body.mode)
            req.body.mode = String(req.body.mode);
        if (req.body.sessionId)
            req.body.sessionId = String(req.body.sessionId);
        if (req.body.session_id)
            req.body.session_id = String(req.body.session_id);
        next();
    }
    catch (err) {
        console.error('[UPLOAD] Error procesando archivos:', err);
        res.status(500).json({
            error: 'FILE_PROCESSING_ERROR',
            detail: err instanceof Error ? err.message : String(err)
        });
    }
});
app.get("/health", async (req, res) => {
    try {
        const status = {
            status: "ok",
            service: "al-e-core",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            }
        };
        // Test DB opcional (comentado para evitar delay en health checks)
        // try {
        //   await supabase.from('ae_sessions').select('id').limit(1);
        //   status.database = 'connected';
        // } catch (err) {
        //   status.database = 'error';
        // }
        res.json(status);
    }
    catch (error) {
        res.status(503).json({
            status: 'error',
            service: 'al-e-core',
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// app.use("/lia", liaRouter);
app.use("/_health", health_1.default); // Health checks protegidos
app.use("/api/ai", chat_1.default); // Nuevo endpoint con guardado garantizado en Supabase
app.use("/api/files", files_1.default); // Endpoint de ingesta estructural de documentos
app.use("/api/voice", voice_1.voiceRouter);
app.use("/api/sessions", sessions_1.sessionsRouter);
app.use("/api/memory", memory_1.default); // Memoria explícita (acuerdos/decisiones/hechos)
app.use("/api/profile", profile_1.default); // Personalización de usuario
app.use("/api/email", email_1.default); // Email accounts (SMTP/IMAP manual)
app.use("/api/mail", mail_1.default); // Mail send/inbox
app.use("/api/email", mail_1.default); // Mail send/inbox TAMBIÉN en /api/email (para compatibilidad frontend)
app.use("/api/calendar", calendar_1.default); // Calendario interno
app.use("/api/telegram", telegram_1.default); // Telegram bot por usuario
app.use("/api/runtime-capabilities", runtime_capabilities_1.default); // Runtime capabilities
// Log simple de verificación
console.log("[DEBUG] healthRouter montado en /_health");
console.log("[DEBUG] chatRouter (v2) montado en /api/ai");
console.log("[DEBUG] filesRouter (ingest) montado en /api/files");
console.log("[DEBUG] voiceRouter montado en /api/voice");
console.log("[DEBUG] sessionsRouter montado en /api/sessions");
console.log("[DEBUG] memoryRouter montado en /api/memory");
console.log("[DEBUG] profileRouter montado en /api/profile");
console.log("[DEBUG] emailRouter montado en /api/email");
console.log("[DEBUG] mailRouter montado en /api/mail");
console.log("[DEBUG] calendarRouter montado en /api/calendar");
console.log("[DEBUG] runtimeCapabilitiesRouter montado en /api/runtime-capabilities");
console.log("[DEBUG] telegramRouter montado en /api/telegram");
const PORT = env_1.env.port || 4000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`[AL-E CORE] Servidor iniciado en puerto ${PORT}`);
    console.log(`[AL-E CORE] Iniciado en http://localhost:${PORT}`);
    console.log("[AL-E CORE] Servidor iniciado en:", "0.0.0.0", "puerto:", PORT);
    console.log("[AL-E CORE] URL base:", process.env.ALE_CORE_URL || "localhost");
    console.log(`AL-E Core listening on port ${PORT}`);
    // Iniciar notification worker
    console.log('[AL-E CORE] Iniciando notification worker...');
    (0, notificationWorker_1.startNotificationWorker)();
});

import express from "express";
import cors from "cors";
import { env } from "./config/env";
// import { liaRouter } from "./lia/liaRouter";
import { assistantRouter } from "./api/assistant";

const app = express();

// CORS configurado usando ALE_ALLOWED_ORIGINS
const allowedOrigins = process.env.ALE_ALLOWED_ORIGINS
  ? process.env.ALE_ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

app.get("/health", (req, res) => {
	res.json({ status: "ok", service: "al-e-core", timestamp: new Date().toISOString() });
});

// app.use("/lia", liaRouter);
app.use("/api/ai", assistantRouter);

// Log simple de verificación
console.log("[DEBUG] assistantRouter montado en /api/ai");

const PORT = env.port || 4000;

app.listen(PORT, "0.0.0.0", () => {
	console.log(`[AL-E CORE] Servidor iniciado en puerto ${PORT}`);
	console.log(`[AL-E CORE] Iniciado en http://localhost:${PORT}`);
	console.log("[AL-E CORE] Servidor iniciado en:", "0.0.0.0", "puerto:", PORT);
	console.log("[AL-E CORE] URL base:", process.env.ALE_CORE_URL || "localhost");
	console.log(`AL-E Core listening on port ${PORT}`);
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Cargar .env desde la raíz del proyecto (no desde dist/)
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "../../.env") });
function ensure(value, name) {
    if (value === undefined || value === "") {
        throw new Error(`Falta la variable de entorno crítica: ${name}`);
    }
    return value;
}
exports.env = {
    port: parseInt(process.env.PORT || "3000", 10),
    openaiApiKey: process.env.OPENAI_API_KEY || "", // OPCIONAL: No usamos OpenAI, usamos Groq/Fireworks/Together
    supabaseUrl: ensure(process.env.SUPABASE_URL, "SUPABASE_URL"),
    supabaseAnonKey: ensure(process.env.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: ensure(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    assistantId: process.env.ASSISTANT_ID || "al-e",
    defaultWorkspaceId: process.env.DEFAULT_WORKSPACE_ID || "default",
    defaultMode: process.env.DEFAULT_MODE || "universal",
};

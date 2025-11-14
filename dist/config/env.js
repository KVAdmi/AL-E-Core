"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function ensure(value, name) {
    if (value === undefined || value === "") {
        throw new Error(`Falta la variable de entorno crítica: ${name}`);
    }
    return value;
}
exports.env = {
    port: parseInt(process.env.PORT || "3000", 10),
    openaiApiKey: ensure(process.env.OPENAI_API_KEY, "OPENAI_API_KEY"),
    supabaseUrl: ensure(process.env.SUPABASE_URL, "SUPABASE_URL"),
    supabaseAnonKey: ensure(process.env.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY"),
};

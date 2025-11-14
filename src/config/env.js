import dotenv from "dotenv";
dotenv.config();
function ensure(value, name) {
    if (value === undefined || value === "") {
        throw new Error(`Falta la variable de entorno crítica: ${name}`);
    }
    return value;
}
export const env = {
    port: parseInt(process.env.PORT || "3000", 10),
    openaiApiKey: ensure(process.env.OPENAI_API_KEY, "OPENAI_API_KEY"),
    supabaseUrl: ensure(process.env.SUPABASE_URL, "SUPABASE_URL"),
    supabaseAnonKey: ensure(process.env.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY"),
};
//# sourceMappingURL=env.js.map
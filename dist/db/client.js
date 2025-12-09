"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
// Asegurar que las variables de entorno estén cargadas
dotenv_1.default.config();
/**
 * Cliente directo de PostgreSQL para AL-E Core
 * Conecta directamente a la base de datos de Supabase sin usar el SDK
 */
class DatabaseClient {
    constructor() {
        const connectionString = process.env.ALE_DB_URL;
        if (!connectionString) {
            throw new Error('ALE_DB_URL no está configurada en las variables de entorno');
        }
        // Eliminar sslmode=require de la URL y manejar SSL manualmente
        const cleanConnectionString = connectionString.replace(/[?&]sslmode=require/, '');
        this.pool = new pg_1.Pool({
            connectionString: cleanConnectionString,
            ssl: {
                rejectUnauthorized: false // Necesario para Supabase
            },
            max: 10, // Máximo de conexiones en el pool
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
        // Manejar errores del pool
        this.pool.on('error', (err) => {
            console.error('Error inesperado en el pool de conexiones:', err);
        });
    }
    static getInstance() {
        if (!DatabaseClient.instance) {
            DatabaseClient.instance = new DatabaseClient();
        }
        return DatabaseClient.instance;
    }
    /**
     * Ejecuta una consulta SQL
     */
    async query(text, params) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(text, params);
            return result;
        }
        finally {
            client.release();
        }
    }
    /**
     * Cierra todas las conexiones del pool
     */
    async close() {
        await this.pool.end();
    }
    /**
     * Verifica la conexión
     */
    async testConnection() {
        try {
            await this.query('SELECT 1');
            return true;
        }
        catch (error) {
            console.error('Error probando conexión a DB:', error);
            return false;
        }
    }
}
// Exportar instancia singleton
exports.db = DatabaseClient.getInstance();

import { Pool } from 'pg';
import dotenv from 'dotenv';

// Asegurar que las variables de entorno estén cargadas
dotenv.config();

/**
 * Cliente directo de PostgreSQL para AL-E Core
 * Conecta directamente a la base de datos de Supabase sin usar el SDK
 */
class DatabaseClient {
  private pool: Pool;
  private static instance: DatabaseClient;

  private constructor() {
    const connectionString = process.env.ALE_DB_URL;
    
    if (!connectionString) {
      throw new Error('ALE_DB_URL no está configurada en las variables de entorno');
    }

    // Eliminar sslmode=require de la URL y manejar SSL manualmente
    const cleanConnectionString = connectionString.replace(/[?&]sslmode=require/, '');

    this.pool = new Pool({
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

  public static getInstance(): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient();
    }
    return DatabaseClient.instance;
  }

  /**
   * Ejecuta una consulta SQL
   */
  async query(text: string, params?: any[]): Promise<any> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Cierra todas las conexiones del pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Verifica la conexión
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch (error) {
      console.error('Error probando conexión a DB:', error);
      return false;
    }
  }
}

// Exportar instancia singleton
export const db = DatabaseClient.getInstance();
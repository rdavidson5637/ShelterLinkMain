const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables from .env if present
dotenv.config();

// MAMP defaults (phpMyAdmin) commonly use port 8889 with root/root
const {
  DB_HOST = 'localhost',
  DB_PORT = '8889',
  DB_USER = 'root',
  DB_PASSWORD = 'root',
  DB_NAME = 'ShelterLink',
  DB_CONNECTION_LIMIT = '10',
  DB_WAIT_FOR_CONNECTIONS = 'true',
  DB_QUEUE_LIMIT = '0',
} = process.env;

/**
 * Create a MySQL connection pool
 */
const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: DB_WAIT_FOR_CONNECTIONS === 'true',
  connectionLimit: Number(DB_CONNECTION_LIMIT),
  queueLimit: Number(DB_QUEUE_LIMIT),
  timezone: 'Z',
  dateStrings: true,
});

/**
 * Test database connectivity by executing a simple query.
 * @returns {Promise<boolean>} true if connection works; throws on failure
 */
async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT 1 AS ok');
    if (!rows || !rows.length) throw new Error('Health check query returned no rows');
    return true;
  } catch (error) {
    // Log a concise but helpful message for operators
    console.error('[DB] Connection test failed:', {
      message: error.message,
      code: error.code,
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      database: DB_NAME,
    });
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  pool,
  testConnection,
};



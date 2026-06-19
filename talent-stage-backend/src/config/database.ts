import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

// Pool that connects to a specific database (used at runtime)
const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'talents_stage',
  waitForConnections: true,
  connectionLimit:    20,
  queueLimit:         0,
  charset:            'utf8mb4',
  timezone:           '+00:00',
});

export const testConnection = async (): Promise<void> => {
  try {
    const conn = await pool.getConnection();
    console.log('✅  MySQL connected  →', process.env.DB_HOST + ':' + (process.env.DB_PORT || '3306'));
    conn.release();
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('ECONNREFUSED')) {
      console.error('❌  Cannot reach MySQL — is it running?\n    Host:', process.env.DB_HOST, 'Port:', process.env.DB_PORT || 3306);
    } else if (msg.includes('ER_ACCESS_DENIED')) {
      console.error('❌  MySQL access denied — check DB_USER / DB_PASSWORD in .env');
    } else if (msg.includes('ER_BAD_DB_ERROR') || msg.includes('Unknown database')) {
      console.error('❌  Database "' + (process.env.DB_NAME || 'talents_stage') + '" does not exist — run:  npm run db:migrate');
    } else {
      console.error('❌  MySQL error:', msg);
    }
    throw err;
  }
};

export default pool;

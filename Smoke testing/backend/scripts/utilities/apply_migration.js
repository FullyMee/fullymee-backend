const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5
});

async function ensureMigrationsTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

function splitStatements(sql) {
  return sql
    .split(/;\s*\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applyMigration() {
  try {
    await ensureMigrationsTable();

    const migrationsDir = path.resolve(__dirname, './migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const [done] = await pool.query(
        `SELECT 1 FROM schema_migrations WHERE filename = ? LIMIT 1`,
        [file]
      );

      if (done.length) {
        continue;
      }

      const sqlPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      const statements = splitStatements(sql);

      for (const stmt of statements) {
        await pool.query(stmt);
      }

      await pool.query(
        `INSERT INTO schema_migrations (filename) VALUES (?)`,
        [file]
      );

      console.log(`Applied migration: ${file}`);
    }

    console.log('All pending migrations applied successfully.');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err && err.message ? err.message : err);
    try { await pool.end(); } catch (_) {}
    process.exit(1);
  }
}

applyMigration();

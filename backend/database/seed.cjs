require('dotenv/config');
const { randomBytes, scryptSync } = require('node:crypto');
const mysql = require('mysql2/promise');
async function seed() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'hourcontdan',
  });
  try {
    for (const [name, email, role] of [
      ['Valentina Ríos', 'admin@example.test', 'admin'],
      ['Mateo Salazar', 'gerente@example.test', 'manager'],
      ['Lucía Castro', 'empleado@example.test', 'employee'],
    ]) {
      const salt = randomBytes(16).toString('hex');
      const hash = salt + ':' + scryptSync('DemoHour2026!', salt, 64).toString('hex');
      await db.execute('INSERT INTO employees (name, email, role, password_hash) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id', [name, email, role, hash]);
    }
    console.log('Cuentas de demostración disponibles.');
  } finally { await db.end(); }
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; });

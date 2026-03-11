const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function runMigrations() {
  console.log('🚀 Ejecutando migraciones...\n');

  const migrationsDir = path.join(__dirname);
  const sqlFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of sqlFiles) {
    console.log(`📄 Ejecutando: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
      await pool.query(sql);
      console.log(`✅ ${file} ejecutado correctamente\n`);
    } catch (err) {
      console.error(`❌ Error en ${file}:`, err.message);
      process.exit(1);
    }
  }

  console.log('✅ Todas las migraciones completadas');
  process.exit(0);
}

runMigrations();

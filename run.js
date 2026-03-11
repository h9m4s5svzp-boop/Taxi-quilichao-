const fs = require('fs');
const pool = require('./database');

async function run() {
  console.log('🚀 Ejecutando migraciones...');
  const files = ['001_crear_tablas.sql','002_push_token.sql'];
  for (const file of files) {
    if (!fs.existsSync(file)) { console.log(`⚠️ No encontrado: ${file}`); continue; }
    console.log(`📄 Ejecutando: ${file}`);
    try {
      await pool.query(fs.readFileSync(file, 'utf8'));
      console.log(`✅ ${file} OK`);
    } catch (err) {
      console.error(`❌ Error en ${file}:`, err.message);
      process.exit(1);
    }
  }
  console.log('✅ Migraciones completas');
  process.exit(0);
}
run();

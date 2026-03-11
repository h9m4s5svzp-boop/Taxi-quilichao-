const pool = require('../config/database');
const bcrypt = require('bcryptjs');

async function seed() {
  console.log('🌱 Insertando datos de prueba...\n');

  const password = await bcrypt.hash('password123', 10);

  try {
    // Admin
    await pool.query(`
      INSERT INTO usuarios (nombre, apellido, telefono, email, password_hash, rol)
      VALUES ('Admin', 'Sistema', '3001000000', 'admin@taxiquilichao.com', $1, 'admin')
      ON CONFLICT (telefono) DO NOTHING
    `, [password]);
    console.log('✅ Admin creado');

    // Propietario
    const propietario = await pool.query(`
      INSERT INTO usuarios (nombre, apellido, telefono, email, password_hash, rol)
      VALUES ('Carlos', 'Muñoz', '3001000001', 'carlos@email.com', $1, 'propietario')
      ON CONFLICT (telefono) DO NOTHING RETURNING id
    `, [password]);
    console.log('✅ Propietario creado');

    // Conductor
    const conductor = await pool.query(`
      INSERT INTO usuarios (nombre, apellido, telefono, email, password_hash, rol)
      VALUES ('Pedro', 'García', '3001000002', 'pedro@email.com', $1, 'conductor')
      ON CONFLICT (telefono) DO NOTHING RETURNING id
    `, [password]);
    console.log('✅ Conductor creado');

    // Pasajero
    await pool.query(`
      INSERT INTO usuarios (nombre, apellido, telefono, email, password_hash, rol)
      VALUES ('María', 'López', '3001000003', 'maria@email.com', $1, 'pasajero')
      ON CONFLICT (telefono) DO NOTHING
    `, [password]);
    console.log('✅ Pasajero creado');

    // Vehículo (si el propietario fue creado)
    if (propietario.rows.length > 0 && conductor.rows.length > 0) {
      const vehiculo = await pool.query(`
        INSERT INTO vehiculos (propietario_id, placa, marca, modelo, anio, color)
        VALUES ($1, 'ABC123', 'Chevrolet', 'Spark', 2020, 'Blanco')
        ON CONFLICT (placa) DO NOTHING RETURNING id
      `, [propietario.rows[0].id]);

      if (vehiculo.rows.length > 0) {
        await pool.query(`
          INSERT INTO conductores_vehiculos (conductor_id, vehiculo_id)
          VALUES ($1, $2)
          ON CONFLICT (conductor_id, vehiculo_id) DO NOTHING
        `, [conductor.rows[0].id, vehiculo.rows[0].id]);
        console.log('✅ Vehículo y asignación creados');
      }
    }

    console.log('\n✅ Seed completado');
    console.log('\n📋 Credenciales de prueba (todos usan password: password123):');
    console.log('   Admin:      3001000000');
    console.log('   Propietario: 3001000001');
    console.log('   Conductor:  3001000002');
    console.log('   Pasajero:   3001000003');

  } catch (err) {
    console.error('❌ Error en seed:', err.message);
  }

  process.exit(0);
}

seed();

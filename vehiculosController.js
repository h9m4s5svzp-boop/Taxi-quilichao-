const pool = require('../config/database');

// GET /vehiculos/mis-vehiculos - propietario ve sus vehículos
const misVehiculos = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.*, 
        json_agg(
          json_build_object(
            'conductor_id', u.id,
            'nombre', u.nombre || ' ' || u.apellido,
            'telefono', u.telefono,
            'calificacion', u.calificacion_promedio,
            'turno', cv.turno,
            'activo', cv.activo
          )
        ) FILTER (WHERE u.id IS NOT NULL) AS conductores
       FROM vehiculos v
       LEFT JOIN conductores_vehiculos cv ON v.id = cv.vehiculo_id
       LEFT JOIN usuarios u ON cv.conductor_id = u.id
       WHERE v.propietario_id = $1
       GROUP BY v.id
       ORDER BY v.created_at DESC`,
      [req.usuario.id]
    );
    res.json({ vehiculos: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener vehículos' });
  }
};

// POST /vehiculos - propietario crea vehículo
const crearVehiculo = async (req, res) => {
  const { placa, marca, modelo, anio, color, tipo, capacidad } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO vehiculos (propietario_id, placa, marca, modelo, anio, color, tipo, capacidad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.usuario.id, placa.toUpperCase(), marca, modelo, anio, color, tipo || 'sedan', capacidad || 4]
    );
    res.status(201).json({ vehiculo: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'La placa ya está registrada' });
    res.status(500).json({ error: 'Error al crear vehículo' });
  }
};

// POST /vehiculos/:id/asignar-conductor
const asignarConductor = async (req, res) => {
  const { id: vehiculo_id } = req.params;
  const { conductor_id, turno } = req.body;

  try {
    // Verificar que el vehículo es del propietario
    const vehiculo = await pool.query(
      'SELECT id FROM vehiculos WHERE id = $1 AND propietario_id = $2',
      [vehiculo_id, req.usuario.id]
    );
    if (vehiculo.rows.length === 0) return res.status(403).json({ error: 'No autorizado' });

    // Verificar que el conductor existe
    const conductor = await pool.query(
      "SELECT id FROM usuarios WHERE id = $1 AND rol = 'conductor'",
      [conductor_id]
    );
    if (conductor.rows.length === 0) return res.status(404).json({ error: 'Conductor no encontrado' });

    const result = await pool.query(
      `INSERT INTO conductores_vehiculos (conductor_id, vehiculo_id, turno)
       VALUES ($1, $2, $3)
       ON CONFLICT (conductor_id, vehiculo_id) DO UPDATE SET turno = $3, activo = TRUE
       RETURNING *`,
      [conductor_id, vehiculo_id, turno || 'completo']
    );
    res.status(201).json({ asignacion: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al asignar conductor' });
  }
};

// GET /vehiculos/:id/ganancias - propietario ve ganancias de su vehículo
const gananciasPorVehiculo = async (req, res) => {
  const { id: vehiculo_id } = req.params;
  const { desde, hasta } = req.query;

  try {
    // Verificar propiedad
    const vehiculo = await pool.query(
      'SELECT id, placa FROM vehiculos WHERE id = $1 AND propietario_id = $2',
      [vehiculo_id, req.usuario.id]
    );
    if (vehiculo.rows.length === 0) return res.status(403).json({ error: 'No autorizado' });

    let dateFilter = '';
    const params = [vehiculo_id];

    if (desde && hasta) {
      params.push(desde, hasta);
      dateFilter = `AND DATE(vj.fecha_fin) BETWEEN $${params.length - 1} AND $${params.length}`;
    }

    const result = await pool.query(
      `SELECT 
        u.id AS conductor_id,
        u.nombre || ' ' || u.apellido AS conductor,
        u.calificacion_promedio,
        COUNT(vj.id) AS total_viajes,
        COALESCE(SUM(vj.precio_final), 0) AS total_ganado,
        ROUND(AVG(vj.distancia_km)::NUMERIC, 2) AS km_promedio,
        MIN(vj.fecha_fin) AS primer_viaje,
        MAX(vj.fecha_fin) AS ultimo_viaje,
        json_agg(
          json_build_object(
            'destino', vj.destino_direccion,
            'precio', vj.precio_final,
            'fecha', vj.fecha_fin,
            'km', vj.distancia_km
          ) ORDER BY vj.fecha_fin DESC
        ) FILTER (WHERE vj.id IS NOT NULL) AS viajes_detalle
       FROM conductores_vehiculos cv
       JOIN usuarios u ON cv.conductor_id = u.id
       LEFT JOIN viajes vj ON vj.conductor_id = cv.conductor_id 
         AND vj.vehiculo_id = $1 
         AND vj.estado = 'completado'
         ${dateFilter}
       WHERE cv.vehiculo_id = $1
       GROUP BY u.id, u.nombre, u.apellido, u.calificacion_promedio`,
      params
    );

    res.json({
      vehiculo: vehiculo.rows[0],
      conductores: result.rows,
      total_general: result.rows.reduce((sum, c) => sum + parseFloat(c.total_ganado), 0)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener ganancias' });
  }
};

module.exports = { misVehiculos, crearVehiculo, asignarConductor, gananciasPorVehiculo };

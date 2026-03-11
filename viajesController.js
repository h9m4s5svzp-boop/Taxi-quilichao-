const pool = require('../config/database');

// Tarifas
const TARIFA_BASE = parseFloat(process.env.TARIFA_BASE) || 3000;
const TARIFA_POR_KM = parseFloat(process.env.TARIFA_POR_KM) || 1200;
const TARIFA_MINIMA = parseFloat(process.env.TARIFA_MINIMA) || 4000;

const calcularPrecio = (distanciaKm) => {
  const precio = TARIFA_BASE + (distanciaKm * TARIFA_POR_KM);
  return Math.max(precio, TARIFA_MINIMA);
};

const calcularDistanciaKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
};

// GET /viajes/mis-viajes
const misViajes = async (req, res) => {
  try {
    const esCondutor = req.usuario.rol === 'conductor';
    const campo = esCondutor ? 'conductor_id' : 'pasajero_id';

    const result = await pool.query(
      `SELECT v.*, 
        CASE WHEN $2 = 'conductor' THEN
          (SELECT nombre || ' ' || apellido FROM usuarios WHERE id = v.pasajero_id)
        ELSE
          (SELECT nombre || ' ' || apellido FROM usuarios WHERE id = v.conductor_id)
        END AS nombre_contraparte,
        (SELECT COUNT(*) > 0 FROM calificaciones WHERE viaje_id = v.id AND calificador_id = $1) AS calificado
       FROM viajes v
       WHERE v.${campo} = $1
       ORDER BY v.fecha_solicitud DESC
       LIMIT 50`,
      [req.usuario.id, req.usuario.rol]
    );
    res.json({ viajes: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener viajes' });
  }
};

// GET /viajes/mis-ganancias?periodo=hoy|semana|mes
const misGanancias = async (req, res) => {
  const { periodo = 'hoy' } = req.query;
  const filtros = {
    hoy: "DATE(v.fecha_fin) = CURRENT_DATE",
    semana: "v.fecha_fin >= DATE_TRUNC('week', NOW())",
    mes: "v.fecha_fin >= DATE_TRUNC('month', NOW())",
  };

  try {
    const filtro = filtros[periodo] || filtros.hoy;

    const [resumen, porDia, destinos] = await Promise.all([
      pool.query(
        `SELECT 
          COUNT(*) AS total_viajes,
          COALESCE(SUM(precio_final), 0) AS total_ganado,
          COALESCE(SUM(distancia_km), 0) AS km_totales,
          ROUND(AVG(c.puntuacion)::NUMERIC, 2) AS calificacion_promedio
         FROM viajes v
         LEFT JOIN calificaciones c ON v.id = c.viaje_id AND c.calificado_id = $1
         WHERE v.conductor_id = $1 AND v.estado = 'completado' AND ${filtro}`,
        [req.usuario.id]
      ),
      pool.query(
        `SELECT DATE(fecha_fin) AS fecha, COUNT(*) AS total_viajes, SUM(precio_final) AS total_ganado
         FROM viajes WHERE conductor_id = $1 AND estado = 'completado' AND ${filtro}
         GROUP BY DATE(fecha_fin) ORDER BY fecha DESC`,
        [req.usuario.id]
      ),
      pool.query(
        `SELECT destino_direccion AS destino, precio_final AS precio, fecha_fin AS fecha
         FROM viajes WHERE conductor_id = $1 AND estado = 'completado' AND ${filtro}
         ORDER BY fecha_fin DESC LIMIT 20`,
        [req.usuario.id]
      ),
    ]);

    res.json({
      ...resumen.rows[0],
      por_dia: porDia.rows,
      destinos: destinos.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener ganancias' });
  }
};

// POST /viajes/calificar
const calificar = async (req, res) => {
  const { viaje_id, puntuacion, comentario } = req.body;
  if (!viaje_id || !puntuacion) return res.status(400).json({ error: 'Datos incompletos' });

  try {
    const viaje = await pool.query(
      'SELECT pasajero_id, conductor_id FROM viajes WHERE id = $1 AND estado = $2',
      [viaje_id, 'completado']
    );
    if (viaje.rows.length === 0) return res.status(404).json({ error: 'Viaje no encontrado' });

    const { pasajero_id, conductor_id } = viaje.rows[0];
    const esPasajero = req.usuario.id === pasajero_id;
    const calificado_id = esPasajero ? conductor_id : pasajero_id;

    await pool.query(
      `INSERT INTO calificaciones (viaje_id, calificador_id, calificado_id, puntuacion, comentario)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (viaje_id, calificador_id) DO NOTHING`,
      [viaje_id, req.usuario.id, calificado_id, puntuacion, comentario || null]
    );

    res.json({ mensaje: 'Calificación enviada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al calificar' });
  }
};

module.exports = { misViajes, misGanancias, calificar, calcularPrecio, calcularDistanciaKm };

const pool = require('../config/database');

// GET /usuarios - solo admin
const listarUsuarios = async (req, res) => {
  const { rol, activo } = req.query;
  let query = `SELECT id, nombre, apellido, telefono, email, rol, activo, 
                      calificacion_promedio, total_calificaciones, created_at
               FROM usuarios WHERE 1=1`;
  const params = [];

  if (rol) { params.push(rol); query += ` AND rol = $${params.length}`; }
  if (activo !== undefined) { params.push(activo === 'true'); query += ` AND activo = $${params.length}`; }

  query += ' ORDER BY created_at DESC';

  try {
    const result = await pool.query(query, params);
    res.json({ usuarios: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
};

// PUT /usuarios/:id/activar - admin
const toggleActivar = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE usuarios SET activo = NOT activo WHERE id = $1
       RETURNING id, nombre, activo`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ usuario: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
};

module.exports = { listarUsuarios, toggleActivar };

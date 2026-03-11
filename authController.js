const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const generarToken = (usuario) => {
  return jwt.sign(
    {
      id: usuario.id,
      rol: usuario.rol,
      nombre: usuario.nombre,
      telefono: usuario.telefono
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// POST /auth/registro
const registro = async (req, res) => {
  const { nombre, apellido, telefono, email, password, rol } = req.body;

  // Solo se pueden registrar pasajeros y conductores desde la app
  const rolesPermitidos = ['pasajero', 'conductor'];
  if (!rolesPermitidos.includes(rol)) {
    return res.status(400).json({ error: 'Rol no permitido en registro público' });
  }

  try {
    // Verificar si ya existe
    const existe = await pool.query(
      'SELECT id FROM usuarios WHERE telefono = $1 OR email = $2',
      [telefono, email]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ error: 'El teléfono o email ya está registrado' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO usuarios (nombre, apellido, telefono, email, password_hash, rol)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, apellido, telefono, email, rol, created_at`,
      [nombre, apellido, telefono, email, password_hash, rol]
    );

    const usuario = result.rows[0];
    const token = generarToken(usuario);

    res.status(201).json({
      mensaje: 'Usuario registrado exitosamente',
      usuario,
      token
    });

  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /auth/login
const login = async (req, res) => {
  const { telefono, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT id, nombre, apellido, telefono, email, rol, password_hash, activo, 
              calificacion_promedio, foto_url
       FROM usuarios WHERE telefono = $1`,
      [telefono]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Teléfono o contraseña incorrectos' });
    }

    const usuario = result.rows[0];

    if (!usuario.activo) {
      return res.status(401).json({ error: 'Tu cuenta ha sido desactivada' });
    }

    const passwordValido = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValido) {
      return res.status(401).json({ error: 'Teléfono o contraseña incorrectos' });
    }

    const token = generarToken(usuario);

    // No enviar el hash
    delete usuario.password_hash;

    res.json({
      mensaje: 'Bienvenido',
      usuario,
      token
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// GET /auth/perfil
const perfil = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, apellido, telefono, email, rol, activo, verificado,
              calificacion_promedio, total_calificaciones, foto_url, created_at
       FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ usuario: result.rows[0] });

  } catch (err) {
    console.error('Error en perfil:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /auth/push-token
const guardarPushToken = async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  try {
    await pool.query('UPDATE usuarios SET push_token = $1 WHERE id = $2', [token, req.usuario.id]);
    res.json({ mensaje: 'Token guardado' });
  } catch (err) {
    res.status(500).json({ error: 'Error guardando token' });
  }
};

module.exports = { registro, login, perfil, guardarPushToken };

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./database');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Token requerido'));
  try {
    socket.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    next(new Error('Token inválido'));
  }
});

const conductoresConectados = new Map();
const pasajerosConectados = new Map();

const TARIFA_BASE = parseFloat(process.env.TARIFA_BASE) || 3000;
const TARIFA_POR_KM = parseFloat(process.env.TARIFA_POR_KM) || 1200;
const TARIFA_MINIMA = parseFloat(process.env.TARIFA_MINIMA) || 4000;

const calcularDistanciaKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(2));
};

const calcularPrecio = (km) => Math.max(TARIFA_BASE + km * TARIFA_POR_KM, TARIFA_MINIMA);

io.on('connection', (socket) => {
  const { id, rol, nombre } = socket.usuario;
  console.log(`🔌 Conectado: ${nombre} (${rol})`);
  if (rol === 'conductor') conductoresConectados.set(id, socket.id);
  if (rol === 'pasajero') pasajerosConectados.set(id, socket.id);
  if (rol === 'admin') socket.join('sala_admin');

  socket.on('conductor:ubicacion', async ({ latitud, longitud, disponible }) => {
    if (rol !== 'conductor') return;
    try {
      await pool.query(
        `INSERT INTO ubicaciones_conductores (conductor_id, latitud, longitud, disponible)
         VALUES ($1,$2,$3,$4) ON CONFLICT (conductor_id) DO UPDATE
         SET latitud=$2, longitud=$3, disponible=$4, ultima_actualizacion=NOW()`,
        [id, latitud, longitud, disponible]
      );
      socket.to('sala_admin').emit('conductor:posicion_actualizada', { conductor_id: id, nombre, latitud, longitud, disponible });
    } catch (err) { console.error('Error ubicacion:', err.message); }
  });

  socket.on('pasajero:buscar_conductores', async ({ latitud, longitud }) => {
    try {
      const result = await pool.query(
        `SELECT uc.conductor_id, uc.latitud, uc.longitud,
          u.nombre||' '||u.apellido AS nombre, u.calificacion_promedio,
          veh.placa, veh.marca, veh.modelo, veh.color
         FROM ubicaciones_conductores uc
         JOIN usuarios u ON uc.conductor_id = u.id
         LEFT JOIN conductores_vehiculos cv ON cv.conductor_id=uc.conductor_id AND cv.activo=TRUE
         LEFT JOIN vehiculos veh ON cv.vehiculo_id=veh.id
         WHERE uc.disponible=TRUE AND uc.en_viaje=FALSE
           AND uc.ultima_actualizacion > NOW() - INTERVAL '2 minutes'`
      );
      socket.emit('conductores:disponibles', { conductores: result.rows });
    } catch (err) { console.error('Error buscando conductores:', err.message); }
  });

  socket.on('pasajero:solicitar_viaje', async ({ origen, destino }) => {
    if (rol !== 'pasajero') return;
    try {
      const distanciaKm = calcularDistanciaKm(origen.latitud, origen.longitud, destino.latitud, destino.longitud);
      const precioEstimado = calcularPrecio(distanciaKm);
      const viaje = await pool.query(
        `INSERT INTO viajes (pasajero_id,origen_direccion,origen_latitud,origen_longitud,
          destino_direccion,destino_latitud,destino_longitud,distancia_km,precio_estimado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [id, origen.direccion, origen.latitud, origen.longitud,
          destino.direccion, destino.latitud, destino.longitud, distanciaKm, precioEstimado]
      );
      const viaje_id = viaje.rows[0].id;
      const pasajeroInfo = await pool.query('SELECT nombre,apellido,calificacion_promedio FROM usuarios WHERE id=$1',[id]);
      const p = pasajeroInfo.rows[0];
      const solicitud = { viaje_id, origen, destino, distanciaKm, precio_estimado: precioEstimado,
        pasajero: { id, nombre: `${p.nombre} ${p.apellido}`, calificacion_promedio: p.calificacion_promedio } };
      const conductores = await pool.query(
        `SELECT conductor_id FROM ubicaciones_conductores WHERE disponible=TRUE AND en_viaje=FALSE
         AND ultima_actualizacion > NOW() - INTERVAL '2 minutes' LIMIT 5`
      );
      conductores.rows.forEach(({ conductor_id }) => {
        const s = conductoresConectados.get(conductor_id);
        if (s) io.to(s).emit('viaje:nueva_solicitud', solicitud);
      });
      if (conductores.rows.length === 0)
        socket.emit('viaje:sin_conductores', { mensaje: 'No hay conductores disponibles' });
    } catch (err) { console.error('Error solicitando viaje:', err.message); }
  });

  socket.on('conductor:aceptar_viaje', async ({ viaje_id }) => {
    if (rol !== 'conductor') return;
    try {
      const vRes = await pool.query('SELECT vehiculo_id FROM conductores_vehiculos WHERE conductor_id=$1 AND activo=TRUE LIMIT 1',[id]);
      const vehiculo_id = vRes.rows[0]?.vehiculo_id || null;
      const result = await pool.query(
        `UPDATE viajes SET conductor_id=$1,vehiculo_id=$2,estado='aceptado',fecha_aceptado=NOW()
         WHERE id=$3 AND estado='buscando' RETURNING pasajero_id`,
        [id, vehiculo_id, viaje_id]
      );
      if (result.rows.length === 0) return;
      const pasajero_id = result.rows[0].pasajero_id;
      await pool.query('UPDATE ubicaciones_conductores SET en_viaje=TRUE,disponible=FALSE WHERE conductor_id=$1',[id]);
      const cInfo = await pool.query(
        `SELECT u.nombre,u.apellido,u.calificacion_promedio,veh.placa,veh.marca,veh.modelo,veh.color
         FROM usuarios u LEFT JOIN conductores_vehiculos cv ON cv.conductor_id=u.id AND cv.activo=TRUE
         LEFT JOIN vehiculos veh ON cv.vehiculo_id=veh.id WHERE u.id=$1`,[id]
      );
      const c = cInfo.rows[0];
      const sp = pasajerosConectados.get(pasajero_id);
      if (sp) io.to(sp).emit('viaje:conductor_asignado', {
        conductor: { id, ...c, nombre: `${c.nombre} ${c.apellido}` },
        viaje: { id: viaje_id, estado: 'aceptado' }
      });
    } catch (err) { console.error('Error aceptando viaje:', err.message); }
  });

  socket.on('conductor:recogi_pasajero', async ({ viaje_id }) => {
    if (rol !== 'conductor') return;
    try {
      const r = await pool.query(
        `UPDATE viajes SET estado='en_camino',fecha_inicio=NOW() WHERE id=$1 AND conductor_id=$2 RETURNING pasajero_id`,
        [viaje_id, id]
      );
      const sp = pasajerosConectados.get(r.rows[0]?.pasajero_id);
      if (sp) io.to(sp).emit('viaje:conductor_llego');
    } catch (err) { console.error(err.message); }
  });

  socket.on('conductor:completar_viaje', async ({ viaje_id }) => {
    if (rol !== 'conductor') return;
    try {
      const r = await pool.query(
        `UPDATE viajes SET estado='completado',fecha_fin=NOW(),precio_final=precio_estimado
         WHERE id=$1 AND conductor_id=$2 RETURNING pasajero_id,precio_final`,
        [viaje_id, id]
      );
      if (r.rows.length === 0) return;
      const { pasajero_id, precio_final } = r.rows[0];
      await pool.query('UPDATE ubicaciones_conductores SET en_viaje=FALSE,disponible=TRUE WHERE conductor_id=$1',[id]);
      const sp = pasajerosConectados.get(pasajero_id);
      if (sp) io.to(sp).emit('viaje:completado', { precio: precio_final });
    } catch (err) { console.error(err.message); }
  });

  socket.on('pasajero:cancelar_viaje', async ({ viaje_id }) => {
    if (rol !== 'pasajero') return;
    try {
      const r = await pool.query(
        `UPDATE viajes SET estado='cancelado',cancelado_por='pasajero',fecha_fin=NOW()
         WHERE id=$1 AND pasajero_id=$2 AND estado IN ('buscando','aceptado') RETURNING conductor_id`,
        [viaje_id, id]
      );
      const conductor_id = r.rows[0]?.conductor_id;
      if (conductor_id) {
        const sc = conductoresConectados.get(conductor_id);
        if (sc) io.to(sc).emit('viaje:cancelado_por_pasajero');
        await pool.query('UPDATE ubicaciones_conductores SET en_viaje=FALSE,disponible=TRUE WHERE conductor_id=$1',[conductor_id]);
      }
    } catch (err) { console.error(err.message); }
  });

  socket.on('chat:mensaje', async ({ viaje_id, mensaje }) => {
    try {
      const r = await pool.query(
        `INSERT INTO mensajes_chat (viaje_id,remitente_id,mensaje) VALUES ($1,$2,$3) RETURNING *`,
        [viaje_id, id, mensaje]
      );
      const viaje = await pool.query('SELECT pasajero_id,conductor_id FROM viajes WHERE id=$1',[viaje_id]);
      if (viaje.rows.length > 0) {
        const { pasajero_id, conductor_id } = viaje.rows[0];
        const destId = id === pasajero_id ? conductor_id : pasajero_id;
        const sd = conductoresConectados.get(destId) || pasajerosConectados.get(destId);
        if (sd) io.to(sd).emit('chat:nuevo_mensaje', { viaje_id, mensaje: r.rows[0], remitente: { id, nombre, rol } });
      }
    } catch (err) { console.error(err.message); }
  });

  socket.on('disconnect', () => {
    conductoresConectados.delete(id);
    pasajerosConectados.delete(id);
  });
});

app.set('io', io);
app.use(cors());
app.use(express.json());

// Rutas inline (sin subcarpetas)
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const verificarToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try { req.usuario = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(403).json({ error: 'Token inválido' }); }
};

const soloRoles = (...roles) => (req, res, next) =>
  roles.includes(req.usuario.rol) ? next() : res.status(403).json({ error: 'Acceso denegado' });

// AUTH
app.post('/api/auth/registro', async (req, res) => {
  const { nombre, apellido, telefono, email, password, rol } = req.body;
  if (!['pasajero','conductor'].includes(rol)) return res.status(400).json({ error: 'Rol no permitido' });
  try {
    const existe = await pool.query('SELECT id FROM usuarios WHERE telefono=$1',[telefono]);
    if (existe.rows.length > 0) return res.status(400).json({ error: 'Teléfono ya registrado' });
    const password_hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO usuarios (nombre,apellido,telefono,email,password_hash,rol)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,nombre,apellido,telefono,email,rol`,
      [nombre,apellido,telefono,email,password_hash,rol]
    );
    const usuario = r.rows[0];
    const token = jwt.sign({ id:usuario.id, rol:usuario.rol, nombre:usuario.nombre }, process.env.JWT_SECRET, { expiresIn:'7d' });
    res.status(201).json({ usuario, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { telefono, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM usuarios WHERE telefono=$1',[telefono]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const usuario = r.rows[0];
    if (!usuario.activo) return res.status(401).json({ error: 'Cuenta desactivada' });
    if (!await bcrypt.compare(password, usuario.password_hash)) return res.status(401).json({ error: 'Credenciales incorrectas' });
    delete usuario.password_hash;
    const token = jwt.sign({ id:usuario.id, rol:usuario.rol, nombre:usuario.nombre }, process.env.JWT_SECRET, { expiresIn:'7d' });
    res.json({ usuario, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/perfil', verificarToken, async (req, res) => {
  const r = await pool.query('SELECT id,nombre,apellido,telefono,email,rol,calificacion_promedio FROM usuarios WHERE id=$1',[req.usuario.id]);
  res.json({ usuario: r.rows[0] });
});

app.post('/api/auth/push-token', verificarToken, async (req, res) => {
  await pool.query('UPDATE usuarios SET push_token=$1 WHERE id=$2',[req.body.token, req.usuario.id]);
  res.json({ mensaje: 'Token guardado' });
});

// VIAJES
app.get('/api/viajes/mis-viajes', verificarToken, async (req, res) => {
  const campo = req.usuario.rol === 'conductor' ? 'conductor_id' : 'pasajero_id';
  const r = await pool.query(`SELECT * FROM viajes WHERE ${campo}=$1 ORDER BY fecha_solicitud DESC LIMIT 50`,[req.usuario.id]);
  res.json({ viajes: r.rows });
});

app.get('/api/viajes/mis-ganancias', verificarToken, soloRoles('conductor'), async (req, res) => {
  const { periodo='hoy' } = req.query;
  const filtros = { hoy:"DATE(fecha_fin)=CURRENT_DATE", semana:"fecha_fin>=DATE_TRUNC('week',NOW())", mes:"fecha_fin>=DATE_TRUNC('month',NOW())" };
  const f = filtros[periodo] || filtros.hoy;
  try {
    const [resumen, porDia, destinos] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total_viajes, COALESCE(SUM(precio_final),0) AS total_ganado, COALESCE(SUM(distancia_km),0) AS km_totales FROM viajes WHERE conductor_id=$1 AND estado='completado' AND ${f}`,[req.usuario.id]),
      pool.query(`SELECT DATE(fecha_fin) AS fecha, COUNT(*) AS total_viajes, SUM(precio_final) AS total_ganado FROM viajes WHERE conductor_id=$1 AND estado='completado' AND ${f} GROUP BY DATE(fecha_fin) ORDER BY fecha DESC`,[req.usuario.id]),
      pool.query(`SELECT destino_direccion AS destino, precio_final AS precio, fecha_fin AS fecha FROM viajes WHERE conductor_id=$1 AND estado='completado' AND ${f} ORDER BY fecha_fin DESC LIMIT 20`,[req.usuario.id]),
    ]);
    res.json({ ...resumen.rows[0], por_dia: porDia.rows, destinos: destinos.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/viajes/calificar', verificarToken, async (req, res) => {
  const { viaje_id, puntuacion, comentario } = req.body;
  try {
    const v = await pool.query('SELECT pasajero_id,conductor_id FROM viajes WHERE id=$1',[viaje_id]);
    if (v.rows.length === 0) return res.status(404).json({ error: 'Viaje no encontrado' });
    const { pasajero_id, conductor_id } = v.rows[0];
    const calificado_id = req.usuario.id === pasajero_id ? conductor_id : pasajero_id;
    await pool.query(
      `INSERT INTO calificaciones (viaje_id,calificador_id,calificado_id,puntuacion,comentario)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (viaje_id,calificador_id) DO NOTHING`,
      [viaje_id, req.usuario.id, calificado_id, puntuacion, comentario||null]
    );
    res.json({ mensaje: 'Calificación enviada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// VEHÍCULOS
app.get('/api/vehiculos/mis-vehiculos', verificarToken, soloRoles('propietario','admin'), async (req, res) => {
  const r = await pool.query('SELECT * FROM vehiculos WHERE propietario_id=$1',[req.usuario.id]);
  res.json({ vehiculos: r.rows });
});

app.post('/api/vehiculos', verificarToken, soloRoles('propietario','admin'), async (req, res) => {
  const { placa, marca, modelo, anio, color, tipo, capacidad } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO vehiculos (propietario_id,placa,marca,modelo,anio,color,tipo,capacidad)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.usuario.id, placa.toUpperCase(), marca, modelo, anio, color, tipo||'sedan', capacidad||4]
    );
    res.status(201).json({ vehiculo: r.rows[0] });
  } catch (err) {
    if (err.code==='23505') return res.status(400).json({ error: 'Placa ya registrada' });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehiculos/:id/ganancias', verificarToken, soloRoles('propietario','admin'), async (req, res) => {
  const { id: vehiculo_id } = req.params;
  const { desde, hasta } = req.query;
  try {
    const v = await pool.query('SELECT id,placa FROM vehiculos WHERE id=$1 AND propietario_id=$2',[vehiculo_id,req.usuario.id]);
    if (v.rows.length===0) return res.status(403).json({ error: 'No autorizado' });
    let dateFilter='', params=[vehiculo_id];
    if (desde && hasta) { params.push(desde,hasta); dateFilter=`AND DATE(vj.fecha_fin) BETWEEN $2 AND $3`; }
    const r = await pool.query(
      `SELECT u.id AS conductor_id, u.nombre||' '||u.apellido AS conductor,
        u.calificacion_promedio, COUNT(vj.id) AS total_viajes,
        COALESCE(SUM(vj.precio_final),0) AS total_ganado
       FROM conductores_vehiculos cv
       JOIN usuarios u ON cv.conductor_id=u.id
       LEFT JOIN viajes vj ON vj.conductor_id=cv.conductor_id AND vj.vehiculo_id=$1
         AND vj.estado='completado' ${dateFilter}
       WHERE cv.vehiculo_id=$1
       GROUP BY u.id,u.nombre,u.apellido,u.calificacion_promedio`,
      params
    );
    res.json({ vehiculo: v.rows[0], conductores: r.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// USUARIOS (admin)
app.get('/api/usuarios', verificarToken, soloRoles('admin'), async (req, res) => {
  const r = await pool.query('SELECT id,nombre,apellido,telefono,rol,activo,calificacion_promedio FROM usuarios ORDER BY created_at DESC');
  res.json({ usuarios: r.rows });
});

// HEALTH CHECK
app.get('/api/health', (req, res) => res.json({ status:'ok', app:'Taxi Quilichao API' }));

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚖 Taxi Quilichao corriendo en puerto ${PORT}`));

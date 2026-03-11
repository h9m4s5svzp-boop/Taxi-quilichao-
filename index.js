require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./config/database');

const app = express();
const server = http.createServer(app);

// ============================================
// CONFIGURACIÓN SOCKET.IO
// ============================================
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware de autenticación para Socket.io
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Token requerido'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.usuario = decoded;
    next();
  } catch (err) {
    next(new Error('Token inválido'));
  }
});

// Mapas en memoria para conexiones activas
const conductoresConectados = new Map(); // conductorId -> socketId
const pasajerosConectados = new Map();   // pasajeroId -> socketId

io.on('connection', (socket) => {
  const { id, rol, nombre } = socket.usuario;
  console.log(`🔌 Conectado: ${nombre} (${rol})`);

  if (rol === 'conductor') conductoresConectados.set(id, socket.id);
  if (rol === 'pasajero') pasajerosConectados.set(id, socket.id);

  // ── Conductor actualiza su ubicación GPS ──
  socket.on('conductor:ubicacion', async ({ latitud, longitud, disponible }) => {
    if (rol !== 'conductor') return;
    try {
      await pool.query(
        `INSERT INTO ubicaciones_conductores (conductor_id, latitud, longitud, disponible)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (conductor_id) DO UPDATE
         SET latitud = $2, longitud = $3, disponible = $4, ultima_actualizacion = NOW()`,
        [id, latitud, longitud, disponible]
      );
      // Emitir a admins la posición
      socket.to('sala_admin').emit('conductor:posicion_actualizada', {
        conductor_id: id, nombre, latitud, longitud, disponible
      });
    } catch (err) {
      console.error('Error guardando ubicación:', err.message);
    }
  });

  // ── Pasajero solicita conductores cercanos ──
  socket.on('pasajero:buscar_conductores', async ({ latitud, longitud }) => {
    try {
      // Conductores disponibles (en un radio aproximado)
      const result = await pool.query(
        `SELECT uc.conductor_id, uc.latitud, uc.longitud,
                u.nombre || ' ' || u.apellido AS nombre,
                u.calificacion_promedio,
                veh.placa, veh.marca, veh.modelo, veh.color
         FROM ubicaciones_conductores uc
         JOIN usuarios u ON uc.conductor_id = u.id
         LEFT JOIN conductores_vehiculos cv ON cv.conductor_id = uc.conductor_id AND cv.activo = TRUE
         LEFT JOIN vehiculos veh ON cv.vehiculo_id = veh.id
         WHERE uc.disponible = TRUE AND uc.en_viaje = FALSE
           AND uc.ultima_actualizacion > NOW() - INTERVAL '2 minutes'`
      );
      socket.emit('conductores:disponibles', { conductores: result.rows });
    } catch (err) {
      console.error('Error buscando conductores:', err.message);
    }
  });

  // ── Chat entre pasajero y conductor ──
  // ── Pasajero solicita viaje ──
  socket.on('pasajero:solicitar_viaje', async ({ origen, destino }) => {
    if (rol !== 'pasajero') return;
    const { calcularDistanciaKm, calcularPrecio } = require('./controllers/viajesController');
      const { Notificaciones } = require('./services/notificaciones');

    try {
      const distanciaKm = calcularDistanciaKm(origen.latitud, origen.longitud, destino.latitud, destino.longitud);
      const precioEstimado = calcularPrecio(distanciaKm);

      // Crear viaje en BD
      const viaje = await pool.query(
        `INSERT INTO viajes (pasajero_id, origen_direccion, origen_latitud, origen_longitud,
          destino_direccion, destino_latitud, destino_longitud, distancia_km, precio_estimado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [id, origen.direccion, origen.latitud, origen.longitud,
          destino.direccion, destino.latitud, destino.longitud, distanciaKm, precioEstimado]
      );
      const viaje_id = viaje.rows[0].id;

      // Obtener info del pasajero
      const pasajeroInfo = await pool.query(
        'SELECT nombre, apellido, calificacion_promedio FROM usuarios WHERE id = $1', [id]
      );
      const pasajeroData = {
        id, nombre: `${pasajeroInfo.rows[0].nombre} ${pasajeroInfo.rows[0].apellido}`,
        calificacion_promedio: pasajeroInfo.rows[0].calificacion_promedio
      };

      // Buscar conductores disponibles cercanos
      const conductores = await pool.query(
        `SELECT conductor_id FROM ubicaciones_conductores
         WHERE disponible = TRUE AND en_viaje = FALSE
           AND ultima_actualizacion > NOW() - INTERVAL '2 minutes'
         LIMIT 5`
      );

      const solicitud = { viaje_id, origen, destino, distanciaKm, precio_estimado: precioEstimado, pasajero: pasajeroData };

      // Notificar a cada conductor disponible
      conductores.rows.forEach(({ conductor_id }) => {
        const socketConductor = conductoresConectados.get(conductor_id);
        if (socketConductor) {
          io.to(socketConductor).emit('viaje:nueva_solicitud', solicitud);
        }
      });

      if (conductores.rows.length === 0) {
        socket.emit('viaje:sin_conductores', { mensaje: 'No hay conductores disponibles en este momento' });
      }

    } catch (err) {
      console.error('Error solicitando viaje:', err.message);
      socket.emit('viaje:error', { mensaje: 'Error al solicitar viaje' });
    }
  });

  // ── Conductor acepta viaje ──
  socket.on('conductor:aceptar_viaje', async ({ viaje_id }) => {
    if (rol !== 'conductor') return;
    try {
      // Obtener vehículo del conductor
      const vehiculoRes = await pool.query(
        'SELECT vehiculo_id FROM conductores_vehiculos WHERE conductor_id = $1 AND activo = TRUE LIMIT 1', [id]
      );
      const vehiculo_id = vehiculoRes.rows[0]?.vehiculo_id || null;

      const result = await pool.query(
        `UPDATE viajes SET conductor_id = $1, vehiculo_id = $2, estado = 'aceptado', fecha_aceptado = NOW()
         WHERE id = $3 AND estado = 'buscando' RETURNING pasajero_id`,
        [id, vehiculo_id, viaje_id]
      );
      if (result.rows.length === 0) return; // Ya fue tomado

      const pasajero_id = result.rows[0].pasajero_id;

      // Actualizar conductor como en viaje
      await pool.query(
        'UPDATE ubicaciones_conductores SET en_viaje = TRUE, disponible = FALSE WHERE conductor_id = $1', [id]
      );

      // Info del conductor para el pasajero
      const conductorInfo = await pool.query(
        `SELECT u.nombre, u.apellido, u.calificacion_promedio, veh.placa, veh.marca, veh.modelo, veh.color
         FROM usuarios u
         LEFT JOIN conductores_vehiculos cv ON cv.conductor_id = u.id AND cv.activo = TRUE
         LEFT JOIN vehiculos veh ON cv.vehiculo_id = veh.id
         WHERE u.id = $1`, [id]
      );
      const c = conductorInfo.rows[0];

      const socketPasajero = pasajerosConectados.get(pasajero_id);
      if (socketPasajero) {
        io.to(socketPasajero).emit('viaje:conductor_asignado', {
          conductor: { id, ...c, nombre: `${c.nombre} ${c.apellido}`, latitud: null, longitud: null },
          viaje: { id: viaje_id, estado: 'aceptado' }
        });
      }

      // Push al pasajero aunque no tenga la app abierta
      const tokenRes = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [pasajero_id]);
      const pushToken = tokenRes.rows[0]?.push_token;
      if (pushToken) {
        await Notificaciones.conductorAsignado(pushToken, `${c.nombre} ${c.apellido}`, c.placa || '');
      }
    } catch (err) {
      console.error('Error aceptando viaje:', err.message);
    }
  });

  // ── Conductor rechaza viaje ──
  socket.on('conductor:rechazar_viaje', ({ viaje_id }) => {
    // No hacer nada, el viaje sigue disponible para otros
  });

  // ── Conductor recogió al pasajero ──
  socket.on('conductor:recogi_pasajero', async ({ viaje_id }) => {
    if (rol !== 'conductor') return;
    try {
      const result = await pool.query(
        `UPDATE viajes SET estado = 'en_camino', fecha_inicio = NOW()
         WHERE id = $1 AND conductor_id = $2 RETURNING pasajero_id`,
        [viaje_id, id]
      );
      const pasajero_id = result.rows[0]?.pasajero_id;
      const socketPasajero = pasajerosConectados.get(pasajero_id);
      socketPasajero && io.to(socketPasajero).emit('viaje:conductor_llego');

      // Push aunque la app esté cerrada
      const tokenRes = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [pasajero_id]);
      const pushToken = tokenRes.rows[0]?.push_token;
      if (pushToken) await Notificaciones.conductorLlego(pushToken);
    } catch (err) {
      console.error('Error:', err.message);
    }
  });

  // ── Conductor completa el viaje ──
  socket.on('conductor:completar_viaje', async ({ viaje_id }) => {
    if (rol !== 'conductor') return;
    try {
      const result = await pool.query(
        `UPDATE viajes SET estado = 'completado', fecha_fin = NOW(),
          precio_final = precio_estimado
         WHERE id = $1 AND conductor_id = $2
         RETURNING pasajero_id, precio_final`,
        [viaje_id, id]
      );
      if (result.rows.length === 0) return;
      const { pasajero_id, precio_final } = result.rows[0];

      // Liberar conductor
      await pool.query(
        'UPDATE ubicaciones_conductores SET en_viaje = FALSE, disponible = TRUE WHERE conductor_id = $1', [id]
      );

      const socketPasajero = pasajerosConectados.get(pasajero_id);
      socketPasajero && io.to(socketPasajero).emit('viaje:completado', { precio: precio_final });

      // Push al pasajero
      const tokenRes = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [pasajero_id]);
      const pushToken = tokenRes.rows[0]?.push_token;
      if (pushToken) await Notificaciones.viajeCompletado(pushToken, precio_final);
    } catch (err) {
      console.error('Error completando viaje:', err.message);
    }
  });

  // ── Pasajero cancela el viaje ──
  socket.on('pasajero:cancelar_viaje', async ({ viaje_id }) => {
    if (rol !== 'pasajero') return;
    try {
      const result = await pool.query(
        `UPDATE viajes SET estado = 'cancelado', cancelado_por = 'pasajero', fecha_fin = NOW()
         WHERE id = $1 AND pasajero_id = $2 AND estado IN ('buscando', 'aceptado')
         RETURNING conductor_id`,
        [viaje_id, id]
      );
      const conductor_id = result.rows[0]?.conductor_id;
      if (conductor_id) {
        const socketConductor = conductoresConectados.get(conductor_id);
        socketConductor && io.to(socketConductor).emit('viaje:cancelado_por_pasajero');
        await pool.query(
          'UPDATE ubicaciones_conductores SET en_viaje = FALSE, disponible = TRUE WHERE conductor_id = $1',
          [conductor_id]
        );
      }
    } catch (err) {
      console.error('Error cancelando viaje:', err.message);
    }
  });

  // ── Chat entre pasajero y conductor ──
  socket.on('chat:mensaje', async ({ viaje_id, mensaje }) => {
    try {
      const result = await pool.query(
        `INSERT INTO mensajes_chat (viaje_id, remitente_id, mensaje)
         VALUES ($1, $2, $3) RETURNING *`,
        [viaje_id, id, mensaje]
      );

      // Obtener el otro participante del viaje
      const viaje = await pool.query(
        'SELECT pasajero_id, conductor_id FROM viajes WHERE id = $1',
        [viaje_id]
      );

      if (viaje.rows.length > 0) {
        const { pasajero_id, conductor_id } = viaje.rows[0];
        const destinatarioId = id === pasajero_id ? conductor_id : pasajero_id;
        const socketDestinatario = conductoresConectados.get(destinatarioId) ||
                                   pasajerosConectados.get(destinatarioId);

        if (socketDestinatario) {
          io.to(socketDestinatario).emit('chat:nuevo_mensaje', {
            viaje_id,
            mensaje: result.rows[0],
            remitente: { id, nombre, rol }
          });
        }
      }
    } catch (err) {
      console.error('Error en chat:', err.message);
    }
  });

  // ── Admin entra a sala de monitoreo ──
  if (rol === 'admin') {
    socket.join('sala_admin');
  }

  socket.on('disconnect', () => {
    console.log(`🔌 Desconectado: ${nombre}`);
    conductoresConectados.delete(id);
    pasajerosConectados.delete(id);
  });
});

// Exportar io para usar en controladores
app.set('io', io);
app.set('conductoresConectados', conductoresConectados);
app.set('pasajerosConectados', pasajerosConectados);

// ============================================
// MIDDLEWARES
// ============================================
app.use(cors());
app.use(express.json());

// ============================================
// RUTAS
// ============================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/vehiculos', require('./routes/vehiculos'));
app.use('/api/viajes', require('./routes/viajes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Taxi Quilichao API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚖 Taxi Quilichao API corriendo en puerto ${PORT}`);
  console.log(`📍 http://localhost:${PORT}/api/health\n`);
});

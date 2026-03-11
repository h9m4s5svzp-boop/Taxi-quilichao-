// Servicio para enviar notificaciones push desde el backend
// Usa la API gratuita de Expo (no necesita FCM/APNs directo)

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Enviar notificación push a uno o varios tokens
 * @param {string|string[]} tokens - Token(s) Expo push
 * @param {string} titulo
 * @param {string} cuerpo
 * @param {object} datos - Datos extra enviados con la notificación
 * @param {string} canal - Canal Android ('viajes' | 'general')
 */
const enviarNotificacion = async (tokens, titulo, cuerpo, datos = {}, canal = 'general') => {
  const listaTokens = Array.isArray(tokens) ? tokens : [tokens];

  const mensajes = listaTokens
    .filter(t => t && t.startsWith('ExponentPushToken'))
    .map(token => ({
      to: token,
      title: titulo,
      body: cuerpo,
      data: datos,
      sound: 'default',
      channelId: canal,
      priority: canal === 'viajes' ? 'high' : 'normal',
    }));

  if (mensajes.length === 0) return;

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mensajes),
    });

    const data = await res.json();

    // Verificar errores por token
    if (data.data) {
      data.data.forEach((result, i) => {
        if (result.status === 'error') {
          console.error(`Error en token ${listaTokens[i]}:`, result.message);
        }
      });
    }

    return data;
  } catch (err) {
    console.error('Error enviando notificación push:', err.message);
  }
};

// Notificaciones predefinidas para cada evento del sistema
const Notificaciones = {

  // Al conductor: nueva solicitud de viaje
  nuevaSolicitud: (token, origen, destino, precio) =>
    enviarNotificacion(
      token,
      '🚖 ¡Nueva solicitud de viaje!',
      `${origen} → ${destino} · $${parseInt(precio).toLocaleString()}`,
      { tipo: 'nueva_solicitud' },
      'viajes'
    ),

  // Al pasajero: conductor asignado
  conductorAsignado: (token, nombreConductor, placa) =>
    enviarNotificacion(
      token,
      '✅ ¡Conductor en camino!',
      `${nombreConductor} va hacia ti · ${placa}`,
      { tipo: 'conductor_asignado' }
    ),

  // Al pasajero: conductor llegó al punto de recogida
  conductorLlego: (token) =>
    enviarNotificacion(
      token,
      '🚖 ¡Tu taxi llegó!',
      'El conductor está esperándote',
      { tipo: 'conductor_llego' },
      'viajes'
    ),

  // Al pasajero: viaje completado
  viajeCompletado: (token, precio) =>
    enviarNotificacion(
      token,
      '🏁 Viaje completado',
      `Precio: $${parseInt(precio).toLocaleString()} · ¡Gracias por usar Taxi Quilichao!`,
      { tipo: 'viaje_completado' }
    ),

  // Al conductor: viaje cancelado por pasajero
  viajeCancelado: (token) =>
    enviarNotificacion(
      token,
      '❌ Viaje cancelado',
      'El pasajero canceló el viaje',
      { tipo: 'viaje_cancelado' }
    ),

  // Nuevo mensaje de chat
  nuevoMensaje: (token, remitente, mensaje) =>
    enviarNotificacion(
      token,
      `💬 ${remitente}`,
      mensaje,
      { tipo: 'nuevo_mensaje' }
    ),
};

module.exports = { enviarNotificacion, Notificaciones };

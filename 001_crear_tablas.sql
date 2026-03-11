-- ============================================
-- MIGRACIÓN PRINCIPAL - TAXI QUILICHAO
-- ============================================

-- Extensión para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLA: usuarios
-- Roles: pasajero, conductor, propietario, admin
-- ============================================
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100) NOT NULL,
  telefono VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(150) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(20) NOT NULL CHECK (rol IN ('pasajero', 'conductor', 'propietario', 'admin')),
  foto_url VARCHAR(500),
  activo BOOLEAN DEFAULT TRUE,
  verificado BOOLEAN DEFAULT FALSE,
  calificacion_promedio DECIMAL(3,2) DEFAULT 5.00,
  total_calificaciones INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA: vehiculos
-- Pertenecen a un propietario
-- ============================================
CREATE TABLE IF NOT EXISTS vehiculos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  propietario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  placa VARCHAR(10) UNIQUE NOT NULL,
  marca VARCHAR(50) NOT NULL,
  modelo VARCHAR(50) NOT NULL,
  anio INTEGER NOT NULL,
  color VARCHAR(30) NOT NULL,
  tipo VARCHAR(20) DEFAULT 'sedan' CHECK (tipo IN ('sedan', 'campero', 'van')),
  capacidad INTEGER DEFAULT 4,
  activo BOOLEAN DEFAULT TRUE,
  foto_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA: conductores_vehiculos
-- Un conductor puede manejar un vehículo en un turno
-- Un vehículo puede tener varios conductores (por turno)
-- ============================================
CREATE TABLE IF NOT EXISTS conductores_vehiculos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conductor_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  turno VARCHAR(20) DEFAULT 'completo' CHECK (turno IN ('manana', 'tarde', 'noche', 'completo')),
  activo BOOLEAN DEFAULT TRUE,
  fecha_inicio DATE DEFAULT CURRENT_DATE,
  fecha_fin DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(conductor_id, vehiculo_id)
);

-- ============================================
-- TABLA: ubicaciones_conductores
-- Posición GPS en tiempo real (se actualiza constantemente)
-- ============================================
CREATE TABLE IF NOT EXISTS ubicaciones_conductores (
  conductor_id UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  latitud DECIMAL(10, 8) NOT NULL,
  longitud DECIMAL(11, 8) NOT NULL,
  disponible BOOLEAN DEFAULT TRUE,
  en_viaje BOOLEAN DEFAULT FALSE,
  ultima_actualizacion TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA: viajes
-- Registro completo de cada viaje
-- ============================================
CREATE TABLE IF NOT EXISTS viajes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pasajero_id UUID NOT NULL REFERENCES usuarios(id),
  conductor_id UUID REFERENCES usuarios(id),
  vehiculo_id UUID REFERENCES vehiculos(id),

  -- Origen
  origen_direccion VARCHAR(300) NOT NULL,
  origen_latitud DECIMAL(10, 8) NOT NULL,
  origen_longitud DECIMAL(11, 8) NOT NULL,

  -- Destino
  destino_direccion VARCHAR(300) NOT NULL,
  destino_latitud DECIMAL(10, 8) NOT NULL,
  destino_longitud DECIMAL(11, 8) NOT NULL,

  -- Estado del viaje
  estado VARCHAR(30) DEFAULT 'buscando' CHECK (estado IN (
    'buscando',      -- Pasajero pidió, buscando conductor
    'aceptado',      -- Conductor aceptó, va al pasajero
    'en_camino',     -- Conductor recogió al pasajero
    'completado',    -- Viaje terminado
    'cancelado'      -- Cancelado por cualquiera
  )),

  -- Tarifas
  distancia_km DECIMAL(8, 2),
  precio_estimado DECIMAL(10, 2),
  precio_final DECIMAL(10, 2),
  forma_pago VARCHAR(20) DEFAULT 'efectivo',

  -- Tiempos
  tiempo_estimado_minutos INTEGER,
  fecha_solicitud TIMESTAMP DEFAULT NOW(),
  fecha_aceptado TIMESTAMP,
  fecha_inicio TIMESTAMP,
  fecha_fin TIMESTAMP,

  -- Cancelación
  cancelado_por VARCHAR(20) CHECK (cancelado_por IN ('pasajero', 'conductor', 'sistema')),
  motivo_cancelacion VARCHAR(200),

  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- TABLA: calificaciones
-- Pasajero califica conductor y viceversa
-- ============================================
CREATE TABLE IF NOT EXISTS calificaciones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  viaje_id UUID NOT NULL REFERENCES viajes(id) ON DELETE CASCADE,
  calificador_id UUID NOT NULL REFERENCES usuarios(id),
  calificado_id UUID NOT NULL REFERENCES usuarios(id),
  puntuacion INTEGER NOT NULL CHECK (puntuacion BETWEEN 1 AND 5),
  comentario VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(viaje_id, calificador_id)
);

-- ============================================
-- TABLA: mensajes_chat
-- Chat entre pasajero y conductor durante el viaje
-- ============================================
CREATE TABLE IF NOT EXISTS mensajes_chat (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  viaje_id UUID NOT NULL REFERENCES viajes(id) ON DELETE CASCADE,
  remitente_id UUID NOT NULL REFERENCES usuarios(id),
  mensaje TEXT NOT NULL,
  leido BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- ÍNDICES para mejor rendimiento
-- ============================================
CREATE INDEX IF NOT EXISTS idx_viajes_pasajero ON viajes(pasajero_id);
CREATE INDEX IF NOT EXISTS idx_viajes_conductor ON viajes(conductor_id);
CREATE INDEX IF NOT EXISTS idx_viajes_estado ON viajes(estado);
CREATE INDEX IF NOT EXISTS idx_viajes_fecha ON viajes(fecha_solicitud DESC);
CREATE INDEX IF NOT EXISTS idx_mensajes_viaje ON mensajes_chat(viaje_id);
CREATE INDEX IF NOT EXISTS idx_calificaciones_viaje ON calificaciones(viaje_id);
CREATE INDEX IF NOT EXISTS idx_conductores_vehiculos_conductor ON conductores_vehiculos(conductor_id);
CREATE INDEX IF NOT EXISTS idx_conductores_vehiculos_vehiculo ON conductores_vehiculos(vehiculo_id);

-- ============================================
-- FUNCIÓN: actualizar updated_at automáticamente
-- ============================================
CREATE OR REPLACE FUNCTION actualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- ============================================
-- FUNCIÓN: actualizar calificación promedio
-- ============================================
CREATE OR REPLACE FUNCTION actualizar_calificacion_promedio()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE usuarios
  SET
    calificacion_promedio = (
      SELECT ROUND(AVG(puntuacion)::NUMERIC, 2)
      FROM calificaciones
      WHERE calificado_id = NEW.calificado_id
    ),
    total_calificaciones = (
      SELECT COUNT(*)
      FROM calificaciones
      WHERE calificado_id = NEW.calificado_id
    )
  WHERE id = NEW.calificado_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_actualizar_calificacion
  AFTER INSERT ON calificaciones
  FOR EACH ROW EXECUTE FUNCTION actualizar_calificacion_promedio();

-- ============================================
-- VISTA: resumen_viajes_conductor (para propietarios)
-- ============================================
CREATE OR REPLACE VIEW vista_ganancias_conductor AS
SELECT
  v.conductor_id,
  u.nombre || ' ' || u.apellido AS conductor_nombre,
  cv.vehiculo_id,
  veh.placa,
  DATE(v.fecha_fin) AS fecha,
  COUNT(v.id) AS total_viajes,
  SUM(v.precio_final) AS total_ganado,
  ROUND(AVG(v.distancia_km)::NUMERIC, 2) AS distancia_promedio_km,
  ROUND(AVG(cal.puntuacion)::NUMERIC, 2) AS calificacion_dia
FROM viajes v
JOIN usuarios u ON v.conductor_id = u.id
JOIN conductores_vehiculos cv ON v.conductor_id = cv.conductor_id AND cv.activo = TRUE
JOIN vehiculos veh ON cv.vehiculo_id = veh.id
LEFT JOIN calificaciones cal ON v.id = cal.viaje_id AND cal.calificado_id = v.conductor_id
WHERE v.estado = 'completado'
GROUP BY v.conductor_id, u.nombre, u.apellido, cv.vehiculo_id, veh.placa, DATE(v.fecha_fin);

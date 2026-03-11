-- Agregar columna push_token para notificaciones
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS push_token VARCHAR(200);

-- Índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_usuarios_push_token ON usuarios(push_token) WHERE push_token IS NOT NULL;

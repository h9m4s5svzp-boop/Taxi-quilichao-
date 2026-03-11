# 🚖 Taxi Quilichao - Backend

API REST + WebSockets para la app de taxis de Santander de Quilichao, Cauca.

---

## 📋 Requisitos

- Node.js v18+
- PostgreSQL 14+
- (Opcional) Redis para caché

---

## 🚀 Instalación paso a paso

### 1. Instalar dependencias
```bash
cd backend
npm install
```

### 2. Configurar variables de entorno
```bash
cp .env.example .env
# Editar .env con tus datos
```

### 3. Crear la base de datos en PostgreSQL
```sql
CREATE DATABASE taxi_quilichao;
```

### 4. Ejecutar migraciones (crea todas las tablas)
```bash
npm run migrate
```

### 5. Insertar datos de prueba
```bash
npm run seed
```

### 6. Iniciar el servidor
```bash
npm run dev    # desarrollo (con auto-reload)
npm start      # producción
```

---

## 📡 Endpoints disponibles

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/registro` | Registrar pasajero o conductor |
| POST | `/api/auth/login` | Iniciar sesión |
| GET | `/api/auth/perfil` | Ver perfil propio (requiere token) |

### Usuarios (solo admin)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/usuarios` | Listar todos los usuarios |
| PUT | `/api/usuarios/:id/activar` | Activar/desactivar usuario |

### Vehículos (propietario)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/vehiculos/mis-vehiculos` | Ver mis vehículos y conductores |
| POST | `/api/vehiculos` | Registrar nuevo vehículo |
| POST | `/api/vehiculos/:id/asignar-conductor` | Asignar conductor a vehículo |
| GET | `/api/vehiculos/:id/ganancias` | Ver ganancias y destinos del vehículo |

---

## 🔌 WebSocket Events

### Conductor → Servidor
| Evento | Datos | Descripción |
|--------|-------|-------------|
| `conductor:ubicacion` | `{latitud, longitud, disponible}` | Actualizar GPS |
| `chat:mensaje` | `{viaje_id, mensaje}` | Enviar mensaje |

### Pasajero → Servidor
| Evento | Datos | Descripción |
|--------|-------|-------------|
| `pasajero:buscar_conductores` | `{latitud, longitud}` | Buscar taxis cercanos |
| `chat:mensaje` | `{viaje_id, mensaje}` | Enviar mensaje |

### Servidor → Cliente
| Evento | Descripción |
|--------|-------------|
| `conductores:disponibles` | Lista de conductores cercanos |
| `chat:nuevo_mensaje` | Nuevo mensaje recibido |
| `conductor:posicion_actualizada` | (Solo admin) Posición de conductor |

---

## 👤 Roles y credenciales de prueba

Después de ejecutar `npm run seed`:

| Rol | Teléfono | Password |
|-----|----------|----------|
| Admin | 3001000000 | password123 |
| Propietario | 3001000001 | password123 |
| Conductor | 3001000002 | password123 |
| Pasajero | 3001000003 | password123 |

---

## 🗄️ Estructura de la base de datos

```
usuarios          → todos los roles (pasajero, conductor, propietario, admin)
vehiculos         → pertenecen a un propietario
conductores_vehiculos → qué conductor maneja qué vehículo
ubicaciones_conductores → GPS en tiempo real
viajes            → registro completo de cada viaje
calificaciones    → estrellas de pasajero ↔ conductor
mensajes_chat     → chat por viaje
```

---

## 📁 Estructura del proyecto

```
backend/
├── src/
│   ├── index.js              ← Servidor principal + Socket.io
│   ├── config/
│   │   └── database.js       ← Conexión PostgreSQL
│   ├── middleware/
│   │   └── auth.js           ← JWT + control de roles
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── usuariosController.js
│   │   └── vehiculosController.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── usuarios.js
│   │   └── vehiculos.js
│   └── migrations/
│       ├── 001_crear_tablas.sql
│       ├── run.js
│       └── seed.js
├── .env.example
└── package.json
```

---

## 🗺️ Próximas fases

- **Fase 2**: App móvil del pasajero (React Native)
- **Fase 3**: App móvil del conductor con GPS
- **Fase 4**: Chat en tiempo real + notificaciones
- **Fase 5**: Calificaciones e historial
- **Fase 6**: Panel web de administración y propietario

const express = require('express');
const router = express.Router();
const { misVehiculos, crearVehiculo, asignarConductor, gananciasPorVehiculo } = require('../controllers/vehiculosController');
const { verificarToken, soloRoles } = require('../middleware/auth');

router.use(verificarToken);

router.get('/mis-vehiculos', soloRoles('propietario', 'admin'), misVehiculos);
router.post('/', soloRoles('propietario', 'admin'), crearVehiculo);
router.post('/:id/asignar-conductor', soloRoles('propietario', 'admin'), asignarConductor);
router.get('/:id/ganancias', soloRoles('propietario', 'admin'), gananciasPorVehiculo);

module.exports = router;

const express = require('express');
const router = express.Router();
const { misViajes, misGanancias, calificar } = require('../controllers/viajesController');
const { verificarToken, soloRoles } = require('../middleware/auth');

router.use(verificarToken);

router.get('/mis-viajes', misViajes);
router.get('/mis-ganancias', soloRoles('conductor'), misGanancias);
router.post('/calificar', calificar);

module.exports = router;

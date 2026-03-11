const express = require('express');
const router = express.Router();
const { listarUsuarios, toggleActivar } = require('../controllers/usuariosController');
const { verificarToken, soloRoles } = require('../middleware/auth');

router.use(verificarToken);
router.get('/', soloRoles('admin'), listarUsuarios);
router.put('/:id/activar', soloRoles('admin'), toggleActivar);

module.exports = router;

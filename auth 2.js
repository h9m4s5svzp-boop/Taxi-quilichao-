const express = require('express');
const router = express.Router();
const { registro, login, perfil, guardarPushToken } = require('../controllers/authController');
const { verificarToken } = require('../middleware/auth');

router.post('/registro', registro);
router.post('/login', login);
router.get('/perfil', verificarToken, perfil);
router.post('/push-token', verificarToken, guardarPushToken);

module.exports = router;

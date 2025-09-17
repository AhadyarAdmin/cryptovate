const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { handleValidationErrors } = require('../middleware/validation.middleware');
const { body } = require('express-validator');

// Alle User-Routes benötigen Authentifizierung
router.use(authenticateToken);

// Profil abrufen
router.get('/profile', userController.getProfile);

// Profil aktualisieren
router.put('/profile', [
  body('firstName').optional().trim().isLength({ min: 2, max: 50 }),
  body('lastName').optional().trim().isLength({ min: 2, max: 50 }),
  body('username').optional().trim().isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/),
  handleValidationErrors
], userController.updateProfile);

// Passwort ändern
router.put('/change-password', [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  handleValidationErrors
], userController.changePassword);

// Account deaktivieren
router.put('/deactivate', userController.deactivateAccount);

module.exports = router;
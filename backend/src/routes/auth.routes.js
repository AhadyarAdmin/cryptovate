const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { registerValidation, loginValidation, handleValidationErrors } = require('../middleware/validation.middleware');
const { body } = require('express-validator');

// Registrierung initiieren
router.post('/register/initiate', registerValidation, authController.initiateRegistration);

// Registrierung mit OTP abschließen
router.post('/register/complete', [
  body('tempToken').notEmpty(),
  body('otpCode').isLength({ min: 6, max: 6 }).isNumeric(),
  handleValidationErrors
], authController.completeRegistration);

// Login
router.post('/login', loginValidation, authController.login);

// Passwort zurücksetzen initiieren
router.post('/password-reset/initiate', [
  body('email').isEmail().normalizeEmail(),
  handleValidationErrors
], authController.initiatePasswordReset);

// Passwort zurücksetzen abschließen
router.post('/password-reset/complete', [
  body('email').isEmail().normalizeEmail(),
  body('otpCode').isLength({ min: 6, max: 6 }).isNumeric(),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  handleValidationErrors
], authController.completePasswordReset);

module.exports = router;
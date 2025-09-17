const express = require('express');
const router = express.Router();
const kycController = require('../controllers/kyc.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { handleValidationErrors } = require('../middleware/validation.middleware');
const { body } = require('express-validator');

// Alle KYC-Routes benötigen Authentifizierung
router.use(authenticateToken);

// KYC-Dokumente hochladen
router.post('/upload', [
  body('documentType').isIn(['passport', 'id_card', 'driver_license']),
  body('documentNumber').trim().isLength({ min: 5, max: 50 }),
  handleValidationErrors
], kycController.uploadDocuments);

// KYC-Status abrufen
router.get('/status', kycController.getKYCStatus);

module.exports = router;
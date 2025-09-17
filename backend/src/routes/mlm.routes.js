const express = require('express');
const router = express.Router();
const mlmController = require('../controllers/mlm.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { handleValidationErrors } = require('../middleware/validation.middleware');
const { query } = require('express-validator');

// Alle MLM-Routes benötigen Authentifizierung
router.use(authenticateToken);

// MLM-Struktur abrufen
router.get('/structure', mlmController.getMLMStructure);

// Referral-Link abrufen
router.get('/referral-link', mlmController.getReferralLink);

// Provisionen abrufen
router.get('/commissions', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('type').optional().isIn(['referral', 'binary', 'matching']),
  handleValidationErrors
], mlmController.getCommissions);

// Team-Übersicht abrufen
router.get('/team', mlmController.getTeamOverview);

// Leaderboard abrufen
router.get('/leaderboard', [
  query('period').optional().isIn(['all', 'month', 'week']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  handleValidationErrors
], mlmController.getLeaderboard);

module.exports = router;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const smsService = require('../services/sms.service');
const mlmService = require('../services/mlm.service');

class AuthController {
  // Registrierung initiieren
  async initiateRegistration(req, res) {
    try {
      const { email, phone, password, firstName, lastName, referralCode } = req.body;

      // Prüfen ob Email oder Telefon bereits existiert
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1 OR phone = $2',
        [email, phone]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Email or phone number already registered'
        });
      }

      // Referral-Code validieren (falls vorhanden)
      let referrerId = null;
      if (referralCode) {
        const referrerResult = await mlmService.findUserByReferralCode(referralCode);
        if (!referrerResult.success) {
          return res.status(400).json({
            success: false,
            error: 'Invalid referral code'
          });
        }
        referrerId = referrerResult.data.id;
      }

      // Passwort hashen
      const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS));

      // Temporäre Registrierungsdaten speichern (in Session oder temporärer Tabelle)
      const tempData = {
        email,
        phone,
        passwordHash,
        firstName,
        lastName,
        referrerId,
        timestamp: Date.now()
      };

      // JWT für temporäre Registrierung
      const tempToken = jwt.sign(tempData, process.env.JWT_SECRET, { expiresIn: '10m' });

      // OTP senden
      await smsService.sendOTP(phone, 'registration');

      res.status(200).json({
        success: true,
        message: 'OTP sent to phone number',
        tempToken
      });
    } catch (error) {
      console.error('Registration initiation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Registration failed'
      });
    }
  }

  // Registrierung mit OTP abschließen
  async completeRegistration(req, res) {
    try {
      const { tempToken, otpCode } = req.body;

      // Temporären Token validieren
      let tempData;
      try {
        tempData = jwt.verify(tempToken, process.env.JWT_SECRET);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired registration token'
        });
      }

      // OTP validieren
      const otpResult = await smsService.verifyOTP(tempData.phone, otpCode, 'registration');
      if (!otpResult.success) {
        return res.status(400).json({
          success: false,
          error: otpResult.error
        });
      }

      // Benutzer erstellen
      const userResult = await pool.query(
        `INSERT INTO users (email, phone, password_hash, first_name, last_name, is_verified)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id, email, first_name, last_name`,
        [tempData.email, tempData.phone, tempData.passwordHash, tempData.firstName, tempData.lastName]
      );

      const user = userResult.rows[0];

      // Referral-Code generieren
      const referralResult = await mlmService.generateReferralCode(user.id);

      // MLM-Struktur erstellen
      if (tempData.referrerId) {
        await mlmService.createMLMNode(user.id, tempData.referrerId);
      } else {
        await mlmService.createMLMNode(user.id);
      }

      // JWT-Token für Anmeldung generieren
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      res.status(201).json({
        success: true,
        message: 'Registration completed successfully',
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          referralCode: referralResult.referralCode,
          referralLink: referralResult.referralLink
        }
      });
    } catch (error) {
      console.error('Registration completion failed:', error);
      res.status(500).json({
        success: false,
        error: 'Registration completion failed'
      });
    }
  }

  // Login
  async login(req, res) {
    try {
      const { email, password } = req.body;

      // Benutzer finden
      const userResult = await pool.query(
        'SELECT id, email, password_hash, first_name, last_name, is_active, is_verified FROM users WHERE email = $1',
        [email]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      const user = userResult.rows[0];

      if (!user.is_active) {
        return res.status(401).json({
          success: false,
          error: 'Account is deactivated'
        });
      }

      // Passwort validieren
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      // JWT-Token generieren
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      res.status(200).json({
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          isVerified: user.is_verified
        }
      });
    } catch (error) {
      console.error('Login failed:', error);
      res.status(500).json({
        success: false,
        error: 'Login failed'
      });
    }
  }

  // Passwort zurücksetzen initiieren
  async initiatePasswordReset(req, res) {
    try {
      const { email } = req.body;

      const userResult = await pool.query(
        'SELECT id, phone FROM users WHERE email = $1',
        [email]
      );

      if (userResult.rows.length === 0) {
        // Aus Sicherheitsgründen immer success zurückgeben
        return res.status(200).json({
          success: true,
          message: 'If the email exists, an OTP has been sent'
        });
      }

      const user = userResult.rows[0];
      await smsService.sendOTP(user.phone, 'password_reset', user.id);

      res.status(200).json({
        success: true,
        message: 'OTP sent to registered phone number'
      });
    } catch (error) {
      console.error('Password reset initiation failed:', error);
      res.status(500).json({
        success: false,
        error: 'Password reset failed'
      });
    }
  }

  // Passwort zurücksetzen abschließen
  async completePasswordReset(req, res) {
    try {
      const { email, otpCode, newPassword } = req.body;

      const userResult = await pool.query(
        'SELECT id, phone FROM users WHERE email = $1',
        [email]
      );

      if (userResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request'
        });
      }

      const user = userResult.rows[0];

      // OTP validieren
      const otpResult = await smsService.verifyOTP(user.phone, otpCode, 'password_reset');
      if (!otpResult.success) {
        return res.status(400).json({
          success: false,
          error: otpResult.error
        });
      }

      // Neues Passwort hashen und speichern
      const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS));
      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, user.id]
      );

      res.status(200).json({
        success: true,
        message: 'Password reset successful'
      });
    } catch (error) {
      console.error('Password reset completion failed:', error);
      res.status(500).json({
        success: false,
        error: 'Password reset failed'
      });
    }
  }
}

module.exports = new AuthController();

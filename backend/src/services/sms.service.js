const axios = require('axios');
const pool = require('../config/database');

class SMSService {
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendOTP(phone, type = 'registration', userId = null) {
    try {
      const code = this.generateOTP();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 Minuten

      // Alte OTPs für diese Nummer löschen
      await pool.query(
        'DELETE FROM otp_codes WHERE phone = $1 AND type = $2',
        [phone, type]
      );

      // OTP in Datenbank speichern
      await pool.query(
        'INSERT INTO otp_codes (user_id, phone, code, type, expires_at) VALUES ($1, $2, $3, $4, $5)',
        [userId, phone, code, type, expiresAt]
      );

      // SMS senden
      const response = await axios.post(process.env.SMS_API_URL, {
        to: phone,
        message: `Your Cryptovate verification code is: ${code}. Valid for 5 minutes.`,
        from: 'Cryptovate'
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.SMS_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('SMS sent successfully:', response.data);
      return {
        success: true,
        message: 'OTP sent successfully'
      };
    } catch (error) {
      console.error('SMS sending failed:', error);
      throw new Error(`SMS sending failed: ${error.message}`);
    }
  }

  async verifyOTP(phone, code, type = 'registration') {
    try {
      const result = await pool.query(
        'SELECT * FROM otp_codes WHERE phone = $1 AND code = $2 AND type = $3 AND is_used = false AND expires_at > NOW()',
        [phone, code, type]
      );

      if (result.rows.length === 0) {
        return {
          success: false,
          error: 'Invalid or expired OTP'
        };
      }

      // OTP als verwendet markieren
      await pool.query(
        'UPDATE otp_codes SET is_used = true WHERE id = $1',
        [result.rows[0].id]
      );

      return {
        success: true,
        message: 'OTP verified successfully'
      };
    } catch (error) {
      console.error('OTP verification failed:', error);
      throw new Error(`OTP verification failed: ${error.message}`);
    }
  }
}

module.exports = new SMSService();

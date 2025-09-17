const axios = require('axios');
const pool = require('../config/database');

class KYCService {
  async submitKYCData(userId, kycData) {
    try {
      // KYC-Daten in Datenbank speichern
      const result = await pool.query(
        `INSERT INTO kyc_data (user_id, document_type, document_number, document_front_url, document_back_url, selfie_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
        [
          userId,
          kycData.documentType,
          kycData.documentNumber,
          kycData.documentFrontUrl,
          kycData.documentBackUrl,
          kycData.selfieUrl
        ]
      );

      // KYC-API aufrufen
      const response = await axios.post(process.env.KYC_API_URL, {
        documentType: kycData.documentType,
        documentNumber: kycData.documentNumber,
        documentFrontImage: kycData.documentFrontUrl,
        documentBackImage: kycData.documentBackUrl,
        selfieImage: kycData.selfieUrl
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.KYC_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      // Ergebnis in Datenbank aktualisieren
      await this.updateKYCStatus(userId, response.data);
      
      return {
        success: true,
        data: response.data,
        kycId: result.rows[0].id
      };
    } catch (error) {
      console.error('KYC submission failed:', error);
      
      // Status auf 'failed' setzen
      await pool.query(
        'UPDATE kyc_data SET status = $1 WHERE user_id = $2',
        ['failed', userId]
      );
      
      throw new Error(`KYC verification failed: ${error.message}`);
    }
  }

  async updateKYCStatus(userId, verificationResult) {
    try {
      const status = verificationResult.approved ? 'approved' : 'rejected';
      
      await pool.query(
        'UPDATE kyc_data SET status = $1, verification_data = $2, updated_at = NOW() WHERE user_id = $3',
        [status, JSON.stringify(verificationResult), userId]
      );

      // Benutzer-Status aktualisieren
      if (status === 'approved') {
        await pool.query(
          'UPDATE users SET is_verified = true WHERE id = $1',
          [userId]
        );
      }

      return { success: true, status };
    } catch (error) {
      console.error('KYC status update failed:', error);
      throw new Error(`KYC status update failed: ${error.message}`);
    }
  }

  async getKYCStatus(userId) {
    try {
      const result = await pool.query(
        'SELECT status, document_type, created_at, updated_at FROM kyc_data WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );

      if (result.rows.length === 0) {
        return { success: true, status: 'not_submitted' };
      }

      return {
        success: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Get KYC status failed:', error);
      throw new Error(`Get KYC status failed: ${error.message}`);
    }
  }
}

module.exports = new KYCService();

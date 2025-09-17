const pool = require('../config/database');
const bcrypt = require('bcrypt');

class UserController {
  // Benutzerprofil abrufen
  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      const result = await pool.query(
        `SELECT u.id, u.email, u.phone, u.first_name, u.last_name, u.username, 
                u.avatar_url, u.is_verified, u.kyc_status, u.referral_code, u.created_at,
                COUNT(mn.id) as total_referrals
         FROM users u
         LEFT JOIN mlm_nodes mn ON u.id = (
           SELECT user_id FROM mlm_nodes WHERE parent_id = (
             SELECT id FROM mlm_nodes WHERE user_id = u.id
           )
         )
         WHERE u.id = $1
         GROUP BY u.id`,
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const user = result.rows[0];

      res.status(200).json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          firstName: user.first_name,
          lastName: user.last_name,
          username: user.username,
          avatarUrl: user.avatar_url,
          isVerified: user.is_verified,
          kycStatus: user.kyc_status,
          referralCode: user.referral_code,
          totalReferrals: parseInt(user.total_referrals) || 0,
          memberSince: user.created_at,
          referralLink: `${process.env.APP_URL}/register?ref=${user.referral_code}`
        }
      });
    } catch (error) {
      console.error('Get profile failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get profile'
      });
    }
  }

  // Profil aktualisieren
  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const { firstName, lastName, username } = req.body;

      // Username-Eindeutigkeit prüfen (falls angegeben)
      if (username) {
        const existingUser = await pool.query(
          'SELECT id FROM users WHERE username = $1 AND id != $2',
          [username, userId]
        );

        if (existingUser.rows.length > 0) {
          return res.status(400).json({
            success: false,
            error: 'Username already taken'
          });
        }
      }

      const result = await pool.query(
        `UPDATE users 
         SET first_name = $1, last_name = $2, username = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING first_name, last_name, username`,
        [firstName, lastName, username, userId]
      );

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Update profile failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update profile'
      });
    }
  }

  // Passwort ändern
  async changePassword(req, res) {
    try {
      const userId = req.user.id;
      const { currentPassword, newPassword } = req.body;

      // Aktuelles Passwort validieren
      const userResult = await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
      );

      const isValidPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }

      // Neues Passwort hashen und speichern
      const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS));
      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, userId]
      );

      res.status(200).json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      console.error('Change password failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to change password'
      });
    }
  }

  // Benutzer deaktivieren
  async deactivateAccount(req, res) {
    try {
      const userId = req.user.id;

      await pool.query(
        'UPDATE users SET is_active = false WHERE id = $1',
        [userId]
      );

      res.status(200).json({
        success: true,
        message: 'Account deactivated successfully'
      });
    } catch (error) {
      console.error('Deactivate account failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to deactivate account'
      });
    }
  }
}

module.exports = new UserController();

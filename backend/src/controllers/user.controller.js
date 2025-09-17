// backend/src/controllers/user.controller.js
const pool = require('../config/database');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');

// Multer-Konfiguration für Avatar-Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.env.UPLOAD_PATH || './uploads', 'avatars'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `avatar-${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only JPEG, JPG and PNG files are allowed'));
    }
  }
});

class UserController {
  // Benutzerprofil abrufen
  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      const userResult = await pool.query(`
        SELECT 
          u.id, u.email, u.phone, u.first_name, u.last_name, 
          u.username, u.avatar_url, u.is_verified, u.kyc_status,
          u.referral_code, u.created_at,
          mn.level, mn.left_count, mn.right_count, mn.total_volume
        FROM users u
        LEFT JOIN mlm_nodes mn ON u.id = mn.user_id
        WHERE u.id = $1
      `, [userId]);

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const user = userResult.rows[0];

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
          createdAt: user.created_at,
          mlm: {
            level: user.level,
            leftCount: user.left_count,
            rightCount: user.right_count,
            totalVolume: parseFloat(user.total_volume) || 0
          }
        }
      });
    } catch (error) {
      console.error('Get profile failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user profile'
      });
    }
  }

  // Profil aktualisieren
  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const { firstName, lastName, username } = req.body;

      // Prüfen ob Username bereits existiert (falls geändert)
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

      const result = await pool.query(`
        UPDATE users 
        SET first_name = COALESCE($1, first_name),
            last_name = COALESCE($2, last_name),
            username = COALESCE($3, username),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING id, email, first_name, last_name, username, avatar_url
      `, [firstName, lastName, username, userId]);

      const updatedUser = result.rows[0];

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          id: updatedUser.id,
          email: updatedUser.email,
          firstName: updatedUser.first_name,
          lastName: updatedUser.last_name,
          username: updatedUser.username,
          avatarUrl: updatedUser.avatar_url
        }
      });
    } catch (error) {
      console.error('Update profile failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update profile'
      });
    }
  }

  // Avatar hochladen
  async uploadAvatar(req, res) {
    try {
      const uploadSingle = upload.single('avatar');

      uploadSingle(req, res, async (err) => {
        if (err) {
          return res.status(400).json({
            success: false,
            error: err.message
          });
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'No file uploaded'
          });
        }

        const userId = req.user.id;
        const avatarUrl = `/uploads/avatars/${req.file.filename}`;

        try {
          await pool.query(
            'UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [avatarUrl, userId]
          );

          res.status(200).json({
            success: true,
            message: 'Avatar uploaded successfully',
            data: {
              avatarUrl
            }
          });
        } catch (dbError) {
          console.error('Avatar upload database error:', dbError);
          res.status(500).json({
            success: false,
            error: 'Failed to save avatar'
          });
        }
      });
    } catch (error) {
      console.error('Avatar upload failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload avatar'
      });
    }
  }

  // Passwort ändern
  async changePassword(req, res) {
    try {
      const userId = req.user.id;
      const { currentPassword, newPassword } = req.body;

      // Aktuelles Passwort überprüfen
      const userResult = await pool.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const user = userResult.rows[0];
      const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);

      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }

      // Neues Passwort hashen und speichern
      const newPasswordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS || 12));
      await pool.query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newPasswordHash, userId]
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

  // Benutzer suchen (für MLM)
  async searchUsers(req, res) {
    try {
      const { query, limit = 10 } = req.query;

      if (!query || query.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Search query must be at least 2 characters'
        });
      }

      const searchResult = await pool.query(`
        SELECT 
          id, email, first_name, last_name, username, avatar_url, referral_code
        FROM users 
        WHERE 
          (first_name ILIKE $1 OR last_name ILIKE $1 OR username ILIKE $1 OR email ILIKE $1)
          AND is_active = true
        ORDER BY first_name, last_name
        LIMIT $2
      `, [`%${query}%`, parseInt(limit)]);

      const users = searchResult.rows.map(user => ({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        avatarUrl: user.avatar_url,
        referralCode: user.referral_code
      }));

      res.status(200).json({
        success: true,
        data: users
      });
    } catch (error) {
      console.error('Search users failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search users'
      });
    }
  }

  // Dashboard-Statistiken
  async getDashboardStats(req, res) {
    try {
      const userId = req.user.id;

      // Benutzer-Informationen
      const userResult = await pool.query(`
        SELECT kyc_status, is_verified, created_at FROM users WHERE id = $1
      `, [userId]);

      // MLM-Statistiken
      const mlmResult = await pool.query(`
        SELECT level, left_count, right_count, total_volume FROM mlm_nodes WHERE user_id = $1
      `, [userId]);

      // Provisionen-Statistiken
      const commissionResult = await pool.query(`
        SELECT 
          SUM(amount) as total_earnings,
          COUNT(*) as total_transactions
        FROM mlm_commissions 
        WHERE user_id = $1
      `, [userId]);

      // Referrals-Statistiken
      const referralResult = await pool.query(`
        WITH RECURSIVE downline_tree AS (
          SELECT user_id, 1 as level
          FROM mlm_nodes
          WHERE parent_id = (SELECT id FROM mlm_nodes WHERE user_id = $1)
          
          UNION ALL
          
          SELECT mn.user_id, dt.level + 1
          FROM mlm_nodes mn
          JOIN downline_tree dt ON mn.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = dt.user_id)
          WHERE dt.level < 5
        )
        SELECT COUNT(*) as total_referrals FROM downline_tree
      `, [userId]);

      const user = userResult.rows[0];
      const mlm = mlmResult.rows[0] || {};
      const commission = commissionResult.rows[0] || {};
      const referral = referralResult.rows[0] || {};

      res.status(200).json({
        success: true,
        data: {
          user: {
            kycStatus: user?.kyc_status || 'pending',
            isVerified: user?.is_verified || false,
            memberSince: user?.created_at
          },
          mlm: {
            level: mlm.level || 1,
            leftCount: mlm.left_count || 0,
            rightCount: mlm.right_count || 0,
            totalVolume: parseFloat(mlm.total_volume) || 0
          },
          earnings: {
            totalEarnings: parseFloat(commission.total_earnings) || 0,
            totalTransactions: parseInt(commission.total_transactions) || 0
          },
          referrals: {
            totalReferrals: parseInt(referral.total_referrals) || 0
          }
        }
      });
    } catch (error) {
      console.error('Get dashboard stats failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get dashboard statistics'
      });
    }
  }
}

module.exports = new UserController();
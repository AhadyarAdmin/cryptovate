const mlmService = require('../services/mlm.service');
const pool = require('../config/database');

class MLMController {
  // MLM-Struktur abrufen
  async getMLMStructure(req, res) {
    try {
      const userId = req.user.id;
      const result = await mlmService.getMLMStructure(userId);

      if (!result.success) {
        return res.status(404).json(result);
      }

      res.status(200).json({
        success: true,
        data: result.data
      });
    } catch (error) {
      console.error('Get MLM structure failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get MLM structure'
      });
    }
  }

  // Referral-Link abrufen
  async getReferralLink(req, res) {
    try {
      const userId = req.user.id;

      // Prüfen ob bereits ein Referral-Code existiert
      const userResult = await pool.query(
        'SELECT referral_code FROM users WHERE id = $1',
        [userId]
      );

      let referralCode = userResult.rows[0].referral_code;

      if (!referralCode) {
        // Neuen Referral-Code generieren
        const result = await mlmService.generateReferralCode(userId);
        referralCode = result.referralCode;
      }

      res.status(200).json({
        success: true,
        data: {
          referralCode,
          referralLink: `${process.env.APP_URL}/register?ref=${referralCode}`
        }
      });
    } catch (error) {
      console.error('Get referral link failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get referral link'
      });
    }
  }

  // Provisionen abrufen
  async getCommissions(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, type } = req.query;
      const offset = (page - 1) * limit;

      let whereClause = 'WHERE user_id = $1';
      let params = [userId];

      if (type) {
        whereClause += ' AND commission_type = $2';
        params.push(type);
      }

      // Provisionen mit Pagination abrufen
      const commissionsResult = await pool.query(
        `SELECT mc.*, u.first_name, u.last_name, u.email
         FROM mlm_commissions mc
         LEFT JOIN users u ON mc.from_user_id = u.id
         ${whereClause}
         ORDER BY mc.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      // Gesamtanzahl für Pagination
      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM mlm_commissions ${whereClause}`,
        params
      );

      // Gesamtstatistiken
      const statsResult = await pool.query(
        `SELECT 
           SUM(amount) as total_earnings,
           COUNT(*) as total_transactions,
           SUM(CASE WHEN commission_type = 'referral' THEN amount ELSE 0 END) as referral_earnings,
           SUM(CASE WHEN commission_type = 'binary' THEN amount ELSE 0 END) as binary_earnings
         FROM mlm_commissions 
         WHERE user_id = $1`,
        [userId]
      );

      const stats = statsResult.rows[0];

      res.status(200).json({
        success: true,
        data: {
          commissions: commissionsResult.rows,
          statistics: {
            totalEarnings: parseFloat(stats.total_earnings) || 0,
            totalTransactions: parseInt(stats.total_transactions) || 0,
            referralEarnings: parseFloat(stats.referral_earnings) || 0,
            binaryEarnings: parseFloat(stats.binary_earnings) || 0
          },
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: parseInt(countResult.rows[0].total),
            totalPages: Math.ceil(countResult.rows[0].total / limit)
          }
        }
      });
    } catch (error) {
      console.error('Get commissions failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get commissions'
      });
    }
  }

  // Team-Übersicht abrufen
  async getTeamOverview(req, res) {
    try {
      const userId = req.user.id;

      // Direkte Referrals
      const directReferralsResult = await pool.query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.created_at, u.is_verified,
                COUNT(sub_mn.id) as sub_referrals
         FROM mlm_nodes mn
         JOIN users u ON mn.user_id = u.id
         LEFT JOIN mlm_nodes sub_mn ON sub_mn.parent_id = mn.id
         WHERE mn.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = $1)
         GROUP BY u.id, u.first_name, u.last_name, u.email, u.created_at, u.is_verified
         ORDER BY u.created_at DESC`,
        [userId]
      );

      // Team-Statistiken nach Levels
      const levelStatsResult = await pool.query(
        `WITH RECURSIVE team_tree AS (
           SELECT mn.user_id, mn.level, 1 as team_level
           FROM mlm_nodes mn
           WHERE mn.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = $1)
           
           UNION ALL
           
           SELECT mn.user_id, mn.level, tt.team_level + 1
           FROM mlm_nodes mn
           INNER JOIN team_tree tt ON mn.parent_id = (
             SELECT id FROM mlm_nodes WHERE user_id = tt.user_id
           )
           WHERE tt.team_level < 10
         )
         SELECT team_level, COUNT(*) as count
         FROM team_tree
         GROUP BY team_level
         ORDER BY team_level`,
        [userId]
      );

      res.status(200).json({
        success: true,
        data: {
          directReferrals: directReferralsResult.rows,
          levelStatistics: levelStatsResult.rows,
          totalDirectReferrals: directReferralsResult.rows.length
        }
      });
    } catch (error) {
      console.error('Get team overview failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get team overview'
      });
    }
  }

  // MLM-Leaderboard
  async getLeaderboard(req, res) {
    try {
      const { period = 'all', limit = 50 } = req.query;

      let dateFilter = '';
      if (period === 'month') {
        dateFilter = "AND mc.created_at >= DATE_TRUNC('month', CURRENT_DATE)";
      } else if (period === 'week') {
        dateFilter = "AND mc.created_at >= DATE_TRUNC('week', CURRENT_DATE)";
      }

      const leaderboardResult = await pool.query(
        `SELECT u.id, u.first_name, u.last_name, u.username,
                SUM(mc.amount) as total_earnings,
                COUNT(mc.id) as total_transactions,
                (SELECT COUNT(*) FROM mlm_nodes mn2 
                 WHERE mn2.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = u.id)) as direct_referrals
         FROM users u
         JOIN mlm_commissions mc ON u.id = mc.user_id
         WHERE u.is_active = true ${dateFilter}
         GROUP BY u.id, u.first_name, u.last_name, u.username
         ORDER BY total_earnings DESC
         LIMIT $1`,
        [limit]
      );

      res.status(200).json({
        success: true,
        data: {
          leaderboard: leaderboardResult.rows,
          period
        }
      });
    } catch (error) {
      console.error('Get leaderboard failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get leaderboard'
      });
    }
  }
}

module.exports = new MLMController();
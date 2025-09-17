const pool = require('../config/database');

class MLMService {
  async createMLMNode(userId, parentId = null, position = null) {
    try {
      let level = 1;
      
      if (parentId) {
        // Parent-Level ermitteln
        const parentResult = await pool.query(
          'SELECT level FROM mlm_nodes WHERE user_id = $1',
          [parentId]
        );
        
        if (parentResult.rows.length > 0) {
          level = parentResult.rows[0].level + 1;
        }
      }

      // MLM-Node erstellen
      const result = await pool.query(
        'INSERT INTO mlm_nodes (user_id, parent_id, level, position) VALUES ($1, $2, $3, $4) RETURNING *',
        [userId, parentId, level, position]
      );

      // Parent-Zähler aktualisieren
      if (parentId && position) {
        const countField = position === 'left' ? 'left_count' : 'right_count';
        await pool.query(
          `UPDATE mlm_nodes SET ${countField} = ${countField} + 1 WHERE user_id = $1`,
          [parentId]
        );
      }

      return {
        success: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('MLM node creation failed:', error);
      throw new Error(`MLM node creation failed: ${error.message}`);
    }
  }

  async getMLMStructure(userId) {
    try {
      // Eigenen MLM-Node abrufen
      const nodeResult = await pool.query(
        `SELECT mn.*, u.first_name, u.last_name, u.email 
         FROM mlm_nodes mn 
         JOIN users u ON mn.user_id = u.id 
         WHERE mn.user_id = $1`,
        [userId]
      );

      if (nodeResult.rows.length === 0) {
        return { success: false, error: 'MLM node not found' };
      }

      const userNode = nodeResult.rows[0];

      // Direkte Downline abrufen
      const downlineResult = await pool.query(
        `SELECT mn.*, u.first_name, u.last_name, u.email, u.created_at as join_date
         FROM mlm_nodes mn 
         JOIN users u ON mn.user_id = u.id 
         WHERE mn.parent_id = $1
         ORDER BY mn.created_at ASC`,
        [userNode.id]
      );

      // Gesamte Downline-Statistiken
      const statsResult = await pool.query(
        `WITH RECURSIVE downline AS (
           SELECT id, user_id, parent_id, level
           FROM mlm_nodes
           WHERE user_id = $1
           
           UNION ALL
           
           SELECT mn.id, mn.user_id, mn.parent_id, mn.level
           FROM mlm_nodes mn
           INNER JOIN downline d ON mn.parent_id = d.id
         )
         SELECT COUNT(*) - 1 as total_downline,
                SUM(CASE WHEN level = $2 THEN 1 ELSE 0 END) as direct_referrals
         FROM downline d
         JOIN mlm_nodes mn ON d.id = mn.id`,
        [userId, userNode.level + 1]
      );

      // Provisionen abrufen
      const commissionsResult = await pool.query(
        `SELECT SUM(amount) as total_earnings,
                COUNT(*) as total_transactions
         FROM mlm_commissions 
         WHERE user_id = $1`,
        [userId]
      );

      return {
        success: true,
        data: {
          userNode: {
            id: userNode.id,
            level: userNode.level,
            leftCount: userNode.left_count,
            rightCount: userNode.right_count,
            totalVolume: userNode.total_volume,
            position: userNode.position
          },
          directDownline: downlineResult.rows,
          statistics: {
            totalDownline: parseInt(statsResult.rows[0].total_downline) || 0,
            directReferrals: parseInt(statsResult.rows[0].direct_referrals) || 0,
            totalEarnings: parseFloat(commissionsResult.rows[0].total_earnings) || 0,
            totalTransactions: parseInt(commissionsResult.rows[0].total_transactions) || 0
          }
        }
      };
    } catch (error) {
      console.error('Get MLM structure failed:', error);
      throw new Error(`Get MLM structure failed: ${error.message}`);
    }
  }

  async generateReferralCode(userId) {
    try {
      // Eindeutigen Referral-Code generieren
      let referralCode;
      let isUnique = false;
      
      while (!isUnique) {
        referralCode = 'CRV' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const existingResult = await pool.query(
          'SELECT id FROM users WHERE referral_code = $1',
          [referralCode]
        );
        
        if (existingResult.rows.length === 0) {
          isUnique = true;
        }
      }

      // Referral-Code in Benutzer-Tabelle speichern
      await pool.query(
        'UPDATE users SET referral_code = $1 WHERE id = $2',
        [referralCode, userId]
      );

      return {
        success: true,
        referralCode,
        referralLink: `${process.env.APP_URL}/register?ref=${referralCode}`
      };
    } catch (error) {
      console.error('Generate referral code failed:', error);
      throw new Error(`Generate referral code failed: ${error.message}`);
    }
  }

  async findUserByReferralCode(referralCode) {
    try {
      const result = await pool.query(
        'SELECT id, first_name, last_name FROM users WHERE referral_code = $1',
        [referralCode]
      );

      if (result.rows.length === 0) {
        return { success: false, error: 'Invalid referral code' };
      }

      return {
        success: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Find user by referral code failed:', error);
      throw new Error(`Find user by referral code failed: ${error.message}`);
    }
  }

  async calculateCommission(fromUserId, amount, transactionId) {
    try {
      // MLM-Struktur nach oben durchlaufen und Provisionen berechnen
      const uplineResult = await pool.query(
        `WITH RECURSIVE upline AS (
           SELECT mn.user_id, mn.parent_id, mn.level, 1 as commission_level
           FROM mlm_nodes mn
           WHERE mn.user_id = $1
           
           UNION ALL
           
           SELECT mn.user_id, mn.parent_id, mn.level, u.commission_level + 1
           FROM mlm_nodes mn
           INNER JOIN upline u ON mn.user_id = (
             SELECT user_id FROM mlm_nodes WHERE id = u.parent_id
           )
           WHERE u.commission_level < 10
         )
         SELECT user_id, commission_level FROM upline WHERE commission_level > 1`,
        [fromUserId]
      );

      const commissions = [];
      const commissionRates = {
        1: 0.10, // 10% für Level 1
        2: 0.05, // 5% für Level 2
        3: 0.03, // 3% für Level 3
        4: 0.02, // 2% für Level 4
        5: 0.01  // 1% für Level 5+
      };

      for (const uplineUser of uplineResult.rows) {
        const level = uplineUser.commission_level - 1;
        const rate = commissionRates[level] || commissionRates[5];
        const commissionAmount = amount * rate;

        // Provision in Datenbank speichern
        await pool.query(
          'INSERT INTO mlm_commissions (user_id, from_user_id, amount, level, commission_type, transaction_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [uplineUser.user_id, fromUserId, commissionAmount, level, 'referral', transactionId]
        );

        commissions.push({
          userId: uplineUser.user_id,
          level,
          amount: commissionAmount,
          rate
        });
      }

      return {
        success: true,
        commissions
      };
    } catch (error) {
      console.error('Calculate commission failed:', error);
      throw new Error(`Calculate commission failed: ${error.message}`);
    }
  }
}

module.exports = new MLMService();

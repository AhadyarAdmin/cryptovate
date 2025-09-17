// backend/src/services/mlm.service.js
const pool = require('../config/database');
const crypto = require('crypto');

class MLMService {
  // Referral-Code generieren
  async generateReferralCode(userId) {
    try {
      let referralCode;
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        referralCode = this.generateUniqueCode();
        
        const existingResult = await pool.query(
          'SELECT id FROM users WHERE referral_code = $1',
          [referralCode]
        );

        if (existingResult.rows.length === 0) {
          isUnique = true;
        }
        attempts++;
      }

      if (!isUnique) {
        throw new Error('Could not generate unique referral code');
      }

      // Referral-Code in der Datenbank speichern
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
      return {
        success: false,
        error: 'Failed to generate referral code'
      };
    }
  }

  // Eindeutigen Code generieren
  generateUniqueCode(length = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Benutzer anhand Referral-Code finden
  async findUserByReferralCode(referralCode) {
    try {
      const result = await pool.query(
        'SELECT id, first_name, last_name, email FROM users WHERE referral_code = $1 AND is_active = true',
        [referralCode]
      );

      if (result.rows.length === 0) {
        return {
          success: false,
          error: 'Referral code not found'
        };
      }

      return {
        success: true,
        data: result.rows[0]
      };
    } catch (error) {
      console.error('Find user by referral code failed:', error);
      return {
        success: false,
        error: 'Failed to find user'
      };
    }
  }

  // MLM-Node erstellen
  async createMLMNode(userId, parentId = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let level = 1;
      let position = null;

      if (parentId) {
        // Parent-Level ermitteln
        const parentResult = await client.query(
          'SELECT level, left_count, right_count FROM mlm_nodes WHERE user_id = $1',
          [parentId]
        );

        if (parentResult.rows.length === 0) {
          throw new Error('Parent node not found');
        }

        const parent = parentResult.rows[0];
        level = parent.level + 1;

        // Position bestimmen (Binary Tree - links oder rechts)
        if (parent.left_count <= parent.right_count) {
          position = 'left';
        } else {
          position = 'right';
        }

        // Parent-Zähler aktualisieren
        const updateField = position === 'left' ? 'left_count' : 'right_count';
        await client.query(
          `UPDATE mlm_nodes SET ${updateField} = ${updateField} + 1 WHERE user_id = $1`,
          [parentId]
        );
      }

      // Neuen MLM-Node erstellen
      const nodeResult = await client.query(
        `INSERT INTO mlm_nodes (user_id, parent_id, level, position)
         SELECT $1, mn.id, $2, $3
         FROM mlm_nodes mn
         WHERE mn.user_id = $4
         RETURNING id`,
        [userId, level, position, parentId]
      );

      if (parentId && nodeResult.rows.length === 0) {
        // Falls Parent-ID direkt verwendet werden soll
        await client.query(
          `INSERT INTO mlm_nodes (user_id, parent_id, level, position)
           VALUES ($1, $2, $3, $4)`,
          [userId, parentId, level, position]
        );
      } else if (!parentId) {
        // Root-Node erstellen
        await client.query(
          `INSERT INTO mlm_nodes (user_id, level) VALUES ($1, $2)`,
          [userId, 1]
        );
      }

      await client.query('COMMIT');

      return {
        success: true,
        message: 'MLM node created successfully'
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Create MLM node failed:', error);
      return {
        success: false,
        error: 'Failed to create MLM node'
      };
    } finally {
      client.release();
    }
  }

  // MLM-Struktur abrufen
  async getMLMStructure(userId) {
    try {
      const nodeResult = await pool.query(
        `SELECT mn.*, u.first_name, u.last_name, u.email, u.avatar_url
         FROM mlm_nodes mn
         JOIN users u ON mn.user_id = u.id
         WHERE mn.user_id = $1`,
        [userId]
      );

      if (nodeResult.rows.length === 0) {
        return {
          success: false,
          error: 'MLM node not found'
        };
      }

      const node = nodeResult.rows[0];

      // Parent-Informationen abrufen
      let parent = null;
      if (node.parent_id) {
        const parentResult = await pool.query(
          `SELECT mn.*, u.first_name, u.last_name, u.email
           FROM mlm_nodes mn
           JOIN users u ON mn.user_id = u.id
           WHERE mn.id = $1`,
          [node.parent_id]
        );

        if (parentResult.rows.length > 0) {
          parent = parentResult.rows[0];
        }
      }

      // Direkte Downlines abrufen
      const downlinesResult = await pool.query(
        `SELECT mn.*, u.first_name, u.last_name, u.email, u.avatar_url
         FROM mlm_nodes mn
         JOIN users u ON mn.user_id = u.id
         WHERE mn.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = $1)
         ORDER BY mn.position, mn.created_at`,
        [userId]
      );

      return {
        success: true,
        data: {
          node: {
            ...node,
            user: {
              firstName: node.first_name,
              lastName: node.last_name,
              email: node.email,
              avatarUrl: node.avatar_url
            }
          },
          parent,
          downlines: downlinesResult.rows.map(d => ({
            ...d,
            user: {
              firstName: d.first_name,
              lastName: d.last_name,
              email: d.email,
              avatarUrl: d.avatar_url
            }
          }))
        }
      };
    } catch (error) {
      console.error('Get MLM structure failed:', error);
      return {
        success: false,
        error: 'Failed to get MLM structure'
      };
    }
  }

  // Downlines mit mehren Ebenen abrufen
  async getDownlines(userId, options = {}) {
    try {
      const { maxLevels = 5, position } = options;

      let positionClause = '';
      let params = [userId, maxLevels];

      if (position) {
        positionClause = 'AND mn.position = $3';
        params.push(position);
      }

      const query = `
        WITH RECURSIVE downline_tree AS (
          -- Base case: Direct downlines
          SELECT mn.*, u.first_name, u.last_name, u.email, u.avatar_url, 1 as relative_level
          FROM mlm_nodes mn
          JOIN users u ON mn.user_id = u.id
          WHERE mn.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = $1)
          ${positionClause}
          
          UNION ALL
          
          -- Recursive case: Downlines of downlines
          SELECT mn.*, u.first_name, u.last_name, u.email, u.avatar_url, dt.relative_level + 1
          FROM mlm_nodes mn
          JOIN users u ON mn.user_id = u.id
          JOIN downline_tree dt ON mn.parent_id = dt.id
          WHERE dt.relative_level < $2
        )
        SELECT * FROM downline_tree
        ORDER BY relative_level, position, created_at
      `;

      const result = await pool.query(query, params);

      // Ergebnisse nach Levels gruppieren
      const downlinesByLevel = {};
      result.rows.forEach(downline => {
        const level = downline.relative_level;
        if (!downlinesByLevel[level]) {
          downlinesByLevel[level] = [];
        }
        downlinesByLevel[level].push({
          ...downline,
          user: {
            firstName: downline.first_name,
            lastName: downline.last_name,
            email: downline.email,
            avatarUrl: downline.avatar_url
          }
        });
      });

      return {
        success: true,
        data: {
          downlinesByLevel,
          totalDownlines: result.rows.length,
          maxLevelsSearched: maxLevels
        }
      };
    } catch (error) {
      console.error('Get downlines failed:', error);
      return {
        success: false,
        error: 'Failed to get downlines'
      };
    }
  }

  // Uplines abrufen
  async getUplines(userId) {
    try {
      const query = `
        WITH RECURSIVE upline_tree AS (
          -- Base case: Current user
          SELECT mn.*, u.first_name, u.last_name, u.email, u.avatar_url, 0 as relative_level
          FROM mlm_nodes mn
          JOIN users u ON mn.user_id = u.id
          WHERE mn.user_id = $1
          
          UNION ALL
          
          -- Recursive case: Parents of parents
          SELECT mn.*, u.first_name, u.last_name, u.email, u.avatar_url, ut.relative_level + 1
          FROM mlm_nodes mn
          JOIN users u ON mn.user_id = u.id
          JOIN upline_tree ut ON mn.id = ut.parent_id
        )
        SELECT * FROM upline_tree
        WHERE relative_level > 0
        ORDER BY relative_level
      `;

      const result = await pool.query(query, [userId]);

      return {
        success: true,
        data: result.rows.map(upline => ({
          ...upline,
          user: {
            firstName: upline.first_name,
            lastName: upline.last_name,
            email: upline.email,
            avatarUrl: upline.avatar_url
          }
        }))
      };
    } catch (error) {
      console.error('Get uplines failed:', error);
      return {
        success: false,
        error: 'Failed to get uplines'
      };
    }
  }

  // Team-Statistiken berechnen
  async getTeamStatistics(userId) {
    try {
      // Gesamt-Downlines zählen
      const downlineCountResult = await pool.query(`
        WITH RECURSIVE downline_tree AS (
          SELECT mn.user_id, 1 as level
          FROM mlm_nodes mn
          WHERE mn.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = $1)
          
          UNION ALL
          
          SELECT mn.user_id, dt.level + 1
          FROM mlm_nodes mn
          JOIN downline_tree dt ON mn.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = dt.user_id)
          WHERE dt.level < 10
        )
        SELECT COUNT(*) as total_downlines, MAX(level) as max_depth
        FROM downline_tree
      `, [userId]);

      // Provisionen-Statistiken
      const commissionStatsResult = await pool.query(`
        SELECT 
          COUNT(*) as total_transactions,
          SUM(amount) as total_earned,
          AVG(amount) as avg_commission,
          SUM(CASE WHEN level = 1 THEN amount ELSE 0 END) as level1_earnings,
          SUM(CASE WHEN level = 2 THEN amount ELSE 0 END) as level2_earnings,
          COUNT(CASE WHEN level = 1 THEN 1 END) as level1_count,
          COUNT(CASE WHEN level = 2 THEN 1 END) as level2_count
        FROM mlm_commissions
        WHERE user_id = $1
      `, [userId]);

      // Aktive Downlines (letzte 30 Tage)
      const activeDownlinesResult = await pool.query(`
        WITH RECURSIVE downline_tree AS (
          SELECT mn.user_id
          FROM mlm_nodes mn
          WHERE mn.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = $1)
          
          UNION ALL
          
          SELECT mn.user_id
          FROM mlm_nodes mn
          JOIN downline_tree dt ON mn.parent_id = (SELECT id FROM mlm_nodes WHERE user_id = dt.user_id)
        )
        SELECT COUNT(*) as active_downlines
        FROM downline_tree dt
        JOIN users u ON dt.user_id = u.id
        WHERE u.updated_at >= NOW() - INTERVAL '30 days'
      `, [userId]);

      const downlineStats = downlineCountResult.rows[0];
      const commissionStats = commissionStatsResult.rows[0];
      const activeStats = activeDownlinesResult.rows[0];

      return {
        success: true,
        data: {
          team: {
            totalDownlines: parseInt(downlineStats.total_downlines) || 0,
            maxDepth: parseInt(downlineStats.max_depth) || 0,
            activeDownlines: parseInt(activeStats.active_downlines) || 0
          },
          commissions: {
            totalTransactions: parseInt(commissionStats.total_transactions) || 0,
            totalEarned: parseFloat(commissionStats.total_earned) || 0,
            averageCommission: parseFloat(commissionStats.avg_commission) || 0,
            level1Earnings: parseFloat(commissionStats.level1_earnings) || 0,
            level2Earnings: parseFloat(commissionStats.level2_earnings) || 0,
            level1Count: parseInt(commissionStats.level1_count) || 0,
            level2Count: parseInt(commissionStats.level2_count) || 0
          }
        }
      };
    } catch (error) {
      console.error('Get team statistics failed:', error);
      return {
        success: false,
        error: 'Failed to get team statistics'
      };
    }
  }

  // Provision hinzufügen
  async addCommission(userId, fromUserId, amount, level, commissionType, transactionId = null) {
    try {
      const result = await pool.query(
        `INSERT INTO mlm_commissions (user_id, from_user_id, amount, level, commission_type, transaction_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [userId, fromUserId, amount, level, commissionType, transactionId]
      );

      return {
        success: true,
        commissionId: result.rows[0].id
      };
    } catch (error) {
      console.error('Add commission failed:', error);
      return {
        success: false,
        error: 'Failed to add commission'
      };
    }
  }
}

module.exports = new MLMService();
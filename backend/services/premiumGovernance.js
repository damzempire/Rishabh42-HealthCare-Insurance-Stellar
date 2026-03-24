const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class PremiumGovernance {
  constructor() {
    this.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');
  }

  getDatabase() {
    return new sqlite3.Database(this.DB_PATH);
  }

  async submitForGovernanceReview(adjustmentData) {
    const db = this.getDatabase();
    
    try {
      const governanceRecord = await this.createGovernanceRecord(db, adjustmentData);
      const reviewers = await this.getAppropriateReviewers(db, adjustmentData);
      
      await this.notifyReviewers(db, governanceRecord.id, reviewers);
      
      return {
        governanceId: governanceRecord.id,
        status: 'pending',
        reviewers: reviewers.map(r => ({ id: r.id, name: r.name, email: r.email })),
        submittedAt: new Date().toISOString(),
        estimatedReviewTime: this.estimateReviewTime(adjustmentData)
      };
    } catch (error) {
      console.error('Error submitting for governance review:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  async createGovernanceRecord(db, adjustmentData) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO premium_adjustments (
          patient_id, premium_plan_id, adjustment_type, previous_premium, new_premium,
          adjustment_amount, adjustment_percentage, adjustment_reason, ai_score,
          risk_factors, market_conditions, health_metrics, claim_history_summary,
          governance_status, effective_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        adjustmentData.patientId,
        adjustmentData.premiumPlanId,
        adjustmentData.adjustmentAmount > 0 ? 'increase' : 'decrease',
        adjustmentData.previousPremium,
        adjustmentData.newPremium,
        adjustmentData.adjustmentAmount,
        adjustmentData.adjustmentPercentage,
        adjustmentData.adjustmentReason,
        adjustmentData.aiScore,
        adjustmentData.riskFactors,
        adjustmentData.marketConditions,
        adjustmentData.healthMetrics,
        adjustmentData.claimHistorySummary,
        'pending',
        adjustmentData.effectiveDate || new Date().toISOString().split('T')[0]
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID });
        }
      });
    });
  }

  async getAppropriateReviewers(db, adjustmentData) {
    const adjustmentMagnitude = Math.abs(adjustmentData.adjustmentPercentage);
    
    let reviewerQuery = `
      SELECT u.id, u.first_name || ' ' || u.last_name as name, u.email
      FROM users u
      WHERE u.role = 'admin'
    `;
    
    const params = [];
    
    if (adjustmentMagnitude >= 15) {
      reviewerQuery += ` AND u.id IN (
        SELECT DISTINCT reviewer_id FROM premium_adjustments 
        WHERE governance_status = 'approved' 
        AND created_at >= date('now', '-6 months')
        ORDER BY created_at DESC
        LIMIT 3
      )`;
    }
    
    reviewerQuery += ` ORDER BY RANDOM() LIMIT 2`;
    
    return new Promise((resolve, reject) => {
      db.all(reviewerQuery, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async notifyReviewers(db, governanceId, reviewers) {
    for (const reviewer of reviewers) {
      await this.createNotification(db, reviewer.id, {
        type: 'premium_adjustment',
        title: 'Premium Adjustment Review Required',
        message: `A premium adjustment requires your review. Governance ID: ${governanceId}`,
        priority: 'high'
      });
    }
  }

  async createNotification(db, userId, notificationData) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO notifications (user_id, title, message, type, priority)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        userId,
        notificationData.title,
        notificationData.message,
        notificationData.type,
        notificationData.priority
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async reviewAdjustment(governanceId, reviewerId, decision, notes) {
    const db = this.getDatabase();
    
    try {
      const adjustment = await this.getAdjustmentForReview(db, governanceId);
      
      if (!adjustment) {
        throw new Error('Adjustment not found or already reviewed');
      }
      
      const validationResult = await this.validateReviewDecision(adjustment, decision, reviewerId);
      
      if (!validationResult.valid) {
        throw new Error(validationResult.reason);
      }
      
      await this.updateGovernanceStatus(db, governanceId, reviewerId, decision, notes);
      
      if (decision === 'approved') {
        await this.applyApprovedAdjustment(db, adjustment);
      }
      
      await this.notifyPatient(db, adjustment.patientId, decision, adjustment);
      
      return {
        governanceId,
        status: decision,
        reviewedBy: reviewerId,
        reviewedAt: new Date().toISOString(),
        notes,
        effectiveDate: decision === 'approved' ? adjustment.effective_date : null
      };
    } catch (error) {
      console.error('Error reviewing adjustment:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  async getAdjustmentForReview(db, governanceId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT pa.*, pp.coverage_type, u.first_name || ' ' || u.last_name as patient_name
        FROM premium_adjustments pa
        JOIN premium_plans pp ON pa.premium_plan_id = pp.id
        JOIN patients p ON pa.patient_id = p.id
        JOIN users u ON p.user_id = u.id
        WHERE pa.id = ? AND pa.governance_status = 'pending'
      `;
      
      db.get(query, [governanceId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async validateReviewDecision(adjustment, decision, reviewerId) {
    const db = this.getDatabase();
    
    try {
      const reviewer = await this.getReviewer(db, reviewerId);
      
      if (!reviewer || reviewer.role !== 'admin') {
        return { valid: false, reason: 'Unauthorized reviewer' };
      }
      
      if (Math.abs(adjustment.adjustment_percentage) > 20 && decision === 'approved') {
        const seniorReviewers = await this.getSeniorReviewers(db);
        if (!seniorReviewers.some(sr => sr.id === reviewerId)) {
          return { valid: false, reason: 'Senior reviewer required for adjustments > 20%' };
        }
      }
      
      return { valid: true };
    } finally {
      db.close();
    }
  }

  async getReviewer(db, reviewerId) {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users WHERE id = ?';
      db.get(query, [reviewerId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getSeniorReviewers(db) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT u.* FROM users u
        WHERE u.role = 'admin'
        AND u.id IN (
          SELECT DISTINCT governance_reviewer_id 
          FROM premium_adjustments 
          WHERE governance_status = 'approved'
          AND ABS(adjustment_percentage) > 15
          AND created_at >= date('now', '-12 months')
        )
      `;
      
      db.all(query, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async updateGovernanceStatus(db, governanceId, reviewerId, decision, notes) {
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE premium_adjustments 
        SET governance_status = ?, governance_reviewer_id = ?, governance_notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      db.run(query, [decision, reviewerId, notes, governanceId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  async applyApprovedAdjustment(db, adjustment) {
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE premium_plans 
        SET current_premium = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      db.run(query, [adjustment.new_premium, adjustment.premium_plan_id], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  async notifyPatient(db, patientId, decision, adjustment) {
    const patient = await this.getPatientDetails(db, patientId);
    
    const notificationData = {
      type: 'premium_adjustment',
      title: decision === 'approved' ? 'Premium Adjustment Approved' : 'Premium Adjustment Review Complete',
      message: decision === 'approved' 
        ? `Your premium has been ${adjustment.adjustment_type}d to $${adjustment.new_premium}. Effective: ${adjustment.effective_date}`
        : `Your premium adjustment request has been reviewed. Status: ${decision}`,
      priority: decision === 'approved' ? 'high' : 'medium'
    };
    
    await this.createNotification(db, patient.user_id, notificationData);
  }

  async getPatientDetails(db, patientId) {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM patients WHERE id = ?';
      db.get(query, [patientId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getPendingReviews(reviewerId) {
    const db = this.getDatabase();
    
    try {
      return new Promise((resolve, reject) => {
        const query = `
          SELECT 
            pa.id, pa.adjustment_type, pa.previous_premium, pa.new_premium,
            pa.adjustment_percentage, pa.adjustment_reason, pa.ai_score,
            pa.created_at, pp.coverage_type,
            u.first_name || ' ' || u.last_name as patient_name
          FROM premium_adjustments pa
          JOIN premium_plans pp ON pa.premium_plan_id = pp.id
          JOIN patients p ON pa.patient_id = p.id
          JOIN users u ON p.user_id = u.id
          WHERE pa.governance_status = 'pending'
          ORDER BY pa.created_at ASC
        `;
        
        db.all(query, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } finally {
      db.close();
    }
  }

  async getGovernanceHistory(patientId, months = 12) {
    const db = this.getDatabase();
    
    try {
      return new Promise((resolve, reject) => {
        const query = `
          SELECT 
            pa.*, 
            reviewer.first_name || ' ' || reviewer.last_name as reviewer_name
          FROM premium_adjustments pa
          LEFT JOIN users reviewer ON pa.governance_reviewer_id = reviewer.id
          WHERE pa.patient_id = ? 
          AND pa.created_at >= date('now', '-${months} months')
          ORDER BY pa.created_at DESC
        `;
        
        db.all(query, [patientId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } finally {
      db.close();
    }
  }

  async getGovernanceMetrics(months = 12) {
    const db = this.getDatabase();
    
    try {
      return new Promise((resolve, reject) => {
        const query = `
          SELECT 
            COUNT(*) as total_reviews,
            COUNT(CASE WHEN governance_status = 'approved' THEN 1 END) as approved,
            COUNT(CASE WHEN governance_status = 'rejected' THEN 1 END) as rejected,
            COUNT(CASE WHEN governance_status = 'manual_review' THEN 1 END) as manual_reviews,
            AVG(adjustment_percentage) as avg_adjustment_percentage,
            AVG(ai_score) as avg_ai_score,
            AVG(JULIANDAY(updated_at) - JULIANDAY(created_at)) as avg_review_days,
            COUNT(DISTINCT governance_reviewer_id) as active_reviewers
          FROM premium_adjustments 
          WHERE created_at >= date('now', '-${months} months')
        `;
        
        db.get(query, [], (err, row) => {
          if (err) reject(err);
          else {
            const metrics = { ...row };
            metrics.approval_rate = row.total_reviews > 0 ? (row.approved / row.total_reviews) : 0;
            metrics.rejection_rate = row.total_reviews > 0 ? (row.rejected / row.total_reviews) : 0;
            metrics.avg_review_days = row.avg_review_days || 0;
            resolve(metrics);
          }
        });
      });
    } finally {
      db.close();
    }
  }

  estimateReviewTime(adjustmentData) {
    const adjustmentMagnitude = Math.abs(adjustmentData.adjustmentPercentage);
    
    if (adjustmentMagnitude < 5) return '1-2 business days';
    if (adjustmentMagnitude < 10) return '2-3 business days';
    if (adjustmentMagnitude < 15) return '3-5 business days';
    return '5-7 business days';
  }

  async escalateForManualReview(governanceId, reason) {
    const db = this.getDatabase();
    
    try {
      await this.updateGovernanceStatus(db, governanceId, null, 'manual_review', reason);
      
      const seniorReviewers = await this.getSeniorReviewers(db);
      for (const reviewer of seniorReviewers) {
        await this.createNotification(db, reviewer.id, {
          type: 'premium_adjustment',
          title: 'Premium Adjustment Escalated for Manual Review',
          message: `Adjustment ${governanceId} requires manual review. Reason: ${reason}`,
          priority: 'urgent'
        });
      }
      
      return { governanceId, status: 'escalated', reason };
    } catch (error) {
      console.error('Error escalating for manual review:', error);
      throw error;
    } finally {
      db.close();
    }
  }
}

module.exports = PremiumGovernance;

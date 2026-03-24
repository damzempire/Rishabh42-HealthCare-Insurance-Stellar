const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class PremiumAdjustmentEngine {
  constructor() {
    this.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');
  }

  getDatabase() {
    return new sqlite3.Database(this.DB_PATH);
  }

  async calculatePremiumAdjustment(patientId, premiumPlanId) {
    const db = this.getDatabase();
    
    try {
      const [patientData, claimHistory, healthMetrics, marketConditions, currentPlan] = await Promise.all([
        this.getPatientData(db, patientId),
        this.getClaimHistory(db, patientId),
        this.getHealthMetrics(db, patientId),
        this.getMarketConditions(db),
        this.getCurrentPremiumPlan(db, premiumPlanId)
      ]);

      const riskScore = await this.calculateRiskScore(claimHistory, healthMetrics);
      const marketAdjustment = await this.calculateMarketAdjustment(marketConditions);
      const healthAdjustment = await this.calculateHealthAdjustment(healthMetrics);
      const claimAdjustment = await this.calculateClaimAdjustment(claimHistory);

      const totalAdjustment = riskScore + marketAdjustment + healthAdjustment + claimAdjustment;
      const adjustmentPercentage = Math.max(-0.3, Math.min(0.2, totalAdjustment));

      const newPremium = currentPlan.current_premium * (1 + adjustmentPercentage);
      const adjustmentAmount = newPremium - currentPlan.current_premium;

      const aiScore = await this.calculateAIScore({
        riskScore,
        marketAdjustment,
        healthAdjustment,
        claimAdjustment,
        totalAdjustment
      });

      const requiresGovernance = Math.abs(adjustmentPercentage) >= 0.15;

      return {
        patientId,
        premiumPlanId,
        previousPremium: currentPlan.current_premium,
        newPremium: Math.round(newPremium * 100) / 100,
        adjustmentAmount: Math.round(adjustmentAmount * 100) / 100,
        adjustmentPercentage: Math.round(adjustmentPercentage * 10000) / 100,
        aiScore: Math.round(aiScore * 10000) / 10000,
        riskFactors: this.formatRiskFactors(riskScore, healthAdjustment, claimAdjustment),
        marketConditions: this.formatMarketConditions(marketConditions),
        healthMetrics: this.formatHealthMetrics(healthMetrics),
        claimHistorySummary: this.formatClaimHistory(claimHistory),
        requiresGovernance,
        adjustmentReason: this.generateAdjustmentReason(riskScore, marketAdjustment, healthAdjustment, claimAdjustment)
      };
    } catch (error) {
      console.error('Error calculating premium adjustment:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  async getPatientData(db, patientId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT p.*, u.first_name, u.last_name, u.date_of_birth
        FROM patients p
        JOIN users u ON p.user_id = u.id
        WHERE p.id = ?
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getClaimHistory(db, patientId, months = 24) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_claims,
          COUNT(CASE WHEN status IN ('approved', 'paid') THEN 1 END) as approved_claims,
          COUNT(CASE WHEN status = 'denied' THEN 1 END) as denied_claims,
          SUM(total_amount) as total_billed,
          SUM(CASE WHEN status IN ('approved', 'paid') THEN insurance_amount ELSE 0 END) as total_paid,
          AVG(CASE WHEN status IN ('approved', 'paid') THEN 
            JULIANDAY(processing_date) - JULIANDAY(submission_date) 
          END) as avg_processing_days,
          MAX(submission_date) as last_claim_date
        FROM insurance_claims 
        WHERE patient_id = ? 
        AND submission_date >= date('now', '-${months} months')
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getHealthMetrics(db, patientId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          metric_type,
          AVG(normalized_score) as avg_score,
          COUNT(*) as measurement_count,
          MAX(recorded_date) as last_measured
        FROM health_metrics 
        WHERE patient_id = ? 
        AND recorded_date >= date('now', '-12 months')
        GROUP BY metric_type
      `;
      
      db.all(query, [patientId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async getMarketConditions(db) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT condition_type, condition_value, impact_factor
        FROM market_conditions 
        WHERE effective_date <= date('now')
        ORDER BY effective_date DESC
        LIMIT 10
      `;
      
      db.all(query, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async getCurrentPremiumPlan(db, premiumPlanId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM premium_plans WHERE id = ? AND status = 'active'
      `;
      
      db.get(query, [premiumPlanId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async calculateRiskScore(claimHistory, healthMetrics) {
    let riskScore = 0;

    if (claimHistory.total_claims > 10) riskScore += 0.05;
    if (claimHistory.denied_claims > claimHistory.approved_claims) riskScore += 0.08;
    if (claimHistory.total_billed > 50000) riskScore += 0.06;

    const highRiskMetrics = healthMetrics.filter(m => 
      ['bmi', 'blood_pressure', 'cholesterol', 'blood_sugar'].includes(m.metric_type)
    );

    highRiskMetrics.forEach(metric => {
      if (metric.avg_score > 0.7) riskScore += 0.04;
      if (metric.avg_score > 0.85) riskScore += 0.06;
    });

    return Math.min(0.15, riskScore);
  }

  async calculateMarketAdjustment(marketConditions) {
    let adjustment = 0;

    marketConditions.forEach(condition => {
      switch (condition.condition_type) {
        case 'inflation_rate':
          adjustment += condition.condition_value * 0.8 * condition.impact_factor;
          break;
        case 'healthcare_cost_index':
          adjustment += (condition.condition_value - 100) * 0.001 * condition.impact_factor;
          break;
        case 'industry_trends':
          adjustment += condition.condition_value * 0.5 * condition.impact_factor;
          break;
      }
    });

    return Math.max(-0.05, Math.min(0.08, adjustment));
  }

  async calculateHealthAdjustment(healthMetrics) {
    let adjustment = 0;
    let totalScore = 0;
    let metricCount = 0;

    healthMetrics.forEach(metric => {
      if (metric.normalized_score !== null) {
        totalScore += metric.normalized_score;
        metricCount++;
      }
    });

    if (metricCount > 0) {
      const avgScore = totalScore / metricCount;
      adjustment = (avgScore - 0.5) * 0.2;
    }

    return Math.max(-0.1, Math.min(0.1, adjustment));
  }

  async calculateClaimAdjustment(claimHistory) {
    if (!claimHistory.total_claims) return 0;

    const claimFrequency = claimHistory.total_claims / 24;
    const denialRate = claimHistory.denied_claims / claimHistory.total_claims;
    const avgClaimAmount = claimHistory.total_billed / claimHistory.total_claims;

    let adjustment = 0;
    
    if (claimFrequency > 1) adjustment += 0.02 * (claimFrequency - 1);
    if (denialRate > 0.3) adjustment += 0.05;
    if (avgClaimAmount > 5000) adjustment += 0.03;

    return Math.max(-0.05, Math.min(0.08, adjustment));
  }

  async calculateAIScore(components) {
    const { riskScore, marketAdjustment, healthAdjustment, claimAdjustment, totalAdjustment } = components;
    
    const volatility = Math.abs(riskScore) + Math.abs(claimAdjustment);
    const consistency = Math.abs(marketAdjustment) + Math.abs(healthAdjustment);
    
    const riskWeight = 0.3;
    const marketWeight = 0.2;
    const healthWeight = 0.25;
    const claimWeight = 0.25;
    
    let score = 0.5;
    score += riskScore * riskWeight;
    score += marketAdjustment * marketWeight;
    score += healthAdjustment * healthWeight;
    score += claimAdjustment * claimWeight;
    
    if (volatility > 0.1) score -= 0.1;
    if (consistency < 0.05) score += 0.05;
    
    return Math.max(0, Math.min(1, score));
  }

  formatRiskFactors(riskScore, healthAdjustment, claimAdjustment) {
    return JSON.stringify({
      riskScore: Math.round(riskScore * 10000) / 10000,
      healthAdjustment: Math.round(healthAdjustment * 10000) / 10000,
      claimAdjustment: Math.round(claimAdjustment * 10000) / 10000
    });
  }

  formatMarketConditions(marketConditions) {
    return JSON.stringify(marketConditions.map(c => ({
      type: c.condition_type,
      value: c.condition_value,
      impact: c.impact_factor
    })));
  }

  formatHealthMetrics(healthMetrics) {
    return JSON.stringify(healthMetrics.map(m => ({
      type: m.metric_type,
      score: m.avg_score,
      measurements: m.measurement_count
    })));
  }

  formatClaimHistory(claimHistory) {
    return JSON.stringify({
      totalClaims: claimHistory.total_claims,
      approvedClaims: claimHistory.approved_claims,
      deniedClaims: claimHistory.denied_claims,
      totalBilled: claimHistory.total_billed,
      lastClaimDate: claimHistory.last_claim_date
    });
  }

  generateAdjustmentReason(riskScore, marketAdjustment, healthAdjustment, claimAdjustment) {
    const reasons = [];
    
    if (Math.abs(riskScore) > 0.02) {
      reasons.push(`Risk factor adjustment: ${riskScore > 0 ? 'increased' : 'decreased'} premium`);
    }
    
    if (Math.abs(marketAdjustment) > 0.01) {
      reasons.push(`Market conditions adjustment applied`);
    }
    
    if (Math.abs(healthAdjustment) > 0.01) {
      reasons.push(`Health metrics-based adjustment`);
    }
    
    if (Math.abs(claimAdjustment) > 0.01) {
      reasons.push(`Claim history adjustment applied`);
    }
    
    return reasons.length > 0 ? reasons.join('; ') : 'Routine premium review';
  }
}

module.exports = PremiumAdjustmentEngine;

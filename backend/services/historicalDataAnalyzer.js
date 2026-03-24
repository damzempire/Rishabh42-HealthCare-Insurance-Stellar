const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class HistoricalDataAnalyzer {
  constructor() {
    this.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');
  }

  getDatabase() {
    return new sqlite3.Database(this.DB_PATH);
  }

  async analyzePatientHistory(patientId, months = 24) {
    const db = this.getDatabase();
    
    try {
      const [claimAnalysis, paymentAnalysis, healthTrends, adjustmentHistory] = await Promise.all([
        this.analyzeClaimHistory(db, patientId, months),
        this.analyzePaymentHistory(db, patientId, months),
        this.analyzeHealthTrends(db, patientId, months),
        this.analyzeAdjustmentHistory(db, patientId, months)
      ]);

      return {
        patientId,
        analysisPeriod: months,
        claimAnalysis,
        paymentAnalysis,
        healthTrends,
        adjustmentHistory,
        riskScore: await this.calculateComprehensiveRiskScore(claimAnalysis, paymentAnalysis, healthTrends),
        recommendations: await this.generateRecommendations(claimAnalysis, paymentAnalysis, healthTrends, adjustmentHistory)
      };
    } catch (error) {
      console.error('Error analyzing patient history:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  async analyzeClaimHistory(db, patientId, months) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_claims,
          COUNT(CASE WHEN status IN ('approved', 'paid') THEN 1 END) as approved_claims,
          COUNT(CASE WHEN status = 'denied' THEN 1 END) as denied_claims,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_claims,
          SUM(total_amount) as total_billed,
          SUM(CASE WHEN status IN ('approved', 'paid') THEN insurance_amount ELSE 0 END) as total_paid,
          SUM(CASE WHEN status IN ('approved', 'paid') THEN patient_responsibility ELSE 0 END) as total_patient_responsibility,
          AVG(CASE WHEN status IN ('approved', 'paid') THEN 
            JULIANDAY(processing_date) - JULIANDAY(submission_date) 
          END) as avg_processing_days,
          MIN(submission_date) as first_claim_date,
          MAX(submission_date) as last_claim_date,
          AVG(total_amount) as avg_claim_amount,
          MAX(total_amount) as max_claim_amount,
          COUNT(DISTINCT provider_name) as unique_providers,
          COUNT(DISTINCT DATE(submission_date)) as claim_days
        FROM insurance_claims 
        WHERE patient_id = ? 
        AND submission_date >= date('now', '-${months} months')
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          const analysis = { ...row };
          
          analysis.approval_rate = row.total_claims > 0 ? (row.approved_claims / row.total_claims) : 0;
          analysis.denial_rate = row.total_claims > 0 ? (row.denied_claims / row.total_claims) : 0;
          analysis.paid_ratio = row.total_billed > 0 ? (row.total_paid / row.total_billed) : 0;
          analysis.claim_frequency = row.total_claims / (months / 12);
          analysis.avg_processing_days = row.avg_processing_days || 0;
          
          resolve(analysis);
        }
      });
    });
  }

  async analyzePaymentHistory(db, patientId, months) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_payments,
          SUM(payment_amount) as total_paid,
          AVG(payment_amount) as avg_payment_amount,
          MIN(payment_date) as first_payment_date,
          MAX(payment_date) as last_payment_date,
          COUNT(DISTINCT payment_method) as payment_methods_used,
          COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as completed_payments,
          COUNT(CASE WHEN payment_status = 'failed' THEN 1 END) as failed_payments,
          COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_payments
        FROM premium_payments 
        WHERE patient_id = ? 
        AND payment_date >= date('now', '-${months} months')
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          const analysis = { ...row };
          
          analysis.payment_completion_rate = row.total_payments > 0 ? (row.completed_payments / row.total_payments) : 0;
          analysis.payment_failure_rate = row.total_payments > 0 ? (row.failed_payments / row.total_payments) : 0;
          analysis.payment_frequency = row.total_payments / (months / 12);
          
          resolve(analysis);
        }
      });
    });
  }

  async analyzeHealthTrends(db, patientId, months) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          metric_type,
          COUNT(*) as measurement_count,
          AVG(normalized_score) as avg_score,
          MIN(normalized_score) as min_score,
          MAX(normalized_score) as max_score,
          MIN(recorded_date) as first_measurement,
          MAX(recorded_date) as last_measurement,
          CASE 
            WHEN COUNT(*) > 1 THEN (
              SELECT normalized_score 
              FROM health_metrics h2 
              WHERE h2.patient_id = ? 
              AND h2.metric_type = h1.metric_type 
              ORDER BY recorded_date ASC 
              LIMIT 1
            )
            ELSE NULL 
          END as first_score,
          CASE 
            WHEN COUNT(*) > 1 THEN (
              SELECT normalized_score 
              FROM health_metrics h2 
              WHERE h2.patient_id = ? 
              AND h2.metric_type = h1.metric_type 
              ORDER BY recorded_date DESC 
              LIMIT 1
            )
            ELSE AVG(normalized_score)
          END as latest_score
        FROM health_metrics h1
        WHERE patient_id = ? 
        AND recorded_date >= date('now', '-${months} months')
        GROUP BY metric_type
      `;
      
      db.all(query, [patientId, patientId, patientId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const trends = rows.map(row => ({
            metricType: row.metric_type,
            measurementCount: row.measurement_count,
            avgScore: row.avg_score,
            minScore: row.min_score,
            maxScore: row.max_score,
            firstMeasurement: row.first_measurement,
            lastMeasurement: row.last_measurement,
            firstScore: row.first_score,
            latestScore: row.latest_score,
            trend: row.first_score && row.latest_score ? 
              (row.latest_score - row.first_score > 0 ? 'improving' : 'declining') : 'stable',
            trendMagnitude: row.first_score && row.latest_score ? 
              Math.abs(row.latest_score - row.first_score) : 0
          }));
          
          resolve(trends);
        }
      });
    });
  }

  async analyzeAdjustmentHistory(db, patientId, months) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_adjustments,
          COUNT(CASE WHEN adjustment_type = 'increase' THEN 1 END) as increases,
          COUNT(CASE WHEN adjustment_type = 'decrease' THEN 1 END) as decreases,
          SUM(adjustment_amount) as total_adjustment_amount,
          AVG(adjustment_percentage) as avg_adjustment_percentage,
          MIN(created_at) as first_adjustment,
          MAX(created_at) as last_adjustment,
          COUNT(CASE WHEN governance_status = 'approved' THEN 1 END) as approved_adjustments,
          COUNT(CASE WHEN governance_status = 'rejected' THEN 1 END) as rejected_adjustments,
          COUNT(CASE WHEN governance_status = 'manual_review' THEN 1 END) as manual_review_adjustments,
          AVG(ai_score) as avg_ai_score
        FROM premium_adjustments 
        WHERE patient_id = ? 
        AND created_at >= date('now', '-${months} months')
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          const analysis = { ...row };
          
          analysis.approval_rate = row.total_adjustments > 0 ? (row.approved_adjustments / row.total_adjustments) : 0;
          analysis.rejection_rate = row.total_adjustments > 0 ? (row.rejected_adjustments / row.total_adjustments) : 0;
          analysis.net_adjustment = row.total_adjustment_amount || 0;
          analysis.adjustment_frequency = row.total_adjustments / (months / 12);
          
          resolve(analysis);
        }
      });
    });
  }

  async calculateComprehensiveRiskScore(claimAnalysis, paymentAnalysis, healthTrends) {
    let riskScore = 0.5;
    
    if (claimAnalysis.denial_rate > 0.3) riskScore += 0.15;
    if (claimAnalysis.claim_frequency > 10) riskScore += 0.1;
    if (claimAnalysis.avg_processing_days > 30) riskScore += 0.05;
    if (claimAnalysis.approval_rate < 0.7) riskScore += 0.1;
    
    if (paymentAnalysis.payment_failure_rate > 0.2) riskScore += 0.1;
    if (paymentAnalysis.payment_completion_rate < 0.8) riskScore += 0.05;
    
    const poorHealthMetrics = healthTrends.filter(trend => 
      trend.avgScore > 0.7 || trend.trend === 'declining'
    );
    riskScore += poorHealthMetrics.length * 0.05;
    
    return Math.max(0, Math.min(1, riskScore));
  }

  async generateRecommendations(claimAnalysis, paymentAnalysis, healthTrends, adjustmentHistory) {
    const recommendations = [];
    
    if (claimAnalysis.denial_rate > 0.3) {
      recommendations.push({
        type: 'high_priority',
        category: 'claims',
        message: 'High claim denial rate detected. Consider reviewing claim submission process.',
        action: 'review_claims'
      });
    }
    
    if (claimAnalysis.claim_frequency > 15) {
      recommendations.push({
        type: 'medium_priority',
        category: 'utilization',
        message: 'High healthcare utilization. Consider preventive care programs.',
        action: 'preventive_care'
      });
    }
    
    if (paymentAnalysis.payment_failure_rate > 0.15) {
      recommendations.push({
        type: 'high_priority',
        category: 'payments',
        message: 'High payment failure rate. Review payment methods and reminders.',
        action: 'payment_review'
      });
    }
    
    const decliningHealth = healthTrends.filter(trend => trend.trend === 'declining');
    if (decliningHealth.length > 0) {
      recommendations.push({
        type: 'medium_priority',
        category: 'health',
        message: 'Declining health trends detected. Consider health management programs.',
        action: 'health_management'
      });
    }
    
    if (adjustmentHistory.adjustment_frequency > 4) {
      recommendations.push({
        type: 'low_priority',
        category: 'adjustments',
        message: 'Frequent premium adjustments. Consider more stable pricing model.',
        action: 'pricing_review'
      });
    }
    
    return recommendations;
  }

  async getMarketTrends(months = 12) {
    const db = this.getDatabase();
    
    try {
      const query = `
        SELECT 
          condition_type,
          AVG(condition_value) as avg_value,
          MIN(condition_value) as min_value,
          MAX(condition_value) as max_value,
          COUNT(*) as data_points,
          DATE(MIN(effective_date), 'start of month') as trend_start,
          DATE(MAX(effective_date), 'start of month') as trend_end
        FROM market_conditions 
        WHERE effective_date >= date('now', '-${months} months')
        GROUP BY condition_type
        ORDER BY condition_type
      `;
      
      return new Promise((resolve, reject) => {
        db.all(query, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } finally {
      db.close();
    }
  }

  async getPopulationBenchmark(patientAgeGroup, conditionType) {
    const db = this.getDatabase();
    
    try {
      const query = `
        SELECT 
          AVG(ic.total_amount) as avg_claim_amount,
          COUNT(*) as sample_size,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ic.total_amount) as median_claim_amount,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ic.total_amount) as p75_claim_amount
        FROM insurance_claims ic
        JOIN patients p ON ic.patient_id = p.id
        JOIN users u ON p.user_id = u.id
        WHERE ic.status IN ('approved', 'paid')
        AND ic.submission_date >= date('now', '-24 months')
        AND u.date_of_birth BETWEEN date('now', '-${patientAgeGroup + 10} years') AND date('now', '-${patientAgeGroup} years')
      `;
      
      return new Promise((resolve, reject) => {
        db.get(query, [], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    } finally {
      db.close();
    }
  }

  async predictFutureClaims(patientId, months = 12) {
    const history = await this.analyzePatientHistory(patientId, 24);
    
    const seasonalFactors = await this.getSeasonalFactors(patientId);
    const trendFactors = this.calculateTrendFactors(history.claimAnalysis);
    
    const predictedClaims = Math.round(
      history.claimAnalysis.claim_frequency * (months / 12) * trendFactors * seasonalFactors
    );
    
    const predictedAmount = history.claimAnalysis.avg_claim_amount * predictedClaims;
    
    return {
      patientId,
      predictionPeriod: months,
      predictedClaims,
      predictedAmount,
      confidence: this.calculatePredictionConfidence(history),
      factors: {
        historicalFrequency: history.claimAnalysis.claim_frequency,
        trendFactors,
        seasonalFactors,
        avgClaimAmount: history.claimAnalysis.avg_claim_amount
      }
    };
  }

  async getSeasonalFactors(patientId) {
    const db = this.getDatabase();
    
    try {
      return new Promise((resolve, reject) => {
        const query = `
          SELECT 
            strftime('%m', submission_date) as month,
            COUNT(*) as claim_count
          FROM insurance_claims 
          WHERE patient_id = ? 
          AND submission_date >= date('now', '-24 months')
          GROUP BY strftime('%m', submission_date)
        `;
        
        db.all(query, [patientId], (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const totalClaims = rows.reduce((sum, row) => sum + row.claim_count, 0);
            const avgMonthlyClaims = totalClaims / 12;
            
            const seasonalFactors = {};
            rows.forEach(row => {
              seasonalFactors[row.month] = row.claim_count / avgMonthlyClaims;
            });
            
            resolve(Object.values(seasonalFactors).reduce((sum, factor) => sum + factor, 0) / Object.keys(seasonalFactors).length || 1);
          }
        });
      });
    } finally {
      db.close();
    }
  }

  calculateTrendFactors(claimAnalysis) {
    const recentTrend = claimAnalysis.total_claims > 10 ? 1.1 : 1.0;
    const approvalTrend = claimAnalysis.approval_rate < 0.7 ? 0.9 : 1.0;
    
    return recentTrend * approvalTrend;
  }

  calculatePredictionConfidence(history) {
    let confidence = 0.5;
    
    if (history.claimAnalysis.total_claims > 20) confidence += 0.2;
    if (history.claimAnalysis.approval_rate > 0.8) confidence += 0.1;
    if (history.healthTrends.length > 3) confidence += 0.1;
    if (history.paymentAnalysis.total_payments > 10) confidence += 0.1;
    
    return Math.min(1, confidence);
  }
}

module.exports = HistoricalDataAnalyzer;

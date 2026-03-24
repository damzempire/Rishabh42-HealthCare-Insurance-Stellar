const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class PremiumAdjustmentTriggers {
  constructor() {
    this.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');
  }

  getDatabase() {
    return new sqlite3.Database(this.DB_PATH);
  }

  async initializeDefaultTriggers() {
    const db = this.getDatabase();
    
    try {
      const defaultTriggers = [
        {
          name: 'High Claim Frequency',
          trigger_type: 'claim_frequency',
          condition_operator: '>',
          condition_value: '10',
          adjustment_percentage: 5.0,
          priority: 1,
          description: 'Increase premium by 5% if more than 10 claims in 24 months'
        },
        {
          name: 'Very High Claim Frequency',
          trigger_type: 'claim_frequency',
          condition_operator: '>',
          condition_value: '20',
          adjustment_percentage: 10.0,
          priority: 2,
          description: 'Increase premium by 10% if more than 20 claims in 24 months'
        },
        {
          name: 'High Claim Amount',
          trigger_type: 'claim_amount',
          condition_operator: '>',
          condition_value: '50000',
          adjustment_percentage: 3.0,
          priority: 1,
          description: 'Increase premium by 3% if total claims exceed $50,000 in 24 months'
        },
        {
          name: 'High Denial Rate',
          trigger_type: 'claim_frequency',
          condition_operator: '>',
          condition_value: '0.5',
          adjustment_percentage: 8.0,
          priority: 2,
          description: 'Increase premium by 8% if denial rate exceeds 50%'
        },
        {
          name: 'Excellent Health Metrics',
          trigger_type: 'health_metric',
          condition_operator: '<',
          condition_value: '0.3',
          adjustment_percentage: -5.0,
          priority: 1,
          description: 'Decrease premium by 5% for excellent health metrics'
        },
        {
          name: 'Poor Health Metrics',
          trigger_type: 'health_metric',
          condition_operator: '>',
          condition_value: '0.8',
          adjustment_percentage: 7.0,
          priority: 2,
          description: 'Increase premium by 7% for poor health metrics'
        },
        {
          name: 'High Inflation Impact',
          trigger_type: 'market_condition',
          condition_operator: '>',
          condition_value: '0.05',
          adjustment_percentage: 4.0,
          priority: 1,
          description: 'Increase premium by 4% when inflation exceeds 5%'
        },
        {
          name: 'Annual Review',
          trigger_type: 'time_based',
          condition_operator: '=',
          condition_value: '365',
          adjustment_percentage: 0.0,
          priority: 1,
          description: 'Trigger annual premium review'
        }
      ];

      for (const trigger of defaultTriggers) {
        await this.insertTrigger(db, trigger);
      }

      console.log('Default premium adjustment triggers initialized successfully');
    } catch (error) {
      console.error('Error initializing default triggers:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  async insertTrigger(db, trigger) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT OR IGNORE INTO premium_adjustment_triggers 
        (name, trigger_type, condition_operator, condition_value, 
         adjustment_percentage, priority, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        trigger.name,
        trigger.trigger_type,
        trigger.condition_operator,
        trigger.condition_value,
        trigger.adjustment_percentage,
        trigger.priority,
        trigger.description
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async evaluateTriggers(patientId, claimHistory, healthMetrics, marketConditions) {
    const db = this.getDatabase();
    
    try {
      const triggers = await this.getActiveTriggers(db);
      const triggeredAdjustments = [];

      for (const trigger of triggers) {
        const isTriggered = await this.evaluateTrigger(trigger, patientId, claimHistory, healthMetrics, marketConditions);
        
        if (isTriggered) {
          triggeredAdjustments.push({
            triggerId: trigger.id,
            triggerName: trigger.name,
            triggerType: trigger.trigger_type,
            adjustmentPercentage: trigger.adjustment_percentage,
            adjustmentAmount: trigger.adjustment_amount,
            priority: trigger.priority
          });
        }
      }

      return triggeredAdjustments.sort((a, b) => b.priority - a.priority);
    } catch (error) {
      console.error('Error evaluating triggers:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  async getActiveTriggers(db) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM premium_adjustment_triggers 
        WHERE is_active = TRUE 
        ORDER BY priority DESC, name ASC
      `;
      
      db.all(query, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async evaluateTrigger(trigger, patientId, claimHistory, healthMetrics, marketConditions) {
    let actualValue;
    let conditionValue = parseFloat(trigger.condition_value);

    switch (trigger.trigger_type) {
      case 'claim_frequency':
        actualValue = claimHistory.total_claims || 0;
        if (trigger.name.includes('Denial')) {
          actualValue = claimHistory.denied_claims / (claimHistory.total_claims || 1);
        }
        break;
      
      case 'claim_amount':
        actualValue = claimHistory.total_billed || 0;
        break;
      
      case 'health_metric':
        const avgHealthScore = this.calculateAverageHealthScore(healthMetrics);
        actualValue = avgHealthScore;
        break;
      
      case 'market_condition':
        const marketImpact = this.calculateMarketImpact(marketConditions);
        actualValue = marketImpact;
        break;
      
      case 'time_based':
        const daysSinceLastAdjustment = await this.getDaysSinceLastAdjustment(patientId);
        actualValue = daysSinceLastAdjustment;
        break;
      
      default:
        return false;
    }

    return this.compareValues(actualValue, trigger.condition_operator, conditionValue);
  }

  calculateAverageHealthScore(healthMetrics) {
    if (!healthMetrics || healthMetrics.length === 0) return 0.5;
    
    const totalScore = healthMetrics.reduce((sum, metric) => {
      return sum + (metric.avg_score || 0.5);
    }, 0);
    
    return totalScore / healthMetrics.length;
  }

  calculateMarketImpact(marketConditions) {
    if (!marketConditions || marketConditions.length === 0) return 0;
    
    const inflationImpact = marketConditions
      .filter(c => c.condition_type === 'inflation_rate')
      .reduce((sum, c) => sum + (c.condition_value * c.impact_factor), 0);
    
    return inflationImpact;
  }

  async getDaysSinceLastAdjustment(patientId) {
    const db = this.getDatabase();
    
    try {
      return new Promise((resolve, reject) => {
        const query = `
          SELECT julianday('now') - julianday(MAX(created_at)) as days_since_last
          FROM premium_adjustments 
          WHERE patient_id = ? AND governance_status = 'approved'
        `;
        
        db.get(query, [patientId], (err, row) => {
          if (err) reject(err);
          else resolve(row?.days_since_last || 999);
        });
      });
    } finally {
      db.close();
    }
  }

  compareValues(actualValue, operator, conditionValue) {
    switch (operator) {
      case '>': return actualValue > conditionValue;
      case '<': return actualValue < conditionValue;
      case '>=': return actualValue >= conditionValue;
      case '<=': return actualValue <= conditionValue;
      case '=': return actualValue === conditionValue;
      case '!=': return actualValue !== conditionValue;
      case 'BETWEEN': {
        const [min, max] = conditionValue.split(',').map(v => parseFloat(v.trim()));
        return actualValue >= min && actualValue <= max;
      }
      case 'IN': {
        const values = conditionValue.split(',').map(v => parseFloat(v.trim()));
        return values.includes(actualValue);
      }
      default: return false;
    }
  }

  async checkAdjustmentLimits(patientId, planType, adjustmentPercentage) {
    const db = this.getDatabase();
    
    try {
      const limits = await this.getAdjustmentLimits(db, patientId, planType);
      const annualAdjustments = await this.getAnnualAdjustments(db, patientId);
      
      const totalAnnualIncrease = annualAdjustments
        .filter(a => a.adjustment_percentage > 0)
        .reduce((sum, a) => sum + a.adjustment_percentage, 0);
      
      const totalAnnualDecrease = Math.abs(
        annualAdjustments
          .filter(a => a.adjustment_percentage < 0)
          .reduce((sum, a) => sum + a.adjustment_percentage, 0)
      );

      const violations = [];
      
      if (adjustmentPercentage > limits.max_single_increase_percentage) {
        violations.push(`Single adjustment exceeds maximum of ${limits.max_single_increase_percentage}%`);
      }
      
      if (totalAnnualIncrease + adjustmentPercentage > limits.max_annual_increase_percentage) {
        violations.push(`Annual increase would exceed maximum of ${limits.max_annual_increase_percentage}%`);
      }
      
      if (Math.abs(adjustmentPercentage) > limits.max_annual_decrease_percentage) {
        violations.push(`Adjustment exceeds annual decrease limit of ${limits.max_annual_decrease_percentage}%`);
      }

      const daysSinceLastAdjustment = await this.getDaysSinceLastAdjustment(patientId);
      if (daysSinceLastAdjustment < limits.cooling_period_days) {
        violations.push(`Cooling period of ${limits.cooling_period_days} days not met`);
      }

      return {
        allowed: violations.length === 0,
        violations,
        limits: {
          maxSingleIncrease: limits.max_single_increase_percentage,
          maxAnnualIncrease: limits.max_annual_increase_percentage,
          maxAnnualDecrease: limits.max_annual_decrease_percentage,
          coolingPeriod: limits.cooling_period_days,
          currentAnnualIncrease: totalAnnualIncrease,
          currentAnnualDecrease: totalAnnualDecrease
        }
      };
    } catch (error) {
      console.error('Error checking adjustment limits:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  async getAdjustmentLimits(db, patientId, planType) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM premium_adjustment_limits 
        WHERE (patient_id = ? OR patient_id IS NULL) 
        AND (plan_type = ? OR plan_type IS NULL)
        ORDER BY patient_id DESC, plan_type DESC
        LIMIT 1
      `;
      
      db.get(query, [patientId, planType], (err, row) => {
        if (err) reject(err);
        else resolve(row || {
          max_annual_increase_percentage: 20.0,
          max_single_increase_percentage: 10.0,
          max_annual_decrease_percentage: 30.0,
          cooling_period_days: 30,
          requires_governance_threshold: 15.0
        });
      });
    });
  }

  async getAnnualAdjustments(db, patientId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT adjustment_percentage 
        FROM premium_adjustments 
        WHERE patient_id = ? 
        AND governance_status = 'approved'
        AND created_at >= date('now', '-12 months')
      `;
      
      db.all(query, [patientId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async requiresGovernance(patientId, planType, adjustmentPercentage) {
    const limits = await this.getAdjustmentLimits(this.getDatabase(), patientId, planType);
    return Math.abs(adjustmentPercentage) >= limits.requires_governance_threshold;
  }
}

module.exports = PremiumAdjustmentTriggers;

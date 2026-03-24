const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const PremiumAdjustmentTriggers = require('../services/premiumAdjustmentTriggers');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

async function initializePremiumData() {
  console.log('Initializing premium adjustment data...');
  
  try {
    const triggers = new PremiumAdjustmentTriggers();
    await triggers.initializeDefaultTriggers();
    
    await insertDefaultMarketConditions();
    await insertDefaultAdjustmentLimits();
    
    console.log('✅ Premium adjustment data initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing premium data:', error);
    process.exit(1);
  }
}

async function insertDefaultMarketConditions() {
  const db = new sqlite3.Database(DB_PATH);
  
  return new Promise((resolve, reject) => {
    const marketConditions = [
      {
        condition_type: 'inflation_rate',
        condition_value: 0.042,
        condition_unit: 'decimal',
        effective_date: new Date().toISOString().split('T')[0],
        source: 'Bureau of Labor Statistics',
        impact_factor: 1.0
      },
      {
        condition_type: 'healthcare_cost_index',
        condition_value: 102.5,
        condition_unit: 'index',
        effective_date: new Date().toISOString().split('T')[0],
        source: 'CMS Healthcare Cost Index',
        impact_factor: 0.8
      },
      {
        condition_type: 'industry_trends',
        condition_value: 0.025,
        condition_unit: 'decimal',
        effective_date: new Date().toISOString().split('T')[0],
        source: 'Industry Analysis Report',
        impact_factor: 0.6
      }
    ];

    let completed = 0;
    
    marketConditions.forEach(condition => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO market_conditions 
        (condition_type, condition_value, condition_unit, effective_date, source, impact_factor)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        condition.condition_type,
        condition.condition_value,
        condition.condition_unit,
        condition.effective_date,
        condition.source,
        condition.impact_factor
      ], function(err) {
        if (err) {
          console.error('Error inserting market condition:', err);
        } else {
          console.log(`✓ Inserted market condition: ${condition.condition_type}`);
        }
        
        completed++;
        if (completed === marketConditions.length) {
          stmt.finalize();
          db.close();
          resolve();
        }
      });
    });
  });
}

async function insertDefaultAdjustmentLimits() {
  const db = new sqlite3.Database(DB_PATH);
  
  return new Promise((resolve, reject) => {
    const limits = [
      {
        plan_type: 'basic',
        max_annual_increase_percentage: 15.0,
        max_single_increase_percentage: 8.0,
        max_annual_decrease_percentage: 25.0,
        cooling_period_days: 30,
        requires_governance_threshold: 12.0
      },
      {
        plan_type: 'standard',
        max_annual_increase_percentage: 20.0,
        max_single_increase_percentage: 10.0,
        max_annual_decrease_percentage: 30.0,
        cooling_period_days: 30,
        requires_governance_threshold: 15.0
      },
      {
        plan_type: 'premium',
        max_annual_increase_percentage: 25.0,
        max_single_increase_percentage: 12.0,
        max_annual_decrease_percentage: 35.0,
        cooling_period_days: 45,
        requires_governance_threshold: 18.0
      },
      {
        plan_type: 'comprehensive',
        max_annual_increase_percentage: 30.0,
        max_single_increase_percentage: 15.0,
        max_annual_decrease_percentage: 40.0,
        cooling_period_days: 60,
        requires_governance_threshold: 20.0
      }
    ];

    let completed = 0;
    
    limits.forEach(limit => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO premium_adjustment_limits 
        (plan_type, max_annual_increase_percentage, max_single_increase_percentage,
         max_annual_decrease_percentage, cooling_period_days, requires_governance_threshold)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        limit.plan_type,
        limit.max_annual_increase_percentage,
        limit.max_single_increase_percentage,
        limit.max_annual_decrease_percentage,
        limit.cooling_period_days,
        limit.requires_governance_threshold
      ], function(err) {
        if (err) {
          console.error('Error inserting adjustment limit:', err);
        } else {
          console.log(`✓ Inserted adjustment limits for: ${limit.plan_type} plan`);
        }
        
        completed++;
        if (completed === limits.length) {
          stmt.finalize();
          db.close();
          resolve();
        }
      });
    });
  });
}

if (require.main === module) {
  initializePremiumData();
}

module.exports = { initializePremiumData };

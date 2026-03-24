const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { setCache, deleteCache } = require('../middleware/cache');

const PremiumAdjustmentEngine = require('../services/premiumAdjustmentEngine');
const PremiumAdjustmentTriggers = require('../services/premiumAdjustmentTriggers');
const HistoricalDataAnalyzer = require('../services/historicalDataAnalyzer');
const PremiumGovernance = require('../services/premiumGovernance');
const PremiumNotificationService = require('../services/premiumNotificationService');

const router = express.Router();
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');

function getDatabase() {
  return new sqlite3.Database(DB_PATH);
}

const adjustmentEngine = new PremiumAdjustmentEngine();
const triggers = new PremiumAdjustmentTriggers();
const analyzer = new HistoricalDataAnalyzer();
const governance = new PremiumGovernance();

router.get('/patient/:patientId/analysis', async (req, res, next) => {
  const { patientId } = req.params;
  const { months = 24 } = req.query;
  
  try {
    const analysis = await analyzer.analyzePatientHistory(patientId, parseInt(months));
    
    setCache(req.originalUrl, analysis);
    res.json(analysis);
  } catch (error) {
    next(error);
  }
});

router.get('/patient/:patientId/plans', async (req, res, next) => {
  const { patientId } = req.params;
  const db = getDatabase();
  
  try {
    const plans = await new Promise((resolve, reject) => {
      const query = `
        SELECT pp.*, 
          COUNT(pa.id) as adjustment_count,
          MAX(pa.created_at) as last_adjustment_date
        FROM premium_plans pp
        LEFT JOIN premium_adjustments pa ON pp.id = pa.premium_plan_id
        WHERE pp.patient_id = ?
        GROUP BY pp.id
        ORDER BY pp.created_at DESC
      `;
      
      db.all(query, [patientId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    setCache(req.originalUrl, plans);
    res.json(plans);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.post('/patient/:patientId/plans', async (req, res, next) => {
  const { patientId } = req.params;
  const {
    basePremium,
    coverageType,
    deductible = 0,
    copayment = 0,
    coverageLimit,
    effectiveDate
  } = req.body;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO premium_plans (
        patient_id, base_premium, current_premium, coverage_type,
        deductible, copayment, coverage_limit, effective_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      patientId, basePremium, basePremium, coverageType,
      deductible, copayment, coverageLimit, effectiveDate
    ], function(err) {
      if (err) {
        return next(err);
      }
      
      deleteCache('/api/premium-adjustments/patient/' + patientId + '/plans');
      
      res.status(201).json({
        message: 'Premium plan created successfully',
        planId: this.lastID
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.post('/calculate/:patientId/:premiumPlanId', async (req, res, next) => {
  const { patientId, premiumPlanId } = req.params;
  const { effectiveDate } = req.body;
  
  try {
    const adjustmentData = await adjustmentEngine.calculatePremiumAdjustment(
      patientId, 
      premiumPlanId
    );
    
    adjustmentData.effectiveDate = effectiveDate || new Date().toISOString().split('T')[0];
    
    const limitCheck = await triggers.checkAdjustmentLimits(
      patientId, 
      null, 
      adjustmentData.adjustmentPercentage
    );
    
    adjustmentData.limitCheck = limitCheck;
    
    if (!limitCheck.allowed) {
      return res.status(400).json({
        error: 'Adjustment exceeds limits',
        violations: limitCheck.violations,
        limits: limitCheck.limits
      });
    }
    
    res.json(adjustmentData);
  } catch (error) {
    next(error);
  }
});

router.post('/submit/:patientId/:premiumPlanId', async (req, res, next) => {
  const { patientId, premiumPlanId } = req.params;
  const adjustmentData = req.body;
  
  try {
    const limitCheck = await triggers.checkAdjustmentLimits(
      patientId, 
      null, 
      adjustmentData.adjustmentPercentage
    );
    
    if (!limitCheck.allowed) {
      return res.status(400).json({
        error: 'Adjustment exceeds limits',
        violations: limitCheck.violations,
        limits: limitCheck.limits
      });
    }
    
    let result;
    
    if (adjustmentData.requiresGovernance) {
      result = await governance.submitForGovernanceReview(adjustmentData);
      
      const notificationService = new PremiumNotificationService(req.io);
      await notificationService.notifyPremiumChange(
        { ...adjustmentData, id: result.governanceId },
        'governance_required'
      );
    } else {
      const db = getDatabase();
      
      try {
        const adjustmentRecord = await createAdjustmentRecord(db, adjustmentData);
        await applyAdjustment(db, adjustmentData);
        
        result = {
          adjustmentId: adjustmentRecord.id,
          status: 'approved',
          message: 'Premium adjustment applied successfully'
        };
        
        const notificationService = new PremiumNotificationService(req.io);
        await notificationService.notifyPremiumChange(
          { ...adjustmentData, id: adjustmentRecord.id },
          'adjustment_approved'
        );
        
      } finally {
        db.close();
      }
    }
    
    deleteCache('/api/premium-adjustments/patient/' + patientId + '/plans');
    deleteCache('/api/premium-adjustments/patient/' + patientId + '/history');
    
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

async function createAdjustmentRecord(db, adjustmentData) {
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
      'approved',
      adjustmentData.effectiveDate
    ], function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID });
    });
  });
}

async function applyAdjustment(db, adjustmentData) {
  return new Promise((resolve, reject) => {
    const query = `
      UPDATE premium_plans 
      SET current_premium = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    
    db.run(query, [adjustmentData.newPremium, adjustmentData.premiumPlanId], function(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

router.get('/patient/:patientId/history', async (req, res, next) => {
  const { patientId } = req.params;
  const { limit = 50, offset = 0 } = req.query;
  
  const db = getDatabase();
  
  try {
    const history = await new Promise((resolve, reject) => {
      const query = `
        SELECT pa.*, 
          reviewer.first_name || ' ' || reviewer.last_name as reviewer_name,
          pp.coverage_type
        FROM premium_adjustments pa
        LEFT JOIN users reviewer ON pa.governance_reviewer_id = reviewer.id
        LEFT JOIN premium_plans pp ON pa.premium_plan_id = pp.id
        WHERE pa.patient_id = ?
        ORDER BY pa.created_at DESC
        LIMIT ? OFFSET ?
      `;
      
      db.all(query, [patientId, parseInt(limit), parseInt(offset)], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const totalCount = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM premium_adjustments WHERE patient_id = ?', 
        [patientId], (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });

    const result = {
      adjustments: history,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < totalCount
      }
    };

    setCache(req.originalUrl, result);
    res.json(result);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.get('/governance/pending', async (req, res, next) => {
  try {
    const pendingReviews = await governance.getPendingReviews(req.user.id);
    
    setCache(req.originalUrl, pendingReviews);
    res.json(pendingReviews);
  } catch (error) {
    next(error);
  }
});

router.post('/governance/:governanceId/review', async (req, res, next) => {
  const { governanceId } = req.params;
  const { decision, notes } = req.body;
  
  try {
    const result = await governance.reviewAdjustment(
      governanceId,
      req.user.id,
      decision,
      notes
    );
    
    const notificationService = new PremiumNotificationService(req.io);
    await notificationService.notifyPremiumChange(
      { id: governanceId, governance_status: decision },
      decision === 'approved' ? 'adjustment_approved' : 'adjustment_rejected'
    );
    
    deleteCache('/api/premium-adjustments/governance/pending');
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/governance/metrics', async (req, res, next) => {
  const { months = 12 } = req.query;
  
  try {
    const metrics = await governance.getGovernanceMetrics(parseInt(months));
    
    setCache(req.originalUrl, metrics);
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

router.get('/triggers', async (req, res, next) => {
  const db = getDatabase();
  
  try {
    const triggerList = await new Promise((resolve, reject) => {
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

    setCache(req.originalUrl, triggerList);
    res.json(triggerList);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.post('/triggers', async (req, res, next) => {
  const {
    name,
    triggerType,
    conditionOperator,
    conditionValue,
    adjustmentPercentage,
    adjustmentAmount,
    priority = 1,
    description
  } = req.body;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO premium_adjustment_triggers (
        name, trigger_type, condition_operator, condition_value,
        adjustment_percentage, adjustment_amount, priority, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      name, triggerType, conditionOperator, conditionValue,
      adjustmentPercentage, adjustmentAmount, priority, description
    ], function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ error: 'Trigger name already exists' });
        }
        return next(err);
      }
      
      deleteCache('/api/premium-adjustments/triggers');
      
      res.status(201).json({
        message: 'Trigger created successfully',
        triggerId: this.lastID
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.put('/triggers/:triggerId', async (req, res, next) => {
  const { triggerId } = req.params;
  const updateFields = req.body;
  
  const db = getDatabase();
  
  try {
    const setClause = Object.keys(updateFields)
      .map(key => `${key} = ?`)
      .join(', ');
    
    const values = Object.values(updateFields);
    values.push(triggerId);
    
    const stmt = db.prepare(`
      UPDATE premium_adjustment_triggers 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    
    stmt.run(values, function(err) {
      if (err) {
        return next(err);
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Trigger not found' });
      }
      
      deleteCache('/api/premium-adjustments/triggers');
      
      res.json({ message: 'Trigger updated successfully' });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.delete('/triggers/:triggerId', async (req, res, next) => {
  const { triggerId } = req.params;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      UPDATE premium_adjustment_triggers 
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    
    stmt.run([triggerId], function(err) {
      if (err) {
        return next(err);
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Trigger not found' });
      }
      
      deleteCache('/api/premium-adjustments/triggers');
      
      res.json({ message: 'Trigger deactivated successfully' });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.get('/limits/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const { planType } = req.query;
  
  try {
    const limits = await triggers.checkAdjustmentLimits(patientId, planType, 0);
    
    res.json(limits);
  } catch (error) {
    next(error);
  }
});

router.post('/limits/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const {
    planType,
    maxAnnualIncreasePercentage,
    maxSingleIncreasePercentage,
    maxAnnualDecreasePercentage,
    coolingPeriodDays,
    requiresGovernanceThreshold
  } = req.body;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO premium_adjustment_limits (
        patient_id, plan_type, max_annual_increase_percentage,
        max_single_increase_percentage, max_annual_decrease_percentage,
        cooling_period_days, requires_governance_threshold
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      patientId, planType, maxAnnualIncreasePercentage,
      maxSingleIncreasePercentage, maxAnnualDecreasePercentage,
      coolingPeriodDays, requiresGovernanceThreshold
    ], function(err) {
      if (err) {
        return next(err);
      }
      
      deleteCache('/api/premium-adjustments/limits/' + patientId);
      
      res.status(201).json({
        message: 'Adjustment limits updated successfully',
        limitId: this.lastID
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.get('/market-trends', async (req, res, next) => {
  const { months = 12 } = req.query;
  
  try {
    const trends = await analyzer.getMarketTrends(parseInt(months));
    
    setCache(req.originalUrl, trends);
    res.json(trends);
  } catch (error) {
    next(error);
  }
});

router.post('/predict/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const { months = 12 } = req.body;
  
  try {
    const prediction = await analyzer.predictFutureClaims(patientId, parseInt(months));
    
    res.json(prediction);
  } catch (error) {
    next(error);
  }
});

router.get('/health-metrics/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const { months = 12 } = req.query;
  
  const db = getDatabase();
  
  try {
    const metrics = await new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM health_metrics 
        WHERE patient_id = ? 
        AND recorded_date >= date('now', '-${months} months')
        ORDER BY recorded_date DESC
      `;
      
      db.all(query, [patientId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    setCache(req.originalUrl, metrics);
    res.json(metrics);
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

router.post('/health-metrics/:patientId', async (req, res, next) => {
  const { patientId } = req.params;
  const {
    metricType,
    metricValue,
    metricUnit,
    recordedDate,
    source = 'manual_entry',
    normalizedScore
  } = req.body;
  
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO health_metrics (
        patient_id, metric_type, metric_value, metric_unit,
        recorded_date, source, normalized_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      patientId, metricType, metricValue, metricUnit,
      recordedDate, source, normalizedScore
    ], function(err) {
      if (err) {
        return next(err);
      }
      
      deleteCache('/api/premium-adjustments/health-metrics/' + patientId);
      
      res.status(201).json({
        message: 'Health metric recorded successfully',
        metricId: this.lastID
      });
    });
    
    stmt.finalize();
  } catch (error) {
    next(error);
  } finally {
    db.close();
  }
});

module.exports = router;

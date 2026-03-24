const request = require('supertest');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = require('../server');
const { initializeDatabase } = require('../database/init');

describe('Premium Adjustment API', () => {
  let db;
  let authToken;
  let testPatientId;
  let testPremiumPlanId;
  let testUserId;

  beforeAll(async () => {
    const testDbPath = path.join(__dirname, '../test_healthcare.db');
    
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    process.env.DB_PATH = testDbPath;
    
    await initializeDatabase();
    
    db = new sqlite3.Database(testDbPath);
    
    await setupTestData();
  });

  afterAll(async () => {
    if (db) {
      db.close();
    }
    
    const testDbPath = path.join(__dirname, '../test_healthcare.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  async function setupTestData() {
    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO users (email, password, role, first_name, last_name, date_of_birth)
        VALUES ('test@example.com', 'hashed_password', 'patient', 'John', 'Doe', '1990-01-01')
      `, function(err) {
        if (err) reject(err);
        else {
          testUserId = this.lastID;
          resolve();
        }
      });
    });

    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO patients (
          user_id, medical_record_number, insurance_provider, insurance_policy_number
        ) VALUES (?, 'MR123456', 'Test Insurance', 'POL123456')
      `, [testUserId], function(err) {
        if (err) reject(err);
        else {
          testPatientId = this.lastID;
          resolve();
        }
      });
    });

    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO premium_plans (
          patient_id, base_premium, current_premium, coverage_type, effective_date
        ) VALUES (?, 500.00, 500.00, 'standard', date('now'))
      `, [testPatientId], function(err) {
        if (err) reject(err);
        else {
          testPremiumPlanId = this.lastID;
          resolve();
        }
      });
    });

    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO insurance_claims (
          patient_id, claim_number, service_date, provider_name,
          total_amount, insurance_amount, patient_responsibility, status
        ) VALUES (?, 'CLM001', date('now', '-6 months'), 'Test Provider',
          1000.00, 800.00, 200.00, 'approved')
      `, [testPatientId], resolve);
    });

    await new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO health_metrics (
          patient_id, metric_type, metric_value, metric_unit, recorded_date, normalized_score
        ) VALUES (?, 'bmi', '25.5', 'kg/m2', date('now', '-3 months'), 0.6)
      `, [testPatientId], resolve);
    });
  }

  describe('POST /api/premium-adjustments/calculate/:patientId/:premiumPlanId', () => {
    it('should calculate premium adjustment successfully', async () => {
      const response = await request(app)
        .post(`/api/premium-adjustments/calculate/${testPatientId}/${testPremiumPlanId}`)
        .send({
          effectiveDate: '2024-12-01'
        })
        .expect(200);

      expect(response.body).toHaveProperty('patientId', testPatientId);
      expect(response.body).toHaveProperty('premiumPlanId', testPremiumPlanId);
      expect(response.body).toHaveProperty('previousPremium');
      expect(response.body).toHaveProperty('newPremium');
      expect(response.body).toHaveProperty('adjustmentAmount');
      expect(response.body).toHaveProperty('adjustmentPercentage');
      expect(response.body).toHaveProperty('aiScore');
      expect(response.body).toHaveProperty('requiresGovernance');
      expect(response.body).toHaveProperty('limitCheck');
    });
  });

  describe('GET /api/premium-adjustments/patient/:patientId/plans', () => {
    it('should get patient premium plans', async () => {
      const response = await request(app)
        .get(`/api/premium-adjustments/patient/${testPatientId}/plans`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('patient_id', testPatientId);
      expect(response.body[0]).toHaveProperty('base_premium');
      expect(response.body[0]).toHaveProperty('current_premium');
    });
  });

  describe('POST /api/premium-adjustments/patient/:patientId/plans', () => {
    it('should create new premium plan', async () => {
      const planData = {
        basePremium: 600.00,
        coverageType: 'premium',
        deductible: 1000.00,
        copayment: 25.00,
        coverageLimit: 100000.00,
        effectiveDate: '2024-12-01'
      };

      const response = await request(app)
        .post(`/api/premium-adjustments/patient/${testPatientId}/plans`)
        .send(planData)
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('planId');
    });
  });

  describe('GET /api/premium-adjustments/patient/:patientId/analysis', () => {
    it('should get patient historical analysis', async () => {
      const response = await request(app)
        .get(`/api/premium-adjustments/patient/${testPatientId}/analysis`)
        .expect(200);

      expect(response.body).toHaveProperty('patientId', testPatientId);
      expect(response.body).toHaveProperty('claimAnalysis');
      expect(response.body).toHaveProperty('paymentAnalysis');
      expect(response.body).toHaveProperty('healthTrends');
      expect(response.body).toHaveProperty('riskScore');
      expect(response.body).toHaveProperty('recommendations');
    });
  });

  describe('GET /api/premium-adjustments/triggers', () => {
    it('should get premium adjustment triggers', async () => {
      const response = await request(app)
        .get('/api/premium-adjustments/triggers')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('POST /api/premium-adjustments/triggers', () => {
    it('should create new premium adjustment trigger', async () => {
      const triggerData = {
        name: 'Test Trigger',
        triggerType: 'claim_frequency',
        conditionOperator: '>',
        conditionValue: '5',
        adjustmentPercentage: 3.0,
        priority: 1,
        description: 'Test trigger for unit testing'
      };

      const response = await request(app)
        .post('/api/premium-adjustments/triggers')
        .send(triggerData)
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('triggerId');
    });
  });

  describe('GET /api/premium-adjustments/limits/:patientId', () => {
    it('should get adjustment limits for patient', async () => {
      const response = await request(app)
        .get(`/api/premium-adjustments/limits/${testPatientId}`)
        .expect(200);

      expect(response.body).toHaveProperty('allowed');
      expect(response.body).toHaveProperty('violations');
      expect(response.body).toHaveProperty('limits');
    });
  });

  describe('GET /api/premium-adjustments/health-metrics/:patientId', () => {
    it('should get health metrics for patient', async () => {
      const response = await request(app)
        .get(`/api/premium-adjustments/health-metrics/${testPatientId}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      if (response.body.length > 0) {
        expect(response.body[0]).toHaveProperty('patient_id', testPatientId);
        expect(response.body[0]).toHaveProperty('metric_type');
        expect(response.body[0]).toHaveProperty('metric_value');
      }
    });
  });

  describe('POST /api/premium-adjustments/health-metrics/:patientId', () => {
    it('should add health metric for patient', async () => {
      const metricData = {
        metricType: 'blood_pressure',
        metricValue: '120/80',
        metricUnit: 'mmHg',
        recordedDate: '2024-11-01',
        source: 'manual_entry',
        normalizedScore: 0.4
      };

      const response = await request(app)
        .post(`/api/premium-adjustments/health-metrics/${testPatientId}`)
        .send(metricData)
        .expect(201);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('metricId');
    });
  });

  describe('GET /api/premium-adjustments/market-trends', () => {
    it('should get market trends', async () => {
      const response = await request(app)
        .get('/api/premium-adjustments/market-trends')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('POST /api/premium-adjustments/predict/:patientId', () => {
    it('should predict future claims for patient', async () => {
      const response = await request(app)
        .post(`/api/premium-adjustments/predict/${testPatientId}`)
        .send({ months: 12 })
        .expect(200);

      expect(response.body).toHaveProperty('patientId', testPatientId);
      expect(response.body).toHaveProperty('predictionPeriod', 12);
      expect(response.body).toHaveProperty('predictedClaims');
      expect(response.body).toHaveProperty('predictedAmount');
      expect(response.body).toHaveProperty('confidence');
    });
  });

  describe('Premium Adjustment Engine', () => {
    const PremiumAdjustmentEngine = require('../services/premiumAdjustmentEngine');
    let engine;

    beforeEach(() => {
      engine = new PremiumAdjustmentEngine();
    });

    it('should calculate risk score correctly', async () => {
      const claimHistory = {
        total_claims: 15,
        denied_claims: 8,
        approved_claims: 7,
        total_billed: 60000
      };

      const healthMetrics = [
        { metric_type: 'bmi', avg_score: 0.8 },
        { metric_type: 'blood_pressure', avg_score: 0.9 }
      ];

      const riskScore = await engine.calculateRiskScore(claimHistory, healthMetrics);
      expect(riskScore).toBeGreaterThan(0);
      expect(riskScore).toBeLessThan(1);
    });

    it('should calculate market adjustment correctly', async () => {
      const marketConditions = [
        { condition_type: 'inflation_rate', condition_value: 0.06, impact_factor: 1.0 },
        { condition_type: 'healthcare_cost_index', condition_value: 105, impact_factor: 0.8 }
      ];

      const adjustment = await engine.calculateMarketAdjustment(marketConditions);
      expect(typeof adjustment).toBe('number');
    });

    it('should format risk factors correctly', () => {
      const riskFactors = engine.formatRiskFactors(0.05, 0.03, 0.02);
      const parsed = JSON.parse(riskFactors);
      
      expect(parsed).toHaveProperty('riskScore');
      expect(parsed).toHaveProperty('healthAdjustment');
      expect(parsed).toHaveProperty('claimAdjustment');
    });
  });

  describe('Premium Adjustment Triggers', () => {
    const PremiumAdjustmentTriggers = require('../services/premiumAdjustmentTriggers');
    let triggers;

    beforeEach(() => {
      triggers = new PremiumAdjustmentTriggers();
    });

    it('should compare values correctly', () => {
      expect(triggers.compareValues(10, '>', 5)).toBe(true);
      expect(triggers.compareValues(10, '<', 5)).toBe(false);
      expect(triggers.compareValues(10, '=', 10)).toBe(true);
      expect(triggers.compareValues(10, '!=', 5)).toBe(true);
      expect(triggers.compareValues(10, 'BETWEEN', '5,15')).toBe(true);
      expect(triggers.compareValues(10, 'IN', '5,10,15')).toBe(true);
    });

    it('should calculate average health score correctly', () => {
      const healthMetrics = [
        { avg_score: 0.6 },
        { avg_score: 0.8 },
        { avg_score: 0.7 }
      ];

      const avgScore = triggers.calculateAverageHealthScore(healthMetrics);
      expect(avgScore).toBeCloseTo(0.7);
    });

    it('should calculate market impact correctly', () => {
      const marketConditions = [
        { condition_type: 'inflation_rate', condition_value: 0.05, impact_factor: 1.0 },
        { condition_type: 'inflation_rate', condition_value: 0.03, impact_factor: 0.8 }
      ];

      const impact = triggers.calculateMarketImpact(marketConditions);
      expect(impact).toBeCloseTo(0.074);
    });
  });

  describe('Historical Data Analyzer', () => {
    const HistoricalDataAnalyzer = require('../services/historicalDataAnalyzer');
    let analyzer;

    beforeEach(() => {
      analyzer = new HistoricalDataAnalyzer();
    });

    it('should calculate trend factors correctly', () => {
      const claimAnalysis = {
        total_claims: 15,
        approval_rate: 0.8
      };

      const trendFactors = analyzer.calculateTrendFactors(claimAnalysis);
      expect(typeof trendFactors).toBe('number');
      expect(trendFactors).toBeGreaterThan(0);
    });

    it('should calculate prediction confidence correctly', () => {
      const history = {
        claimAnalysis: { total_claims: 25, approval_rate: 0.9 },
        healthTrends: [1, 2, 3, 4],
        paymentAnalysis: { total_payments: 15 }
      };

      const confidence = analyzer.calculatePredictionConfidence(history);
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThan(1);
    });
  });

  describe('Premium Governance', () => {
    const PremiumGovernance = require('../services/premiumGovernance');
    let governance;

    beforeEach(() => {
      governance = new PremiumGovernance();
    });

    it('should estimate review time correctly', () => {
      const adjustmentData = { adjustmentPercentage: 5 };
      let reviewTime = governance.estimateReviewTime(adjustmentData);
      expect(reviewTime).toBe('1-2 business days');

      adjustmentData.adjustmentPercentage = 12;
      reviewTime = governance.estimateReviewTime(adjustmentData);
      expect(reviewTime).toBe('2-3 business days');

      adjustmentData.adjustmentPercentage = 18;
      reviewTime = governance.estimateReviewTime(adjustmentData);
      expect(reviewTime).toBe('5-7 business days');
    });
  });

  describe('Premium Notification Service', () => {
    const PremiumNotificationService = require('../services/premiumNotificationService');
    let notificationService;

    beforeEach(() => {
      notificationService = new PremiumNotificationService();
    });

    it('should determine notification priority correctly', () => {
      expect(notificationService.determinePriority(20)).toBe('urgent');
      expect(notificationService.determinePriority(12)).toBe('high');
      expect(notificationService.determinePriority(7)).toBe('medium');
      expect(notificationService.determinePriority(3)).toBe('low');
    });

    it('should calculate reminder dates correctly', () => {
      const effectiveDate = new Date('2024-12-15');
      const now = new Date('2024-11-01');
      
      const reminderDates = notificationService.calculateReminderDates(effectiveDate);
      expect(reminderDates).toHaveLength(2);
      
      reminderDates.forEach(date => {
        expect(date).toBeInstanceOf(Date);
        expect(date < effectiveDate).toBe(true);
        expect(date > now).toBe(true);
      });
    });
  });
});

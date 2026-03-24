const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'healthcare.db');

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }
      console.log('Connected to SQLite database');
    });

    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('patient', 'provider', 'admin')),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        date_of_birth DATE,
        phone TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        medical_record_number TEXT UNIQUE NOT NULL,
        insurance_provider TEXT,
        insurance_policy_number TEXT,
        emergency_contact_name TEXT,
        emergency_contact_phone TEXT,
        blood_type TEXT,
        allergies TEXT,
        medications TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS medical_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        provider_id INTEGER NOT NULL,
        record_type TEXT NOT NULL CHECK (record_type IN ('diagnosis', 'treatment', 'lab_result', 'prescription', 'imaging', 'vaccination')),
        title TEXT NOT NULL,
        description TEXT,
        diagnosis_code TEXT,
        treatment_code TEXT,
        date_of_service DATE NOT NULL,
        facility_name TEXT,
        provider_name TEXT,
        notes TEXT,
        attachments TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id),
        FOREIGN KEY (provider_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS insurance_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        claim_number TEXT UNIQUE NOT NULL,
        service_date DATE NOT NULL,
        provider_name TEXT NOT NULL,
        diagnosis_codes TEXT,
        procedure_codes TEXT,
        total_amount DECIMAL(10,2) NOT NULL,
        insurance_amount DECIMAL(10,2),
        patient_responsibility DECIMAL(10,2),
        status TEXT NOT NULL CHECK (status IN ('submitted', 'pending', 'approved', 'denied', 'partially_approved', 'paid')),
        submission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        processing_date DATETIME,
        payment_date DATETIME,
        denial_reason TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )`,

      `CREATE TABLE IF NOT EXISTS premium_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        payment_amount DECIMAL(10,2) NOT NULL,
        payment_date DATE NOT NULL,
        payment_method TEXT CHECK (payment_method IN ('credit_card', 'bank_transfer', 'check', 'cash')),
        payment_status TEXT CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
        transaction_id TEXT,
        insurance_provider TEXT,
        policy_number TEXT,
        coverage_period_start DATE,
        coverage_period_end DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )`,

      `CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        provider_id INTEGER NOT NULL,
        appointment_date DATETIME NOT NULL,
        duration_minutes INTEGER NOT NULL,
        appointment_type TEXT CHECK (appointment_type IN ('consultation', 'follow_up', 'procedure', 'lab_test', 'imaging', 'vaccination')),
        status TEXT CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
        notes TEXT,
        virtual BOOLEAN DEFAULT FALSE,
        meeting_link TEXT,
        reminder_sent BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id),
        FOREIGN KEY (provider_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT CHECK (type IN ('appointment', 'claim', 'payment', 'system', 'medical_record', 'premium_adjustment')),
        priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        read BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS premium_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        base_premium DECIMAL(10,2) NOT NULL,
        current_premium DECIMAL(10,2) NOT NULL,
        coverage_type TEXT CHECK (coverage_type IN ('basic', 'standard', 'premium', 'comprehensive')),
        deductible DECIMAL(10,2) DEFAULT 0,
        copayment DECIMAL(10,2) DEFAULT 0,
        coverage_limit DECIMAL(10,2),
        effective_date DATE NOT NULL,
        renewal_date DATE,
        status TEXT CHECK (status IN ('active', 'inactive', 'suspended', 'cancelled')) DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )`,

      `CREATE TABLE IF NOT EXISTS premium_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        premium_plan_id INTEGER NOT NULL,
        adjustment_type TEXT CHECK (adjustment_type IN ('increase', 'decrease', 'freeze', 'special_adjustment')),
        previous_premium DECIMAL(10,2) NOT NULL,
        new_premium DECIMAL(10,2) NOT NULL,
        adjustment_amount DECIMAL(10,2) NOT NULL,
        adjustment_percentage DECIMAL(5,2),
        adjustment_reason TEXT NOT NULL,
        ai_score DECIMAL(5,4),
        risk_factors TEXT,
        market_conditions TEXT,
        health_metrics TEXT,
        claim_history_summary TEXT,
        governance_status TEXT CHECK (governance_status IN ('pending', 'approved', 'rejected', 'manual_review')) DEFAULT 'pending',
        governance_reviewer_id INTEGER,
        governance_notes TEXT,
        effective_date DATE NOT NULL,
        notification_sent BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id),
        FOREIGN KEY (premium_plan_id) REFERENCES premium_plans (id),
        FOREIGN KEY (governance_reviewer_id) REFERENCES users (id)
      )`,

      `CREATE TABLE IF NOT EXISTS premium_adjustment_triggers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        trigger_type TEXT CHECK (trigger_type IN ('claim_frequency', 'claim_amount', 'health_metric', 'market_condition', 'policy_change', 'time_based')),
        condition_operator TEXT CHECK (condition_operator IN ('>', '<', '>=', '<=', '=', '!=', 'BETWEEN', 'IN')),
        condition_value TEXT NOT NULL,
        adjustment_percentage DECIMAL(5,2),
        adjustment_amount DECIMAL(10,2),
        is_active BOOLEAN DEFAULT TRUE,
        priority INTEGER DEFAULT 1,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS premium_adjustment_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER,
        plan_type TEXT CHECK (plan_type IN ('basic', 'standard', 'premium', 'comprehensive')),
        max_annual_increase_percentage DECIMAL(5,2) DEFAULT 20.0,
        max_single_increase_percentage DECIMAL(5,2) DEFAULT 10.0,
        max_annual_decrease_percentage DECIMAL(5,2) DEFAULT 30.0,
        cooling_period_days INTEGER DEFAULT 30,
        requires_governance_threshold DECIMAL(5,2) DEFAULT 15.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )`,

      `CREATE TABLE IF NOT EXISTS health_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        metric_type TEXT CHECK (metric_type IN ('bmi', 'blood_pressure', 'cholesterol', 'blood_sugar', 'exercise_frequency', 'smoking_status', 'alcohol_consumption', 'chronic_conditions')),
        metric_value TEXT NOT NULL,
        metric_unit TEXT,
        recorded_date DATE NOT NULL,
        source TEXT CHECK (source IN ('manual_entry', 'device_sync', 'provider_input', 'lab_result')),
        normalized_score DECIMAL(5,4),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )`,

      `CREATE TABLE IF NOT EXISTS market_conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        condition_type TEXT CHECK (condition_type IN ('inflation_rate', 'healthcare_cost_index', 'industry_trends', 'regulatory_changes', 'market_competition')),
        condition_value DECIMAL(10,4) NOT NULL,
        condition_unit TEXT,
        effective_date DATE NOT NULL,
        source TEXT,
        impact_factor DECIMAL(5,4) DEFAULT 1.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_medical_records_patient_id ON medical_records(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_medical_records_date ON medical_records(date_of_service)',
      'CREATE INDEX IF NOT EXISTS idx_claims_patient_id ON insurance_claims(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_claims_status ON insurance_claims(status)',
      'CREATE INDEX IF NOT EXISTS idx_payments_patient_id ON premium_payments(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)',
      'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_premium_plans_patient_id ON premium_plans(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_premium_adjustments_patient_id ON premium_adjustments(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_premium_adjustments_plan_id ON premium_adjustments(premium_plan_id)',
      'CREATE INDEX IF NOT EXISTS idx_premium_adjustments_governance_status ON premium_adjustments(governance_status)',
      'CREATE INDEX IF NOT EXISTS idx_health_metrics_patient_id ON health_metrics(patient_id)',
      'CREATE INDEX IF NOT EXISTS idx_health_metrics_type_date ON health_metrics(metric_type, recorded_date)',
      'CREATE INDEX IF NOT EXISTS idx_market_conditions_type_date ON market_conditions(condition_type, effective_date)',
      'CREATE INDEX IF NOT EXISTS idx_adjustment_triggers_type ON premium_adjustment_triggers(trigger_type)'
    ];

    let completedTables = 0;
    let completedIndexes = 0;

    tables.forEach((sql) => {
      db.run(sql, (err) => {
        if (err) {
          console.error('Error creating table:', err);
          reject(err);
          return;
        }
        completedTables++;
        if (completedTables === tables.length) {
          indexes.forEach((indexSql) => {
            db.run(indexSql, (err) => {
              if (err) {
                console.error('Error creating index:', err);
              } else {
                completedIndexes++;
              }
              if (completedIndexes === indexes.length) {
                db.close((err) => {
                  if (err) {
                    console.error('Error closing database:', err);
                    reject(err);
                  } else {
                    console.log('Database initialized successfully');
                    resolve();
                  }
                });
              }
            });
          });
        }
      });
    });
  });
}

module.exports = { initializeDatabase };

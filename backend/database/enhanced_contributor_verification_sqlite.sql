-- Enhanced Contributor Verification Database Migration for SQLite

-- KYC Verifications Table
CREATE TABLE IF NOT EXISTS kyc_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    full_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    nationality TEXT NOT NULL,
    document_type TEXT NOT NULL CHECK (document_type IN ('passport', 'national_id', 'driving_license')),
    document_number TEXT NOT NULL,
    ipfs_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'expired')),
    submitted_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewer_id INTEGER,
    rejection_reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

-- Professional Licenses Table
CREATE TABLE IF NOT EXISTS professional_licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    license_type TEXT NOT NULL CHECK (license_type IN (
        'medical_doctor', 'nurse', 'pharmacist', 'therapist', 
        'medical_technician', 'healthcare_administrator', 
        'mental_health_counselor', 'nutritionist', 'other'
    )),
    license_number TEXT NOT NULL,
    issuing_authority TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    ipfs_hash TEXT,
    verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected', 'expired', 'suspended')),
    submitted_at TEXT NOT NULL,
    verified_at TEXT,
    verifier_id INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (verifier_id) REFERENCES users(id),
    UNIQUE(user_id, license_type)
);

-- Update Users Table with Enhanced Contributor Fields
ALTER TABLE users ADD COLUMN kyc_status TEXT DEFAULT 'not_submitted' CHECK (kyc_status IN ('not_submitted', 'pending', 'in_review', 'approved', 'rejected', 'expired'));
ALTER TABLE users ADD COLUMN kyc_submitted_at TEXT;
ALTER TABLE users ADD COLUMN kyc_approved_at TEXT;
ALTER TABLE users ADD COLUMN reputation INTEGER DEFAULT 0 CHECK (reputation >= 0);
ALTER TABLE users ADD COLUMN contributor_level TEXT DEFAULT 'junior' CHECK (contributor_level IN ('junior', 'intermediate', 'senior', 'expert', 'master'));
ALTER TABLE users ADD COLUMN last_activity TEXT DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN reputation_decay_month INTEGER DEFAULT (CAST(strftime('%m', 'now') AS INTEGER));

-- Reputation History Table
CREATE TABLE IF NOT EXISTS reputation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    change_amount INTEGER NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('kyc_approval', 'license_verification', 'contribution', 'decay', 'penalty', 'bonus')),
    reference_id INTEGER,
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Contributor Activity Tracking Table
CREATE TABLE IF NOT EXISTS contributor_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    activity_type TEXT NOT NULL,
    description TEXT,
    metadata TEXT, -- JSON string for additional activity data
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for Performance Optimization
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_user_id ON kyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status ON kyc_verifications(status);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_submitted_at ON kyc_verifications(submitted_at);

CREATE INDEX IF NOT EXISTS idx_professional_licenses_user_id ON professional_licenses(user_id);
CREATE INDEX IF NOT EXISTS idx_professional_licenses_status ON professional_licenses(verification_status);
CREATE INDEX IF NOT EXISTS idx_professional_licenses_type ON professional_licenses(license_type);
CREATE INDEX IF NOT EXISTS idx_professional_licenses_submitted_at ON professional_licenses(submitted_at);

CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON users(kyc_status);
CREATE INDEX IF NOT EXISTS idx_users_contributor_level ON users(contributor_level);
CREATE INDEX IF NOT EXISTS idx_users_reputation ON users(reputation DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(last_activity);

CREATE INDEX IF NOT EXISTS idx_reputation_history_user_id ON reputation_history(user_id);
CREATE INDEX IF NOT EXISTS idx_reputation_history_created_at ON reputation_history(created_at);

CREATE INDEX IF NOT EXISTS idx_contributor_activities_user_id ON contributor_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_contributor_activities_type ON contributor_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_contributor_activities_created_at ON contributor_activities(created_at);

-- Triggers for Automatic Updates
CREATE TRIGGER IF NOT EXISTS update_kyc_verifications_updated_at 
    AFTER UPDATE ON kyc_verifications
BEGIN
    UPDATE kyc_verifications SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_professional_licenses_updated_at 
    AFTER UPDATE ON professional_licenses
BEGIN
    UPDATE professional_licenses SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Views for Common Queries
CREATE VIEW IF NOT EXISTS contributor_summary AS
SELECT 
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.kyc_status,
    u.reputation,
    u.contributor_level,
    u.last_activity,
    COUNT(DISTINCT pl.id) as verified_licenses,
    COUNT(DISTINCT CASE WHEN pl.verification_status = 'verified' THEN pl.id END) as active_licenses,
    MAX(pl.expiry_date) as next_license_expiry
FROM users u
LEFT JOIN professional_licenses pl ON u.id = pl.user_id AND pl.verification_status = 'verified'
WHERE u.kyc_status = 'approved'
GROUP BY u.id, u.email, u.first_name, u.last_name, u.kyc_status, u.reputation, u.contributor_level, u.last_activity;

CREATE VIEW IF NOT EXISTS pending_verifications AS
SELECT 
    'kyc' as verification_type,
    k.id,
    k.user_id,
    u.email,
    u.first_name,
    u.last_name,
    k.full_name,
    k.nationality,
    k.document_type,
    k.submitted_at,
    k.status
FROM kyc_verifications k
JOIN users u ON k.user_id = u.id
WHERE k.status IN ('pending', 'in_review')

UNION ALL

SELECT 
    'license' as verification_type,
    l.id,
    l.user_id,
    u.email,
    u.first_name,
    u.last_name,
    l.license_type as full_name,
    l.issuing_authority as nationality,
    l.license_number as document_type,
    l.submitted_at,
    l.verification_status as status
FROM professional_licenses l
JOIN users u ON l.user_id = u.id
WHERE l.verification_status = 'pending'
ORDER BY submitted_at ASC;

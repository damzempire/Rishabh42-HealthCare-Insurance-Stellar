-- Enhanced Contributor Verification Database Migration

-- KYC Verifications Table
CREATE TABLE IF NOT EXISTS kyc_verifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    nationality VARCHAR(50) NOT NULL,
    document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('passport', 'national_id', 'driving_license')),
    document_number VARCHAR(50) NOT NULL,
    ipfs_hash TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'expired')),
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewer_id INTEGER REFERENCES users(id),
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Professional Licenses Table
CREATE TABLE IF NOT EXISTS professional_licenses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    license_type VARCHAR(30) NOT NULL CHECK (license_type IN (
        'medical_doctor', 'nurse', 'pharmacist', 'therapist', 
        'medical_technician', 'healthcare_administrator', 
        'mental_health_counselor', 'nutritionist', 'other'
    )),
    license_number VARCHAR(50) NOT NULL,
    issuing_authority VARCHAR(100) NOT NULL,
    issue_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    ipfs_hash TEXT,
    verification_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected', 'expired', 'suspended')),
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified_at TIMESTAMP WITH TIME ZONE,
    verifier_id INTEGER REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, license_type)
);

-- Update Users Table with Enhanced Contributor Fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(20) DEFAULT 'not_submitted' CHECK (kyc_status IN ('not_submitted', 'pending', 'in_review', 'approved', 'rejected', 'expired'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation INTEGER DEFAULT 0 CHECK (reputation >= 0);
ALTER TABLE users ADD COLUMN IF NOT EXISTS contributor_level VARCHAR(20) DEFAULT 'junior' CHECK (contributor_level IN ('junior', 'intermediate', 'senior', 'expert', 'master'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation_decay_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW());

-- Reputation History Table
CREATE TABLE IF NOT EXISTS reputation_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    change_amount INTEGER NOT NULL,
    change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('kyc_approval', 'license_verification', 'contribution', 'decay', 'penalty', 'bonus')),
    reference_id INTEGER, -- Can reference KYC ID, License ID, or other entities
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contributor Activity Tracking Table
CREATE TABLE IF NOT EXISTS contributor_activities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    activity_type VARCHAR(30) NOT NULL,
    description TEXT,
    metadata JSONB, -- Store additional activity data
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_kyc_verifications_updated_at BEFORE UPDATE ON kyc_verifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_professional_licenses_updated_at BEFORE UPDATE ON professional_licenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to Log Reputation Changes
CREATE OR REPLACE FUNCTION log_reputation_change(
    p_user_id INTEGER,
    p_change_amount INTEGER,
    p_change_type VARCHAR(20),
    p_reference_id INTEGER DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO reputation_history (user_id, change_amount, change_type, reference_id, reason)
    VALUES (p_user_id, p_change_amount, p_change_type, p_reference_id, p_reason);
    
    -- Update user's reputation
    UPDATE users 
    SET reputation = reputation + p_change_amount,
        last_activity = NOW()
    WHERE id = p_user_id;
    
    -- Check for tier advancement
    IF p_change_amount > 0 THEN
        PERFORM check_tier_advancement(p_user_id);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to Check Tier Advancement
CREATE OR REPLACE FUNCTION check_tier_advancement(p_user_id INTEGER)
RETURNS VOID AS $$
DECLARE
    current_reputation INTEGER;
    new_level VARCHAR(20);
BEGIN
    SELECT reputation INTO current_reputation FROM users WHERE id = p_user_id;
    
    IF current_reputation >= 600 THEN
        new_level := 'master';
    ELSIF current_reputation >= 300 THEN
        new_level := 'expert';
    ELSIF current_reputation >= 150 THEN
        new_level := 'senior';
    ELSIF current_reputation >= 50 THEN
        new_level := 'intermediate';
    ELSE
        new_level := 'junior';
    END IF;
    
    -- Update user level if it has changed
    UPDATE users 
    SET contributor_level = new_level
    WHERE id = p_user_id AND contributor_level != new_level;
    
    -- Log tier advancement
    IF FOUND THEN
        INSERT INTO contributor_activities (user_id, activity_type, description, metadata)
        VALUES (p_user_id, 'tier_advancement', 
                format('Advanced to %s level', new_level),
                json_build_object('new_level', new_level, 'reputation', current_reputation));
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to Apply Reputation Decay
CREATE OR REPLACE FUNCTION apply_reputation_decay()
RETURNS INTEGER AS $$
DECLARE
    decayed_users INTEGER := 0;
    current_month INTEGER := EXTRACT(MONTH FROM NOW());
BEGIN
    -- Update users who have been inactive for more than 30 days
    UPDATE users 
    SET 
        reputation = GREATEST(0, reputation * 0.95), -- 5% decay
        reputation_decay_month = current_month,
        last_activity = COALESCE(last_activity, created_at)
    WHERE 
        last_activity < NOW() - INTERVAL '30 days'
        AND reputation_decay_month < current_month
        AND reputation > 0
    RETURNING 1 INTO decayed_users;
    
    -- Check for tier downgrades
    FOR user_record IN 
        SELECT id FROM users 
        WHERE last_activity < NOW() - INTERVAL '30 days'
        AND reputation_decay_month = current_month
    LOOP
        PERFORM check_tier_downgrade(user_record.id);
    END LOOP;
    
    RETURN decayed_users;
END;
$$ LANGUAGE plpgsql;

-- Function to Check Tier Downgrade
CREATE OR REPLACE FUNCTION check_tier_downgrade(p_user_id INTEGER)
RETURNS VOID AS $$
DECLARE
    current_reputation INTEGER;
    new_level VARCHAR(20);
    old_level VARCHAR(20);
BEGIN
    SELECT reputation, contributor_level INTO current_reputation, old_level 
    FROM users WHERE id = p_user_id;
    
    IF current_reputation >= 600 THEN
        new_level := 'master';
    ELSIF current_reputation >= 300 THEN
        new_level := 'expert';
    ELSIF current_reputation >= 150 THEN
        new_level := 'senior';
    ELSIF current_reputation >= 50 THEN
        new_level := 'intermediate';
    ELSE
        new_level := 'junior';
    END IF;
    
    -- Update user level if it has decreased
    UPDATE users 
    SET contributor_level = new_level
    WHERE id = p_user_id AND contributor_level != new_level;
    
    -- Log tier downgrade
    IF FOUND AND new_level != old_level THEN
        INSERT INTO contributor_activities (user_id, activity_type, description, metadata)
        VALUES (p_user_id, 'tier_downgrade', 
                format('Downgraded to %s level', new_level),
                json_build_object('old_level', old_level, 'new_level', new_level, 'reputation', current_reputation));
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Views for Common Queries
CREATE OR REPLACE VIEW contributor_summary AS
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

CREATE OR REPLACE VIEW pending_verifications AS
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

-- Comments for Documentation
COMMENT ON TABLE kyc_verifications IS 'Stores KYC verification data for contributors';
COMMENT ON TABLE professional_licenses IS 'Stores professional license verification data';
COMMENT ON TABLE reputation_history IS 'Tracks all reputation changes for audit purposes';
COMMENT ON TABLE contributor_activities IS 'Tracks all contributor activities for analytics';

COMMENT ON COLUMN users.kyc_status IS 'Current KYC verification status of the user';
COMMENT ON COLUMN users.reputation IS 'Reputation score based on contributions and verifications';
COMMENT ON COLUMN users.contributor_level IS 'Current contributor tier level';
COMMENT ON COLUMN users.last_activity IS 'Timestamp of last user activity for decay calculations';

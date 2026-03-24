use soroban_sdk::{Address, Env, Symbol, Vec, String};
use crate::{
    HealthcareDrips, HealthcareDripsError, ContributorLevel, KycStatus, LicenseType, LicenseStatus,
    KycVerification, ProfessionalLicense, ContributorStats
};

#[test]
fn test_kyc_verification_submission() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Submit KYC verification
    let kyc_id = HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "John Doe"),
        946684800, // 2000-01-01
        String::from_str(&env, "US"),
        String::from_str(&env, "passport"),
        String::from_str(&env, "P123456789"),
        String::from_str(&env, "QmHash123"),
        contributor.clone(),
    ).unwrap();
    
    assert_eq!(kyc_id, 1);
    
    // Check KYC status
    let kyc = HealthcareDrips::get_kyc_verification(&env, contributor.clone()).unwrap();
    assert_eq!(kyc.status, KycStatus::Pending);
    assert_eq!(kyc.full_name, String::from_str(&env, "John Doe"));
    
    // Check contributor stats
    let stats = HealthcareDrips::get_contributor_stats(&env, contributor).unwrap();
    assert_eq!(stats.kyc_status, KycStatus::Pending);
}

#[test]
fn test_kyc_verification_approval() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    let reviewer = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Submit KYC verification
    let kyc_id = HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "Jane Smith"),
        946684800,
        String::from_str(&env, "Canada"),
        String::from_str(&env, "national_id"),
        String::from_str(&env, "ID987654321"),
        String::from_str(&env, "QmHash456"),
        contributor.clone(),
    ).unwrap();
    
    // Approve KYC
    HealthcareDrips::review_kyc_verification(
        &env,
        contributor.clone(),
        true,
        String::from_str(&env, ""),
        reviewer.clone(),
    ).unwrap();
    
    // Check updated status
    let kyc = HealthcareDrips::get_kyc_verification(&env, contributor.clone()).unwrap();
    assert_eq!(kyc.status, KycStatus::Approved);
    
    // Check reputation bonus
    let stats = HealthcareDrips::get_contributor_stats(&env, contributor).unwrap();
    assert_eq!(stats.reputation, 50); // KYC approval bonus
    assert_eq!(stats.kyc_status, KycStatus::Approved);
}

#[test]
fn test_professional_license_submission() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Submit and approve KYC first
    HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "Dr. Wilson"),
        946684800,
        String::from_str(&env, "UK"),
        String::from_str(&env, "passport"),
        String::from_str(&env, "P555666777"),
        String::from_str(&env, "QmHash789"),
        contributor.clone(),
    ).unwrap();
    
    HealthcareDrips::review_kyc_verification(
        &env,
        contributor.clone(),
        true,
        String::from_str(&env, ""),
        admin.clone(),
    ).unwrap();
    
    // Submit professional license
    let license_id = HealthcareDrips::submit_professional_license(
        &env,
        LicenseType::MedicalDoctor,
        String::from_str(&env, "MD123456"),
        String::from_str(&env, "General Medical Council"),
        946684800,
        1893456000, // 2030-01-01
        String::from_str(&env, "QmLicenseHash"),
        contributor.clone(),
    ).unwrap();
    
    assert_eq!(license_id, 1);
    
    // Check license status
    let license = HealthcareDrips::get_professional_license(
        &env,
        contributor.clone(),
        LicenseType::MedicalDoctor,
    ).unwrap();
    assert_eq!(license.verification_status, LicenseStatus::Pending);
    assert_eq!(license.license_number, String::from_str(&env, "MD123456"));
}

#[test]
fn test_professional_license_verification() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Setup: Approve KYC and submit license
    HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "Dr. Brown"),
        946684800,
        String::from_str(&env, "Australia"),
        String::from_str(&env, "passport"),
        String::from_str(&env, "P999888777"),
        String::from_str(&env, "QmHashABC"),
        contributor.clone(),
    ).unwrap();
    
    HealthcareDrips::review_kyc_verification(
        &env,
        contributor.clone(),
        true,
        String::from_str(&env, ""),
        admin.clone(),
    ).unwrap();
    
    HealthcareDrips::submit_professional_license(
        &env,
        LicenseType::Nurse,
        String::from_str(&env, "RN456789"),
        String::from_str(&env, "Nursing Board"),
        946684800,
        1893456000,
        String::from_str(&env, "QmLicenseHash2"),
        contributor.clone(),
    ).unwrap();
    
    // Verify license
    HealthcareDrips::verify_professional_license(
        &env,
        contributor.clone(),
        LicenseType::Nurse,
        true,
        String::from_str(&env, "License verified successfully"),
        admin.clone(),
    ).unwrap();
    
    // Check license status
    let license = HealthcareDrips::get_professional_license(
        &env,
        contributor.clone(),
        LicenseType::Nurse,
    ).unwrap();
    assert_eq!(license.verification_status, LicenseStatus::Verified);
    
    // Check reputation and tier advancement
    let stats = HealthcareDrips::get_contributor_stats(&env, contributor).unwrap();
    assert_eq!(stats.reputation, 125); // 50 (KYC) + 75 (Nurse license)
    assert_eq!(stats.level, ContributorLevel::Intermediate); // 50-149 points
}

#[test]
fn test_reputation_decay_application() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Setup: Give contributor some reputation
    HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "Test User"),
        946684800,
        String::from_str(&env, "US"),
        String::from_str(&env, "passport"),
        String::from_str(&env, "P111222333"),
        String::from_str(&env, "QmHashTest"),
        contributor.clone(),
    ).unwrap();
    
    HealthcareDrips::review_kyc_verification(
        &env,
        contributor.clone(),
        true,
        String::from_str(&env, ""),
        admin.clone(),
    ).unwrap();
    
    // Simulate time passing (set last activity to past)
    let mut stats = HealthcareDrips::get_contributor_stats(&env, contributor.clone()).unwrap();
    stats.last_activity = env.ledger().timestamp() - (40 * 86400); // 40 days ago
    stats.reputation_decay_month = ((env.ledger().timestamp() / 2592000) as u32) - 1; // Last month
    
    // Apply reputation decay
    HealthcareDrips::apply_reputation_decay(
        &env,
        contributor.clone(),
        admin.clone(),
    ).unwrap();
    
    // Check decayed reputation
    let updated_stats = HealthcareDrips::get_contributor_stats(&env, contributor).unwrap();
    assert_eq!(updated_stats.reputation, 47); // 50 * 0.95 = 47.5, rounded down
}

#[test]
fn test_tier_advancement_automation() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Setup: Approve KYC and multiple licenses for high reputation
    HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "Dr. Advanced"),
        946684800,
        String::from_str(&env, "Germany"),
        String::from_str(&env, "passport"),
        String::from_str(&env, "P777888999"),
        String::from_str(&env, "QmHashAdv"),
        contributor.clone(),
    ).unwrap();
    
    HealthcareDrips::review_kyc_verification(
        &env,
        contributor.clone(),
        true,
        String::from_str(&env, ""),
        admin.clone(),
    ).unwrap();
    
    // Submit Medical Doctor license (100 points)
    HealthcareDrips::submit_professional_license(
        &env,
        LicenseType::MedicalDoctor,
        String::from_str(&env, "MD789012"),
        String::from_str(&env, "German Medical Association"),
        946684800,
        1893456000,
        String::from_str(&env, "QmLicenseAdv"),
        contributor.clone(),
    ).unwrap();
    
    HealthcareDrips::verify_professional_license(
        &env,
        contributor.clone(),
        LicenseType::MedicalDoctor,
        true,
        String::from_str(&env, "Verified"),
        admin.clone(),
    ).unwrap();
    
    // Submit Pharmacist license (80 points)
    HealthcareDrips::submit_professional_license(
        &env,
        LicenseType::Pharmacist,
        String::from_str(&env, "PH345678"),
        String::from_str(&env, "Pharmacy Board"),
        946684800,
        1893456000,
        String::from_str(&env, "QmLicensePharm"),
        contributor.clone(),
    ).unwrap();
    
    HealthcareDrips::verify_professional_license(
        &env,
        contributor.clone(),
        LicenseType::Pharmacist,
        true,
        String::from_str(&env, "Verified"),
        admin.clone(),
    ).unwrap();
    
    // Check final tier (should be Senior: 50 + 100 + 80 = 230 points)
    let stats = HealthcareDrips::get_contributor_stats(&env, contributor).unwrap();
    assert_eq!(stats.reputation, 230);
    assert_eq!(stats.level, ContributorLevel::Senior);
}

#[test]
fn test_error_handling_kyc_already_submitted() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Submit first KYC
    HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "First KYC"),
        946684800,
        String::from_str(&env, "US"),
        String::from_str(&env, "passport"),
        String::from_str(&env, "P111111111"),
        String::from_str(&env, "QmHash1"),
        contributor.clone(),
    ).unwrap();
    
    // Try to submit second KYC - should fail
    let result = HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "Second KYC"),
        946684800,
        String::from_str(&env, "US"),
        String::from_str(&env, "passport"),
        String::from_str(&env, "P222222222"),
        String::from_str(&env, "QmHash2"),
        contributor.clone(),
    );
    
    assert_eq!(result, Err(HealthcareDripsError::KycAlreadySubmitted));
}

#[test]
fn test_error_handling_license_without_kyc() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Try to submit license without KYC - should fail
    let result = HealthcareDrips::submit_professional_license(
        &env,
        LicenseType::MedicalDoctor,
        String::from_str(&env, "MD123"),
        String::from_str(&env, "Test Board"),
        946684800,
        1893456000,
        String::from_str(&env, "QmHashTest"),
        contributor.clone(),
    );
    
    assert_eq!(result, Err(HealthcareDripsError::KycNotApproved));
}

#[test]
fn test_contributor_eligibility_check() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Check eligibility without KYC - should be false
    let eligible = HealthcareDrips::check_contributor_eligibility(
        &env,
        contributor.clone(),
        ContributorLevel::Junior,
    ).unwrap();
    assert!(!eligible);
    
    // Submit and approve KYC
    HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "Eligible User"),
        946684800,
        String::from_str(&env, "US"),
        String::from_str(&env, "passport"),
        String::from_str(&env, "P333333333"),
        String::from_str(&env, "QmHashEligible"),
        contributor.clone(),
    ).unwrap();
    
    HealthcareDrips::review_kyc_verification(
        &env,
        contributor.clone(),
        true,
        String::from_str(&env, ""),
        admin.clone(),
    ).unwrap();
    
    // Check eligibility with KYC - should be true for Junior level
    let eligible = HealthcareDrips::check_contributor_eligibility(
        &env,
        contributor.clone(),
        ContributorLevel::Junior,
    ).unwrap();
    assert!(eligible);
    
    // Check eligibility for higher level - should be false
    let eligible = HealthcareDrips::check_contributor_eligibility(
        &env,
        contributor.clone(),
        ContributorLevel::Senior,
    ).unwrap();
    assert!(!eligible);
}

#[test]
fn test_pending_verifications_view() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contributor1 = Address::generate(&env);
    let contributor2 = Address::generate(&env);
    
    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());
    
    // Submit KYC for contributor1
    HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "User One"),
        946684800,
        String::from_str(&env, "US"),
        String::from_str(&env, "passport"),
        String::from_str(&env, "P111111111"),
        String::from_str(&env, "QmHash1"),
        contributor1.clone(),
    ).unwrap();
    
    // Approve KYC for contributor2 and submit license
    HealthcareDrips::submit_kyc_verification(
        &env,
        String::from_str(&env, "User Two"),
        946684800,
        String::from_str(&env, "Canada"),
        String::from_str(&env, "national_id"),
        String::from_str(&env, "ID222222222"),
        String::from_str(&env, "QmHash2"),
        contributor2.clone(),
    ).unwrap();
    
    HealthcareDrips::review_kyc_verification(
        &env,
        contributor2.clone(),
        true,
        String::from_str(&env, ""),
        admin.clone(),
    ).unwrap();
    
    HealthcareDrips::submit_professional_license(
        &env,
        LicenseType::Nurse,
        String::from_str(&env, "RN333333"),
        String::from_str(&env, "Nursing Board"),
        946684800,
        1893456000,
        String::from_str(&env, "QmLicense3"),
        contributor2.clone(),
    ).unwrap();
    
    // Get pending KYC verifications
    let pending_kyc = HealthcareDrips::get_pending_kyc_verifications(&env);
    assert_eq!(pending_kyc.len(), 1);
    assert_eq!(pending_kyc.get(0).unwrap().contributor, contributor1);
    
    // Get pending license verifications
    let pending_licenses = HealthcareDrips::get_pending_license_verifications(&env);
    assert_eq!(pending_licenses.len(), 1);
    assert_eq!(pending_licenses.get(0).unwrap().contributor, contributor2);
}

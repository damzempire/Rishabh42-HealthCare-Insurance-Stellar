# Enhanced Contributor Verification

This feature strengthens contributor verification with KYC integration, professional licensing verification, and reputation decay for the Healthcare Insurance Stellar platform.

## Overview

The Enhanced Contributor Verification system provides:

- **KYC (Know Your Customer) Verification**: Identity verification with document storage
- **Professional License Verification**: Healthcare professional credential verification
- **Reputation System**: Dynamic reputation scoring with 5% monthly decay
- **Tier Advancement**: Automated contributor tier progression based on reputation
- **Comprehensive Audit Trail**: Complete tracking of all verification activities

## Features

### 1. KYC Verification

#### Document Types Supported
- Passport
- National ID
- Driving License

#### Required Information
- Full Name
- Date of Birth
- Nationality
- Document Number
- Identity Document (file upload)
- Address Proof (file upload)
- Selfie (file upload)

#### Status Flow
1. **Not Submitted** → **Pending** → **In Review** → **Approved/Rejected**
2. **Rejected** can be resubmitted with corrected information

### 2. Professional License Verification

#### Supported License Types
- Medical Doctor (100 reputation points)
- Nurse (75 reputation points)
- Pharmacist (80 reputation points)
- Therapist (70 reputation points)
- Medical Technician (60 reputation points)
- Healthcare Administrator (65 reputation points)
- Mental Health Counselor (70 reputation points)
- Nutritionist (55 reputation points)
- Other (50 reputation points)

#### Requirements
- KYC must be approved before submitting professional licenses
- License number and issuing authority verification
- Issue and expiry date tracking
- Document upload for license verification

### 3. Reputation System

#### Reputation Points
- **KYC Approval**: +50 points
- **License Verification**: +50-100 points (varies by license type)
- **Application Review**: +5 points
- **Approved Application**: +10 points
- **Successful Contribution**: +20 points
- **Exceptional Impact**: +50 points

#### Monthly Decay
- **5% decay per month** for inactive contributors
- Inactivity defined as no activity for 30+ days
- Decay applied to reputation score only
- Tier downgrades occur if reputation falls below threshold

### 4. Contributor Tiers

#### Tier System
- **Junior**: 0-49 reputation points
- **Intermediate**: 50-149 reputation points
- **Senior**: 150-299 reputation points
- **Expert**: 300-599 reputation points
- **Master**: 600+ reputation points

#### Tier Benefits
- **Junior**: 10 HCT per approved application
- **Intermediate**: 25 HCT per approved application
- **Senior**: 50 HCT per approved application
- **Expert**: 100 HCT per approved application
- **Master**: 200 HCT per approved application

## API Endpoints

### KYC Verification

#### Submit KYC
```
POST /api/contributor/kyc/submit
Content-Type: multipart/form-data

Body:
- fullName: string
- dateOfBirth: ISO date
- nationality: string
- documentType: passport|national_id|driving_license
- documentNumber: string
- identityDocument: file
- addressProof: file
- selfie: file
```

#### Get KYC Status
```
GET /api/contributor/kyc/status
Authorization: Bearer <token>
```

#### Get Pending KYC Verifications (Admin/Reviewer)
```
GET /api/contributor/kyc/pending
Authorization: Bearer <token>
```

#### Review KYC (Admin/Reviewer)
```
POST /api/contributor/kyc/:kycId/review
Authorization: Bearer <token>

Body:
- approved: boolean
- rejectionReason: string (optional)
```

### Professional License Verification

#### Submit License
```
POST /api/contributor/license/submit
Content-Type: multipart/form-data

Body:
- licenseType: medical_doctor|nurse|pharmacist|therapist|medical_technician|healthcare_administrator|mental_health_counselor|nutritionist|other
- licenseNumber: string
- issuingAuthority: string
- issueDate: ISO date
- expiryDate: ISO date
- licenseDocument: file
```

#### Get My Licenses
```
GET /api/contributor/license/my-licenses
Authorization: Bearer <token>
```

#### Get Pending License Verifications (Admin/Reviewer)
```
GET /api/contributor/license/pending
Authorization: Bearer <token>
```

#### Verify License (Admin/Reviewer)
```
POST /api/contributor/license/:licenseId/verify
Authorization: Bearer <token>

Body:
- approved: boolean
- notes: string (optional)
```

### Reputation Management

#### Apply Reputation Decay (Admin)
```
POST /api/contributor/reputation/apply-decay
Authorization: Bearer <token>
```

## Smart Contract Integration

### New Types Added

```rust
// KYC Status
pub enum KycStatus {
    NotSubmitted = 0,
    Pending = 1,
    InReview = 2,
    Approved = 3,
    Rejected = 4,
    Expired = 5,
}

// License Types
pub enum LicenseType {
    MedicalDoctor = 0,
    Nurse = 1,
    Pharmacist = 2,
    Therapist = 3,
    MedicalTechnician = 4,
    HealthcareAdministrator = 5,
    MentalHealthCounselor = 6,
    Nutritionist = 7,
    Other = 8,
}

// Enhanced Contributor Stats
pub struct ContributorStats {
    pub contributor: Address,
    pub total_issues_reviewed: u32,
    pub total_issues_approved: u32,
    pub total_contributed: i128,
    pub level: ContributorLevel,
    pub reputation: u32,
    pub joined: u64,
    pub kyc_status: KycStatus,
    pub kyc_submitted: u64,
    pub kyc_approved: u64,
    pub last_activity: u64,
    pub reputation_decay_month: u32,
}
```

### Key Functions

```rust
// KYC Verification
pub fn submit_kyc_verification(
    env: &Env,
    full_name: String,
    date_of_birth: u64,
    nationality: String,
    document_type: String,
    document_number: String,
    ipfs_hash: String,
    caller: Address,
) -> Result<u64, HealthcareDripsError>

// License Verification
pub fn submit_professional_license(
    env: &Env,
    license_type: LicenseType,
    license_number: String,
    issuing_authority: String,
    issue_date: u64,
    expiry_date: u64,
    ipfs_hash: String,
    caller: Address,
) -> Result<u64, HealthcareDripsError>

// Reputation Decay
pub fn apply_reputation_decay(
    env: &Env,
    contributor: Address,
    caller: Address,
) -> Result<(), HealthcareDripsError>
```

## Database Schema

### Tables Added

#### kyc_verifications
- Stores KYC verification data and status
- Links to users table
- Tracks submission and review timestamps

#### professional_licenses
- Stores professional license information
- Links to users table
- Tracks verification status and expiry

#### reputation_history
- Audit trail for all reputation changes
- Tracks change type, amount, and reason

#### contributor_activities
- Complete activity log for contributors
- Stores metadata for analytics

### Views Added

#### contributor_summary
- Aggregated view of contributor status
- Includes license counts and expiry information

#### pending_verifications
- Unified view of all pending verifications
- Combines KYC and license verifications

## Security Features

### Document Storage
- IPFS integration for decentralized storage
- SHA256 hashing for document integrity
- Encrypted storage for sensitive information

### Access Control
- Role-based permissions (admin, reviewer, contributor)
- JWT authentication for all endpoints
- Input validation and sanitization

### Audit Trail
- Complete logging of all verification activities
- Immutable reputation history
- Activity tracking with IP and user agent

## Installation & Setup

### 1. Database Migration
```bash
# Run the SQLite migration
sqlite3 healthcare.db < backend/database/enhanced_contributor_verification_sqlite.sql
```

### 2. Install Dependencies
```bash
cd backend
npm install
```

### 3. Environment Variables
```env
# Add to .env file
IPFS_URL=https://ipfs.infura.io:5001
DB_PATH=./database/healthcare.db
```

### 4. Start Server
```bash
npm run dev
```

## Testing

### Unit Tests
```bash
npm test
```

### API Testing
Use the provided test cases or tools like Postman to test the API endpoints.

## Usage Examples

### Contributor Flow
1. Register account
2. Submit KYC verification with documents
3. Wait for KYC approval
4. Submit professional licenses
5. Gain reputation through contributions
6. Advance through tiers automatically

### Admin Flow
1. Review pending KYC verifications
2. Verify professional licenses
3. Apply reputation decay periodically
4. Monitor contributor activity

## Monitoring & Analytics

### Key Metrics
- KYC approval rate
- License verification turnaround time
- Reputation distribution across tiers
- Active vs inactive contributor ratio

### Reports Available
- Pending verifications dashboard
- Reputation history reports
- Contributor tier progression
- Activity analytics

## Future Enhancements

### Planned Features
- Automated document verification with AI
- Integration with professional licensing boards
- Advanced reputation algorithms
- Multi-factor authentication for high-value contributors
- Cross-platform reputation portability

### Scalability Considerations
- Distributed verification processing
- Caching for frequently accessed data
- Load balancing for high-volume periods
- Database optimization for large datasets

## Support & Documentation

For technical support or questions:
- Review the API documentation
- Check the test cases for usage examples
- Contact the development team

## License

This feature is part of the Healthcare Insurance Stellar platform and is licensed under the MIT License.

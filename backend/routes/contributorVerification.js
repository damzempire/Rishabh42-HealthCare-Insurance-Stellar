const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { cacheMiddleware } = require('../middleware/cache');
const sqlite3 = require('sqlite3').verbose();

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images and documents are allowed'));
    }
  }
});

// Middleware to validate request
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get database connection
function getDatabase() {
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');
  return new sqlite3.Database(DB_PATH);
}

// ========== KYC VERIFICATION ENDPOINTS ==========

router.post('/kyc/submit',
  authenticateToken,
  upload.fields([
    { name: 'identityDocument', maxCount: 1 },
    { name: 'addressProof', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
  ]),
  [
    body('fullName').trim().isLength({ min: 2, max: 100 }).withMessage('Full name must be 2-100 characters'),
    body('dateOfBirth').isISO8601().withMessage('Valid date of birth required'),
    body('nationality').trim().isLength({ min: 2, max: 50 }).withMessage('Nationality must be 2-50 characters'),
    body('documentType').isIn(['passport', 'national_id', 'driving_license']).withMessage('Invalid document type'),
    body('documentNumber').trim().isLength({ min: 5, max: 50 }).withMessage('Document number must be 5-50 characters')
  ],
  validateRequest,
  async (req, res, next) => {
    let db;
    try {
      const { fullName, dateOfBirth, nationality, documentType, documentNumber } = req.body;
      const userId = req.user.id;
      
      db = getDatabase();
      
      // Check if KYC already submitted
      const existingKyc = await new Promise((resolve, reject) => {
        db.get(
          'SELECT id FROM kyc_verifications WHERE user_id = ? AND status NOT IN (?, ?)',
          [userId, 'rejected', 'expired'],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      
      if (existingKyc) {
        return res.status(400).json({ error: 'KYC verification already submitted or pending' });
      }
      
      // Simulate IPFS storage with hash generation
      const documentHashes = {};
      for (const [fieldName, files] of Object.entries(req.files)) {
        if (files && files.length > 0) {
          const file = files[0];
          documentHashes[fieldName] = crypto.createHash('sha256').update(file.buffer).digest('hex');
        }
      }
      
      // Create metadata hash
      const metadata = {
        fullName,
        dateOfBirth,
        nationality,
        documentType,
        documentNumber,
        documents: documentHashes,
        submittedAt: new Date().toISOString()
      };
      
      const ipfsHash = crypto.createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
      
      // Insert KYC verification record
      const result = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO kyc_verifications 
           (user_id, full_name, date_of_birth, nationality, document_type, document_number, ipfs_hash, status, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, fullName, dateOfBirth, nationality, documentType, documentNumber, ipfsHash, 'pending', new Date().toISOString()],
          function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID });
          }
        );
      });
      
      // Update user's KYC status
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET kyc_status = ?, kyc_submitted_at = ? WHERE id = ?',
          ['pending', new Date().toISOString(), userId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      
      res.status(201).json({
        message: 'KYC verification submitted successfully',
        kycId: result.id,
        ipfsHash
      });
      
    } catch (error) {
      next(error);
    } finally {
      if (db) db.close();
    }
  }
);

router.get('/kyc/status',
  authenticateToken,
  async (req, res, next) => {
    let db;
    try {
      const userId = req.user.id;
      db = getDatabase();
      
      const result = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id, status, submitted_at, reviewed_at, rejection_reason 
           FROM kyc_verifications 
           WHERE user_id = ? 
           ORDER BY submitted_at DESC 
           LIMIT 1`,
          [userId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      
      if (!result) {
        return res.json({ status: 'not_submitted' });
      }
      
      res.json({
        id: result.id,
        status: result.status,
        submittedAt: result.submitted_at,
        reviewedAt: result.reviewed_at,
        rejectionReason: result.rejection_reason
      });
      
    } catch (error) {
      next(error);
    } finally {
      if (db) db.close();
    }
  }
);

router.get('/kyc/pending',
  authenticateToken,
  authorizeRoles(['admin', 'reviewer']),
  async (req, res, next) => {
    let db;
    try {
      db = getDatabase();
      
      const result = await new Promise((resolve, reject) => {
        db.all(
          `SELECT k.id, k.user_id, k.full_name, k.nationality, k.document_type, 
                  k.status, k.submitted_at, u.email, u.first_name, u.last_name
           FROM kyc_verifications k
           JOIN users u ON k.user_id = u.id
           WHERE k.status IN ('pending', 'in_review')
           ORDER BY k.submitted_at ASC`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
      
      res.json(result);
      
    } catch (error) {
      next(error);
    } finally {
      if (db) db.close();
    }
  }
);

router.post('/kyc/:kycId/review',
  authenticateToken,
  authorizeRoles(['admin', 'reviewer']),
  [
    body('approved').isBoolean().withMessage('Approved status must be boolean'),
    body('rejectionReason').optional().trim().isLength({ max: 500 }).withMessage('Rejection reason max 500 characters')
  ],
  validateRequest,
  async (req, res, next) => {
    let db;
    try {
      const { kycId } = req.params;
      const { approved, rejectionReason } = req.body;
      const reviewerId = req.user.id;
      
      db = getDatabase();
      
      // Update KYC verification
      const result = await new Promise((resolve, reject) => {
        db.run(
          `UPDATE kyc_verifications 
           SET status = ?, reviewed_at = ?, reviewer_id = ?, rejection_reason = ?
           WHERE id = ? AND status IN ('pending', 'in_review')`,
          [approved ? 'approved' : 'rejected', new Date().toISOString(), reviewerId, rejectionReason || null, kycId],
          function(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
          }
        );
      });
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'KYC verification not found or already processed' });
      }
      
      // Get user ID from KYC
      const userId = await new Promise((resolve, reject) => {
        db.get(
          'SELECT user_id FROM kyc_verifications WHERE id = ?',
          [kycId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.user_id);
          }
        );
      });
      
      if (!userId) {
        return res.status(404).json({ error: 'KYC verification not found' });
      }
      
      // Update user's KYC status and reputation
      const reputationBonus = approved ? 50 : 0;
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE users 
           SET kyc_status = ?, kyc_approved_at = ?, reputation = COALESCE(reputation, 0) + ?
           WHERE id = ?`,
          [approved ? 'approved' : 'rejected', approved ? new Date().toISOString() : null, reputationBonus, userId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      
      // Check for tier advancement
      if (approved) {
        await checkTierAdvancement(userId, db);
      }
      
      res.json({
        message: `KYC verification ${approved ? 'approved' : 'rejected'} successfully`,
        userId
      });
      
    } catch (error) {
      next(error);
    } finally {
      if (db) db.close();
    }
  }
);

// ========== PROFESSIONAL LICENSE VERIFICATION ENDPOINTS ==========

router.post('/license/submit',
  authenticateToken,
  upload.single('licenseDocument'),
  [
    body('licenseType').isIn([
      'medical_doctor', 'nurse', 'pharmacist', 'therapist', 
      'medical_technician', 'healthcare_administrator', 
      'mental_health_counselor', 'nutritionist', 'other'
    ]).withMessage('Invalid license type'),
    body('licenseNumber').trim().isLength({ min: 5, max: 50 }).withMessage('License number must be 5-50 characters'),
    body('issuingAuthority').trim().isLength({ min: 2, max: 100 }).withMessage('Issuing authority must be 2-100 characters'),
    body('issueDate').isISO8601().withMessage('Valid issue date required'),
    body('expiryDate').isISO8601().withMessage('Valid expiry date required')
  ],
  validateRequest,
  async (req, res, next) => {
    let db;
    try {
      const { licenseType, licenseNumber, issuingAuthority, issueDate, expiryDate } = req.body;
      const userId = req.user.id;
      
      db = getDatabase();
      
      // Check if user has approved KYC
      const userResult = await new Promise((resolve, reject) => {
        db.get(
          'SELECT kyc_status FROM users WHERE id = ?',
          [userId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      
      if (!userResult || userResult.kyc_status !== 'approved') {
        return res.status(400).json({ error: 'KYC must be approved before submitting professional license' });
      }
      
      // Check if license already submitted for this type
      const existingLicense = await new Promise((resolve, reject) => {
        db.get(
          'SELECT id FROM professional_licenses WHERE user_id = ? AND license_type = ? AND verification_status NOT IN (?, ?)',
          [userId, licenseType, 'rejected', 'expired'],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      
      if (existingLicense) {
        return res.status(400).json({ error: 'License of this type already submitted or pending' });
      }
      
      // Simulate IPFS upload
      const ipfsHash = req.file ? crypto.createHash('sha256').update(req.file.buffer).digest('hex') : null;
      
      // Insert license verification record
      const result = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO professional_licenses 
           (user_id, license_type, license_number, issuing_authority, issue_date, expiry_date, ipfs_hash, verification_status, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, licenseType, licenseNumber, issuingAuthority, issueDate, expiryDate, ipfsHash, 'pending', new Date().toISOString()],
          function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID });
          }
        );
      });
      
      res.status(201).json({
        message: 'Professional license submitted successfully',
        licenseId: result.id,
        ipfsHash
      });
      
    } catch (error) {
      next(error);
    } finally {
      if (db) db.close();
    }
  }
);

router.get('/license/my-licenses',
  authenticateToken,
  async (req, res, next) => {
    let db;
    try {
      const userId = req.user.id;
      db = getDatabase();
      
      const result = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, license_type, license_number, issuing_authority, issue_date, expiry_date,
                  verification_status, submitted_at, verified_at, notes
           FROM professional_licenses
           WHERE user_id = ?
           ORDER BY submitted_at DESC`,
          [userId],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
      
      res.json(result);
      
    } catch (error) {
      next(error);
    } finally {
      if (db) db.close();
    }
  }
);

router.get('/license/pending',
  authenticateToken,
  authorizeRoles(['admin', 'reviewer']),
  async (req, res, next) => {
    let db;
    try {
      db = getDatabase();
      
      const result = await new Promise((resolve, reject) => {
        db.all(
          `SELECT l.id, l.user_id, l.license_type, l.license_number, l.issuing_authority,
                  l.issue_date, l.expiry_date, l.submitted_at, u.email, u.first_name, u.last_name
           FROM professional_licenses l
           JOIN users u ON l.user_id = u.id
           WHERE l.verification_status = 'pending'
           ORDER BY l.submitted_at ASC`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
      
      res.json(result);
      
    } catch (error) {
      next(error);
    } finally {
      if (db) db.close();
    }
  }
);

router.post('/license/:licenseId/verify',
  authenticateToken,
  authorizeRoles(['admin', 'reviewer']),
  [
    body('approved').isBoolean().withMessage('Approved status must be boolean'),
    body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes max 500 characters')
  ],
  validateRequest,
  async (req, res, next) => {
    let db;
    try {
      const { licenseId } = req.params;
      const { approved, notes } = req.body;
      const verifierId = req.user.id;
      
      db = getDatabase();
      
      // Get license details
      const licenseResult = await new Promise((resolve, reject) => {
        db.get(
          'SELECT user_id, license_type FROM professional_licenses WHERE id = ? AND verification_status = ?',
          [licenseId, 'pending'],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      
      if (!licenseResult) {
        return res.status(404).json({ error: 'License not found or already processed' });
      }
      
      const { userId, licenseType } = licenseResult;
      
      // Update license verification
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE professional_licenses 
           SET verification_status = ?, verified_at = ?, verifier_id = ?, notes = ?
           WHERE id = ?`,
          [approved ? 'verified' : 'rejected', new Date().toISOString(), verifierId, notes || null, licenseId],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      
      // Update user's reputation based on license type
      if (approved) {
        const reputationBonus = getLicenseReputationBonus(licenseType);
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE users SET reputation = COALESCE(reputation, 0) + ? WHERE id = ?',
            [reputationBonus, userId],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        
        // Check for tier advancement
        await checkTierAdvancement(userId, db);
      }
      
      res.json({
        message: `License ${approved ? 'verified' : 'rejected'} successfully`,
        userId,
        reputationBonus: approved ? getLicenseReputationBonus(licenseType) : 0
      });
      
    } catch (error) {
      next(error);
    } finally {
      if (db) db.close();
    }
  }
);

// ========== REPUTATION DECAY ENDPOINTS ==========

router.post('/reputation/apply-decay',
  authenticateToken,
  authorizeRoles(['admin']),
  async (req, res, next) => {
    let db;
    try {
      db = getDatabase();
      
      const result = await new Promise((resolve, reject) => {
        db.all(
          `UPDATE users 
           SET reputation = GREATEST(0, CAST(COALESCE(reputation, 0) * 0.95 AS INTEGER))
           WHERE last_activity < datetime('now', '-30 days')
           RETURNING id, email, reputation`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
      
      // Check for tier downgrades
      for (const user of result) {
        await checkTierDowngrade(user.id, db);
      }
      
      res.json({
        message: 'Reputation decay applied successfully',
        affectedUsers: result.length,
        users: result
      });
      
    } catch (error) {
      next(error);
    } finally {
      if (db) db.close();
    }
  }
);

// ========== HELPER FUNCTIONS ==========

function getLicenseReputationBonus(licenseType) {
  const bonuses = {
    medical_doctor: 100,
    nurse: 75,
    pharmacist: 80,
    therapist: 70,
    medical_technician: 60,
    healthcare_administrator: 65,
    mental_health_counselor: 70,
    nutritionist: 55,
    other: 50
  };
  return bonuses[licenseType] || 50;
}

async function checkTierAdvancement(userId, db) {
  const userResult = await new Promise((resolve, reject) => {
    db.get(
      'SELECT reputation FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
  
  if (!userResult) return;
  
  const reputation = userResult.reputation || 0;
  let newLevel = 'junior';
  
  if (reputation >= 600) newLevel = 'master';
  else if (reputation >= 300) newLevel = 'expert';
  else if (reputation >= 150) newLevel = 'senior';
  else if (reputation >= 50) newLevel = 'intermediate';
  
  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET contributor_level = ? WHERE id = ?',
      [newLevel, userId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function checkTierDowngrade(userId, db) {
  const userResult = await new Promise((resolve, reject) => {
    db.get(
      'SELECT reputation FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
  
  if (!userResult) return;
  
  const reputation = userResult.reputation || 0;
  let newLevel = 'junior';
  
  if (reputation >= 600) newLevel = 'master';
  else if (reputation >= 300) newLevel = 'expert';
  else if (reputation >= 150) newLevel = 'senior';
  else if (reputation >= 50) newLevel = 'intermediate';
  
  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET contributor_level = ? WHERE id = ?',
      [newLevel, userId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

module.exports = router;

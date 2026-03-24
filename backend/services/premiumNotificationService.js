const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class PremiumNotificationService {
  constructor(io) {
    this.io = io;
    this.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../database/healthcare.db');
  }

  getDatabase() {
    return new sqlite3.Database(this.DB_PATH);
  }

  async notifyPremiumChange(adjustmentData, notificationType = 'adjustment_created') {
    const db = this.getDatabase();
    
    try {
      const patient = await this.getPatientDetails(db, adjustmentData.patientId);
      const notifications = await this.generateNotifications(adjustmentData, patient, notificationType);
      
      for (const notification of notifications) {
        await this.createNotification(db, notification);
        
        if (this.io) {
          this.emitRealTimeNotification(notification);
        }
        
        if (notification.channel === 'email') {
          await this.sendEmailNotification(notification);
        }
        
        if (notification.channel === 'sms') {
          await this.sendSMSNotification(notification);
        }
      }
      
      await this.updateAdjustmentNotificationStatus(db, adjustmentData.id);
      
      return {
        success: true,
        notificationsSent: notifications.length,
        notificationTypes: notifications.map(n => n.type)
      };
    } catch (error) {
      console.error('Error sending premium change notifications:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  async generateNotifications(adjustmentData, patient, notificationType) {
    const notifications = [];
    
    switch (notificationType) {
      case 'adjustment_created':
        notifications.push(...await this.generateAdjustmentCreatedNotifications(adjustmentData, patient));
        break;
      case 'adjustment_approved':
        notifications.push(...await this.generateAdjustmentApprovedNotifications(adjustmentData, patient));
        break;
      case 'adjustment_rejected':
        notifications.push(...await this.generateAdjustmentRejectedNotifications(adjustmentData, patient));
        break;
      case 'adjustment_effective':
        notifications.push(...await this.generateAdjustmentEffectiveNotifications(adjustmentData, patient));
        break;
      case 'governance_required':
        notifications.push(...await this.generateGovernanceRequiredNotifications(adjustmentData, patient));
        break;
    }
    
    return notifications;
  }

  async generateAdjustmentCreatedNotifications(adjustmentData, patient) {
    const notifications = [];
    
    notifications.push({
      userId: patient.user_id,
      type: 'premium_adjustment',
      title: 'Premium Adjustment Under Review',
      message: `Your premium adjustment request of ${adjustmentData.adjustmentPercentage > 0 ? '+' : ''}${adjustmentData.adjustmentPercentage}% is under review. Current premium: $${adjustmentData.previousPremium}`,
      priority: this.determinePriority(adjustmentData.adjustmentPercentage),
      channel: 'in_app',
      adjustmentId: adjustmentData.id,
      patientId: adjustmentData.patientId,
      scheduledAt: new Date().toISOString()
    });
    
    if (Math.abs(adjustmentData.adjustmentPercentage) >= 10) {
      notifications.push({
        userId: patient.user_id,
        type: 'premium_adjustment',
        title: 'Premium Adjustment Under Review',
        message: `Your premium adjustment request has been submitted and is currently under review. You will be notified of the decision within 3-5 business days.`,
        priority: this.determinePriority(adjustmentData.adjustmentPercentage),
        channel: 'email',
        adjustmentId: adjustmentData.id,
        patientId: adjustmentData.patientId,
        scheduledAt: new Date().toISOString()
      });
    }
    
    return notifications;
  }

  async generateAdjustmentApprovedNotifications(adjustmentData, patient) {
    const notifications = [];
    
    notifications.push({
      userId: patient.user_id,
      type: 'premium_adjustment',
      title: 'Premium Adjustment Approved',
      message: `Your premium has been ${adjustmentData.adjustmentType}d from $${adjustmentData.previousPremium} to $${adjustmentData.newPremium}. Effective: ${adjustmentData.effectiveDate}`,
      priority: 'high',
      channel: 'in_app',
      adjustmentId: adjustmentData.id,
      patientId: adjustmentData.patientId,
      scheduledAt: new Date().toISOString()
    });
    
    notifications.push({
      userId: patient.user_id,
      type: 'premium_adjustment',
      title: 'Premium Adjustment Approved',
      message: `Good news! Your premium adjustment has been approved. Your new premium of $${adjustmentData.newPremium} will be effective starting ${adjustmentData.effectiveDate}.`,
      priority: 'high',
      channel: 'email',
      adjustmentId: adjustmentData.id,
      patientId: adjustmentData.patientId,
      scheduledAt: new Date().toISOString()
    });
    
    if (adjustmentData.adjustmentPercentage > 15) {
      notifications.push({
        userId: patient.user_id,
        type: 'premium_adjustment',
        title: 'Important: Premium Change Notification',
        message: `Your premium will change from $${adjustmentData.previousPremium} to $${adjustmentData.newPremium} on ${adjustmentData.effectiveDate}. Please review your payment method.`,
        priority: 'urgent',
        channel: 'sms',
        adjustmentId: adjustmentData.id,
        patientId: adjustmentData.patientId,
        scheduledAt: new Date().toISOString()
      });
    }
    
    return notifications;
  }

  async generateAdjustmentRejectedNotifications(adjustmentData, patient) {
    const notifications = [];
    
    notifications.push({
      userId: patient.user_id,
      type: 'premium_adjustment',
      title: 'Premium Adjustment Review Complete',
      message: `Your premium adjustment request has been reviewed. Your premium will remain at $${adjustmentData.previousPremium}. Reason: ${adjustmentData.governanceNotes || 'Does not meet adjustment criteria'}`,
      priority: 'medium',
      channel: 'in_app',
      adjustmentId: adjustmentData.id,
      patientId: adjustmentData.patientId,
      scheduledAt: new Date().toISOString()
    });
    
    notifications.push({
      userId: patient.user_id,
      type: 'premium_adjustment',
      title: 'Premium Adjustment Update',
      message: `Your recent premium adjustment request has been reviewed. Your premium will remain unchanged at $${adjustmentData.previousPremium}.`,
      priority: 'medium',
      channel: 'email',
      adjustmentId: adjustmentData.id,
      patientId: adjustmentData.patientId,
      scheduledAt: new Date().toISOString()
    });
    
    return notifications;
  }

  async generateAdjustmentEffectiveNotifications(adjustmentData, patient) {
    const notifications = [];
    
    notifications.push({
      userId: patient.user_id,
      type: 'premium_adjustment',
      title: 'Premium Adjustment Effective Today',
      message: `Your premium adjustment is now effective. New premium: $${adjustmentData.newPremium}`,
      priority: 'high',
      channel: 'in_app',
      adjustmentId: adjustmentData.id,
      patientId: adjustmentData.patientId,
      scheduledAt: new Date().toISOString()
    });
    
    return notifications;
  }

  async generateGovernanceRequiredNotifications(adjustmentData, patient) {
    const notifications = [];
    
    const reviewers = await this.getAdminUsers();
    
    for (const reviewer of reviewers) {
      notifications.push({
        userId: reviewer.id,
        type: 'premium_adjustment',
        title: 'Premium Adjustment Review Required',
        message: `A premium adjustment for patient ${adjustmentData.patientId} requires governance review. Adjustment: ${adjustmentData.adjustmentPercentage}%`,
        priority: 'high',
        channel: 'in_app',
        adjustmentId: adjustmentData.id,
        patientId: adjustmentData.patientId,
        scheduledAt: new Date().toISOString()
      });
    }
    
    return notifications;
  }

  determinePriority(adjustmentPercentage) {
    const absPercentage = Math.abs(adjustmentPercentage);
    
    if (absPercentage >= 15) return 'urgent';
    if (absPercentage >= 10) return 'high';
    if (absPercentage >= 5) return 'medium';
    return 'low';
  }

  async getPatientDetails(db, patientId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT p.*, u.email, u.phone, u.first_name, u.last_name
        FROM patients p
        JOIN users u ON p.user_id = u.id
        WHERE p.id = ?
      `;
      
      db.get(query, [patientId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getAdminUsers() {
    const db = this.getDatabase();
    
    try {
      return new Promise((resolve, reject) => {
        const query = 'SELECT id, first_name, last_name, email FROM users WHERE role = "admin"';
        db.all(query, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } finally {
      db.close();
    }
  }

  async createNotification(db, notificationData) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO notifications (user_id, title, message, type, priority)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        notificationData.userId,
        notificationData.title,
        notificationData.message,
        notificationData.type,
        notificationData.priority
      ], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, ...notificationData });
      });
    });
  }

  emitRealTimeNotification(notification) {
    if (this.io) {
      this.io.emit('premium-notification', {
        id: notification.id,
        userId: notification.userId,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        priority: notification.priority,
        timestamp: new Date().toISOString()
      });
    }
  }

  async sendEmailNotification(notification) {
    console.log(`Email notification sent to user ${notification.userId}:`, {
      title: notification.title,
      message: notification.message,
      timestamp: new Date().toISOString()
    });
    
    return { success: true, channel: 'email' };
  }

  async sendSMSNotification(notification) {
    console.log(`SMS notification sent to user ${notification.userId}:`, {
      title: notification.title,
      message: notification.message,
      timestamp: new Date().toISOString()
    });
    
    return { success: true, channel: 'sms' };
  }

  async updateAdjustmentNotificationStatus(db, adjustmentId) {
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE premium_adjustments 
        SET notification_sent = TRUE 
        WHERE id = ?
      `;
      
      db.run(query, [adjustmentId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  async scheduleReminderNotifications(adjustmentData) {
    const db = this.getDatabase();
    
    try {
      const effectiveDate = new Date(adjustmentData.effectiveDate);
      const reminderDates = this.calculateReminderDates(effectiveDate);
      
      for (const reminderDate of reminderDates) {
        const notification = {
          userId: adjustmentData.patientId,
          type: 'premium_adjustment',
          title: 'Premium Adjustment Reminder',
          message: `Reminder: Your premium will change to $${adjustmentData.newPremium} on ${adjustmentData.effectiveDate}`,
          priority: 'medium',
          channel: 'email',
          adjustmentId: adjustmentData.id,
          patientId: adjustmentData.patientId,
          scheduledAt: reminderDate.toISOString()
        };
        
        await this.scheduleNotification(db, notification);
      }
      
      return { remindersScheduled: reminderDates.length };
    } catch (error) {
      console.error('Error scheduling reminder notifications:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  calculateReminderDates(effectiveDate) {
    const dates = [];
    const now = new Date();
    
    const sevenDaysBefore = new Date(effectiveDate);
    sevenDaysBefore.setDate(sevenDaysBefore.getDate() - 7);
    
    const oneDayBefore = new Date(effectiveDate);
    oneDayBefore.setDate(oneDayBefore.getDate() - 1);
    
    if (sevenDaysBefore > now) dates.push(sevenDaysBefore);
    if (oneDayBefore > now) dates.push(oneDayBefore);
    
    return dates;
  }

  async scheduleNotification(db, notificationData) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO scheduled_notifications 
        (user_id, title, message, type, priority, channel, scheduled_at, adjustment_id, patient_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      db.run(query, [
        notificationData.userId,
        notificationData.title,
        notificationData.message,
        notificationData.type,
        notificationData.priority,
        notificationData.channel,
        notificationData.scheduledAt,
        notificationData.adjustmentId,
        notificationData.patientId
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async getUserNotifications(userId, limit = 50, offset = 0) {
    const db = this.getDatabase();
    
    try {
      return new Promise((resolve, reject) => {
        const query = `
          SELECT n.*, 
            CASE WHEN n.type = 'premium_adjustment' THEN 
              JSON_OBJECT(
                'adjustmentId', pa.id,
                'adjustmentPercentage', pa.adjustment_percentage,
                'previousPremium', pa.previous_premium,
                'newPremium', pa.new_premium,
                'effectiveDate', pa.effective_date
              )
            ELSE NULL 
            END as adjustment_details
          FROM notifications n
          LEFT JOIN premium_adjustments pa ON n.type = 'premium_adjustment' AND pa.patient_id IN (
            SELECT id FROM patients WHERE user_id = ?
          )
          WHERE n.user_id = ?
          ORDER BY n.created_at DESC
          LIMIT ? OFFSET ?
        `;
        
        db.all(query, [userId, userId, limit, offset], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    } finally {
      db.close();
    }
  }

  async markNotificationAsRead(notificationId, userId) {
    const db = this.getDatabase();
    
    try {
      return new Promise((resolve, reject) => {
        const query = `
          UPDATE notifications 
          SET read = TRUE 
          WHERE id = ? AND user_id = ?
        `;
        
        db.run(query, [notificationId, userId], function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        });
      });
    } finally {
      db.close();
    }
  }

  async getUnreadCount(userId) {
    const db = this.getDatabase();
    
    try {
      return new Promise((resolve, reject) => {
        const query = 'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = FALSE';
        db.get(query, [userId], (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });
    } finally {
      db.close();
    }
  }
}

module.exports = PremiumNotificationService;

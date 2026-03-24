# Healthcare Insurance Premium Adjustment System

## 🚀 New Feature: AI-Driven Premium Adjustments

This repository now includes a comprehensive AI-driven premium adjustment system that automatically calculates and manages premium changes based on claim history, health metrics, and market conditions.

## ✨ Key Features

### 🤖 AI-Powered Analysis
- **Risk Assessment**: Advanced algorithms analyze claim patterns, denial rates, and payment behavior
- **Health Metrics Integration**: Incorporates BMI, blood pressure, cholesterol, and lifestyle factors
- **Market Condition Analysis**: Real-time analysis of inflation, healthcare costs, and industry trends
- **Predictive Analytics**: Forecast future claims and utilization patterns

### ⚙️ Automated Triggers & Limits
- **Configurable Triggers**: Set custom conditions for premium adjustments
- **Adjustment Limits**: Built-in safeguards prevent excessive changes
- **Priority Processing**: Intelligent trigger prioritization
- **Real-Time Validation**: Instant compliance checking

### 🏛️ Governance & Compliance
- **Multi-Level Approval**: Automatic approval for small changes, governance review for large ones
- **Audit Trail**: Complete documentation of all decisions
- **Reviewer Assignment**: Smart assignment based on adjustment complexity
- **Escalation Workflows**: Manual review for exceptional cases

### 📢 Smart Notifications
- **Multi-Channel**: In-app, email, and SMS notifications
- **Priority-Based Messaging**: Urgent alerts for significant changes
- **Scheduled Reminders**: Automatic notifications before changes take effect
- **Real-Time Updates**: WebSocket integration for instant alerts

## 📊 Database Schema

The system adds 7 new tables to the existing healthcare database:

- `premium_plans` - Patient premium plan information
- `premium_adjustments` - Adjustment records with AI scores
- `premium_adjustment_triggers` - Configurable adjustment triggers
- `premium_adjustment_limits` - Adjustment limits and safeguards
- `health_metrics` - Patient health data for AI analysis
- `market_conditions` - Market data affecting calculations
- `notifications` - Enhanced notification system

## 🔧 API Endpoints

### Premium Management
```
GET    /api/premium-adjustments/patient/:id/plans
POST   /api/premium-adjustments/patient/:id/plans
GET    /api/premium-adjustments/patient/:id/analysis
GET    /api/premium-adjustments/patient/:id/history
```

### Adjustment Processing
```
POST   /api/premium-adjustments/calculate/:patientId/:planId
POST   /api/premium-adjustments/submit/:patientId/:planId
```

### Governance
```
GET    /api/premium-adjustments/governance/pending
POST   /api/premium-adjustments/governance/:id/review
GET    /api/premium-adjustments/governance/metrics
```

### Configuration
```
GET    /api/premium-adjustments/triggers
POST   /api/premium-adjustments/triggers
PUT    /api/premium-adjustments/triggers/:id
DELETE /api/premium-adjustments/triggers/:id
```

### Analytics & Health
```
GET    /api/premium-adjustments/market-trends
POST   /api/premium-adjustments/predict/:patientId
GET    /api/premium-adjustments/health-metrics/:patientId
POST   /api/premium-adjustments/health-metrics/:patientId
```

## 🚀 Quick Start

### 1. Database Setup
```bash
cd backend
npm run initialize:premium
```

### 2. Start the Server
```bash
npm run dev
```

### 3. Test the System
```bash
npm run test:premium
```

## 📈 Example Usage

### Calculate Premium Adjustment
```javascript
const response = await fetch('/api/premium-adjustments/calculate/123/456', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    effectiveDate: '2024-12-01'
  })
});

const adjustment = await response.json();
console.log('New Premium:', adjustment.newPremium);
console.log('AI Confidence:', adjustment.aiScore);
```

### Create Custom Trigger
```javascript
const trigger = {
  name: 'High Utilization Alert',
  triggerType: 'claim_frequency',
  conditionOperator: '>',
  conditionValue: '15',
  adjustmentPercentage: 8.0,
  priority: 2,
  description: 'Increase premium for high utilization patterns'
};

await fetch('/api/premium-adjustments/triggers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(trigger)
});
```

## 🎯 Default Configuration

### Built-in Triggers
- **High Claim Frequency**: +5% if >10 claims in 24 months
- **Very High Frequency**: +10% if >20 claims in 24 months  
- **High Claim Amount**: +3% if total >$50,000
- **High Denial Rate**: +8% if denial rate >50%
- **Excellent Health**: -5% for good health metrics
- **Poor Health**: +7% for concerning health metrics
- **Market Inflation**: +4% when inflation >5%

### Default Limits
- **Max Annual Increase**: 20%
- **Max Single Increase**: 10%
- **Max Annual Decrease**: 30%
- **Cooling Period**: 30 days
- **Governance Threshold**: 15%

## 🧪 Testing

Run comprehensive test suite:
```bash
cd backend
npm run test:premium
```

Test coverage includes:
- ✅ Premium calculation engine
- ✅ Trigger evaluation system
- ✅ Governance workflow
- ✅ Notification system
- ✅ API endpoints
- ✅ Data analysis functions

## 📚 Documentation

- **[Complete Documentation](./PREMIUM_ADJUSTMENT_DOCUMENTATION.md)** - Detailed technical documentation
- **[API Reference](./backend/routes/premiumAdjustments.js)** - Complete API endpoint documentation
- **[Database Schema](./backend/database/init.js)** - Database structure and relationships

## 🔒 Security & Compliance

- **HIPAA Compliant**: All health data handling meets HIPAA requirements
- **Role-Based Access**: Strict access controls for governance functions
- **Audit Logging**: Complete audit trail for all adjustments
- **Data Encryption**: Sensitive data encrypted at rest and in transit

## 📊 Analytics & Monitoring

### Key Metrics
- Adjustment approval/rejection rates
- Average review times
- AI prediction accuracy
- Patient satisfaction scores

### Real-Time Monitoring
- Unusual adjustment pattern detection
- Governance bottleneck alerts
- System performance monitoring

## 🚀 Future Enhancements

- **Enhanced ML Models**: More sophisticated predictive algorithms
- **EHR Integration**: Direct electronic health record connectivity
- **Wearable Integration**: Real-time health data from devices
- **Advanced Analytics**: Deeper insights and recommendations

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For questions or support:
- 📖 Check the [documentation](./PREMIUM_ADJUSTMENT_DOCUMENTATION.md)
- 🧪 Review the [test cases](./backend/test/premiumAdjustment.test.js)
- 📧 Contact the development team

---

**Built with ❤️ for the Healthcare Insurance Industry**

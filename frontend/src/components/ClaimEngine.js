import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Cpu, 
  Plus, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Settings, 
  BarChart3, 
  Layers, 
  Play, 
  Search,
  Filter,
  ArrowRight,
  Database,
  RefreshCw,
  Trash2,
  FileText,
  BadgeAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ClaimEngine = ({ account, contract }) => {
  const [activeView, setActiveView] = useState('dashboard');
  const [stats, setStats] = useState({
    totalProcessed: 1250,
    autoApproved: 840,
    flagged: 120,
    successRate: 85,
    pending: 45
  });
  const [rules, setRules] = useState([
    { id: 1, name: 'Low Amount Auto-Approve', min: 0, max: 500, types: ['PreventiveCare'], autoApprove: true, active: true },
    { id: 2, name: 'Standard Singuery Filter', min: 1000, max: 5000, types: ['Surgery'], autoApprove: false, active: true },
    { id: 3, name: 'Emergency Fast Track', min: 0, max: 10000, types: ['EmergencyTreatment'], autoApprove: true, active: true }
  ]);
  const [claims, setClaims] = useState([
    { id: 'C-8291', patient: '0x123...456', amount: 450, type: 'PreventiveCare', status: 'Submitted', timestamp: '5 mins ago' },
    { id: 'C-8292', patient: '0x789...012', amount: 6500, type: 'Surgery', status: 'Submitted', timestamp: '12 mins ago' },
    { id: 'C-8293', patient: '0x456...789', amount: 150, type: 'MentalHealth', status: 'Submitted', timestamp: '1 hour ago' }
  ]);
  const [processing, setProcessing] = useState(false);

  const processAll = () => {
    setProcessing(true);
    setTimeout(() => {
        setProcessing(false);
        // Simulate processing results
        const updatedClaims = claims.map(c => {
            if (c.amount < 500) return { ...c, status: 'Approved', outcome: 'Auto-Approved' };
            if (c.amount > 5000) return { ...c, status: 'Flagged', outcome: 'Manual Review Required' };
            return { ...c, status: 'Under Review', outcome: 'Rule Applied' };
        });
        setClaims(updatedClaims);
        setStats(prev => ({ ...prev, totalProcessed: prev.totalProcessed + claims.length }));
    }, 2000);
  };

  const Dashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Auto-Approved', value: stats.autoApproved, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Flagged/Manual', value: stats.flagged, icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Success Rate', value: `${stats.successRate}%`, icon: BarChart3, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Pending Batch', value: claims.length, icon: Layers, color: 'text-purple-600', bg: 'bg-purple-50' }
        ].map((stat, i) => (
          <motion.div 
            key={i} 
            whileHover={{ y: -5 }}
            className="bg-white p-6 rounded-2xl shadow-lg border border-gray-100"
          >
            <div className={`p-3 rounded-xl ${stat.bg} ${stat.color} w-fit mb-4`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-gray-500">{stat.label}</p>
            <h4 className="text-3xl font-black text-gray-900 mt-1">{stat.value}</h4>
          </motion.div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-xl border overflow-hidden">
        <div className="p-6 border-b flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 className="text-lg font-bold">Claim Processing Queue</h3>
            <p className="text-sm text-gray-500">Real-time batch processing status</p>
          </div>
          <button 
            onClick={processAll}
            disabled={processing || claims.length === 0}
            className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold flex items-center hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {processing ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : <Play className="w-5 h-5 mr-2" />}
            Run Process Engine
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase font-bold text-gray-500">
                <th className="px-6 py-4">Claim ID</th>
                <th className="px-6 py-4">Patient</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {claims.map((claim, i) => (
                <tr key={i} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4 font-mono text-sm font-bold text-blue-600">{claim.id}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{claim.patient}</td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 bg-gray-100 rounded-full text-xs font-bold">{claim.type}</span>
                  </td>
                  <td className="px-6 py-4 font-bold">${claim.amount}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold 
                      ${claim.status === 'Approved' ? 'bg-green-100 text-green-700' : 
                        claim.status === 'Flagged' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                      {claim.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs font-medium text-gray-500 italic">
                    {claim.outcome || 'Awaiting Batch...'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const RuleManager = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-2xl font-black">Automation Rules</h3>
          <p className="text-gray-500">Define logic for automated claim processing</p>
        </div>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold flex items-center shadow-lg shadow-blue-200">
          <Plus className="w-5 h-5 mr-2" /> New Rule
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {rules.map(rule => (
          <div key={rule.id} className="bg-white p-6 rounded-2xl border-2 border-gray-100 hover:border-blue-200 transition group">
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-xl ${rule.autoApprove ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                {rule.autoApprove ? <CheckCircle className="w-6 h-6" /> : <Settings className="w-6 h-6" />}
              </div>
              <div className="flex space-x-2 opacity-0 group-hover:opacity-100 transition">
                <button className="p-2 text-gray-400 hover:text-blue-600"><Settings className="w-4 h-4" /></button>
                <button className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <h4 className="text-xl font-bold mb-2">{rule.name}</h4>
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Range</span>
                <span className="font-bold text-gray-900">${rule.min} - ${rule.max}</span>
              </div>
              <div className="flex justify-between">
                <span>Types</span>
                <span className="font-bold text-gray-900">{rule.types.join(', ')}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Auto-Approve</span>
                <div className={`w-10 h-5 rounded-full relative transition-colors ${rule.autoApprove ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${rule.autoApprove ? 'right-1' : 'left-1'}`} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const Analytics = () => (
    <div className="space-y-8">
      <div className="bg-gray-900 text-white p-10 rounded-3xl relative overflow-hidden">
        <div className="relative z-10 flex justify-between items-end">
          <div>
            <h3 className="text-3xl font-black mb-2">Processing Efficiency</h3>
            <p className="text-gray-400 max-w-md">Automated systems have processed 84% of claims this month with zero manual intervention needed.</p>
          </div>
          <div className="text-right">
            <p className="text-6xl font-black text-blue-400">92.4%</p>
            <p className="text-xs uppercase font-bold tracking-widest text-gray-500 mt-2">Accuracy Rate</p>
          </div>
        </div>
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <BarChart3 className="w-64 h-64" />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-2xl border shadow-sm">
          <h4 className="font-bold mb-6 flex items-center"><FileText className="w-5 h-5 mr-3 text-blue-600" /> Volume by Type</h4>
          <div className="space-y-6">
            {[
              { type: 'Surgery', count: 450, color: 'bg-blue-600' },
              { type: 'Emergency', count: 320, color: 'bg-purple-600' },
              { type: 'Mental Health', count: 280, color: 'bg-green-600' }
            ].map((t, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between text-sm font-bold">
                  <span>{t.type}</span>
                  <span>{t.count}</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${(t.count / 500) * 100}%` }} className={`h-full ${t.color}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-8 rounded-2xl border shadow-sm">
          <h4 className="font-bold mb-6 flex items-center"><BadgeAlert className="w-5 h-5 mr-3 text-orange-600" /> Top Exceptions</h4>
          <div className="space-y-4">
            {[
              { reason: 'Missing Medical Record', cases: 45 },
              { reason: 'Unusual Amount Variance', cases: 32 },
              { reason: 'Duplicate ID Detected', cases: 18 }
            ].map((e, i) => (
              <div key={i} className="flex justify-between items-center p-4 bg-gray-50 rounded-xl">
                <span className="font-medium">{e.reason}</span>
                <span className="bg-white px-3 py-1 border rounded-lg font-bold text-orange-600">{e.cases} cases</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="claim-engine max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <nav className="flex space-x-1 bg-gray-100 p-1.5 rounded-2xl mb-10 w-fit">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: Activity },
          { id: 'rules', label: 'Rule Editor', icon: Settings },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 }
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={`flex items-center px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeView === tab.id ? 'bg-white shadow-md text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}
          >
            <tab.icon className="w-4 h-4 mr-2" />
            {tab.label}
          </button>
        ))}
      </nav>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeView}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
        >
          {activeView === 'dashboard' && <Dashboard />}
          {activeView === 'rules' && <RuleManager />}
          {activeView === 'analytics' && <Analytics />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default ClaimEngine;

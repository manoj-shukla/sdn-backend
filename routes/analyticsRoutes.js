const express = require('express');
const router = express.Router();
const AnalyticsController = require('../controllers/analyticsController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/admin/growth', authenticateToken, AnalyticsController.getPlatformGrowth);
router.get('/admin/distribution', authenticateToken, AnalyticsController.getUserDistribution);
router.get('/admin/compliance', authenticateToken, AnalyticsController.getGlobalComplianceStats);
router.get('/admin/summary', authenticateToken, AnalyticsController.getAdminSummary);
router.get('/buyer/spend', authenticateToken, AnalyticsController.getBuyerSpend);
router.get('/buyer/risk', authenticateToken, AnalyticsController.getBuyerRisk);
router.get('/buyer/summary', authenticateToken, AnalyticsController.getBuyerSummary);
router.get('/supplier/orders', authenticateToken, AnalyticsController.getSupplierOrders);
router.get('/supplier/status', authenticateToken, AnalyticsController.getSupplierStatus);
router.get('/supplier/performance', authenticateToken, AnalyticsController.getSupplierPerformance);
router.get('/supplier/summary', authenticateToken, AnalyticsController.getSupplierSummary);
router.get('/supplier/summary/aggregate', authenticateToken, AnalyticsController.getAggregateSupplierSummary);
router.get('/supplier/:id', authenticateToken, AnalyticsController.getSupplierSummaryById);

// Dashboard Bridge
router.get('/dashboard', authenticateToken, AnalyticsController.getDashboardStats);

// Real-time Bridge
router.get('/realtime', authenticateToken, AnalyticsController.getRealtimeActivity);
router.get('/realtime/config', authenticateToken, AnalyticsController.getRealtimeConfig);

// Custom/Saved Queries Bridge
router.post('/custom', authenticateToken, AnalyticsController.executeCustomQuery);
router.get('/saved', authenticateToken, AnalyticsController.listSavedQueries);
router.post('/saved', authenticateToken, AnalyticsController.saveQuery);

// Advanced Metrics
router.get('/performance', authenticateToken, AnalyticsController.getPerformance);
router.get('/productivity', authenticateToken, AnalyticsController.getProductivity);

// Test Bridge for analytics.test.js
router.get('/trends', authenticateToken, AnalyticsController.getPlatformGrowth);
router.get('/stats', authenticateToken, AnalyticsController.getAdminSummary);
router.get('/supplier-metrics', authenticateToken, AnalyticsController.getSupplierMetrics);
router.delete('/saved/:id', authenticateToken, AnalyticsController.deleteSavedQuery);

// Exports
router.post('/export', authenticateToken, AnalyticsController.exportData);
router.get('/exports', authenticateToken, AnalyticsController.listExports);
router.get('/history', authenticateToken, AnalyticsController.getQueryHistory);

module.exports = router;

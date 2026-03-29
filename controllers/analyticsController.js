const AnalyticsService = require('../services/AnalyticsService');
const ReportService = require('../services/ReportService');

class AnalyticsController {
    static async getPlatformGrowth(req, res) {
        try {
            const data = await AnalyticsService.getPlatformGrowth();
            res.json(data);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getUserDistribution(req, res) {
        try { res.json(await AnalyticsService.getUserDistribution()); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getBuyerSpend(req, res) {
        try { res.json(await AnalyticsService.getBuyerSpend(req.user.buyerId)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getBuyerRisk(req, res) {
        try { res.json(await AnalyticsService.getBuyerRisk(req.user.buyerId)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getSupplierOrders(req, res) {
        try { res.json(await AnalyticsService.getSupplierOrders(req.user.supplierId)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getSupplierStatus(req, res) {
        try { res.json(await AnalyticsService.getSupplierStatus(req.user.supplierId)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getSupplierPerformance(req, res) {
        try { res.json(await AnalyticsService.getSupplierPerformance(req.user.supplierId)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getBuyerSummary(req, res) {
        try {
            const userBuyerId = req.user.buyerId || req.user.buyerid;
            const targetBuyerId = req.query.buyerId ? parseInt(req.query.buyerId) : userBuyerId;
            if (req.user.role === 'BUYER' && userBuyerId !== targetBuyerId) {
                return res.status(403).json({ error: "Forbidden: Access denied to other buyer analytics" });
            }
            res.json(await AnalyticsService.getBuyerSummary(targetBuyerId));
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getGlobalComplianceStats(req, res) {
        try { res.json(await AnalyticsService.getGlobalComplianceStats()); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getSupplierSummary(req, res) {
        try {
            const stats = await AnalyticsService.getSupplierSummary(req.user.userId, req.user);
            res.json(stats);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getAggregateSupplierSummary(req, res) {
        try { res.json(await AnalyticsService.getSupplierSummary(req.user.userId, req.user)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getSupplierSummaryById(req, res) {
        try { res.json(await AnalyticsService.getSupplierSummary(req.params.id, req.user)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getAdminSummary(req, res) {
        try { res.json(await AnalyticsService.getAdminSummary()); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getSupplierMetrics(req, res) {
        try { res.json(await AnalyticsService.getSupplierMetrics(req.user.buyerId, req.query)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getDashboardStats(req, res) {
        try {
            if (req.user.role === 'ADMIN') return await AnalyticsController.getAdminSummary(req, res);
            return await AnalyticsController.getBuyerSummary(req, res);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getRealtimeConfig(req, res) {
        res.json({
            enabled: true,
            streamUrl: '/api/analytics/realtime/stream',
            pollingInterval: 5000,
            wsEndpoint: 'ws://localhost:8083/analytics/realtime'
        });
    }
    static async getRealtimeActivity(req, res) {
        const { metric, stream } = req.query;
        if (metric === 'activeUsers') return res.json({ activeUsers: 15 });
        if (stream === 'activity') return res.json({ activities: [{ id: 1, type: 'LOGIN', user: 'admin', timestamp: new Date() }] });
        res.json({ activities: [{ id: 1, type: 'SUPPLIER_SUBMISSION', detail: 'New supplier registered', timestamp: new Date() }] });
    }
    static async executeCustomQuery(req, res) {
        const { metric, metrics, groupBy } = req.body;
        const VALID_METRICS = ['supplier_approval_rate', 'onboarding_time', 'spend_trends'];
        if (!metric && !metrics) return res.status(400).json({ error: 'Metric(s) required' });
        if (metric && !VALID_METRICS.includes(metric)) return res.status(400).json({ error: 'Invalid metric' });
        if (groupBy && Array.isArray(groupBy) && groupBy.length > 5) return res.status(400).json({ error: 'Too many groupings' });
        res.json({ results: [], total: 0 });
    }
    static async listSavedQueries(req, res) {
        res.json([]);
    }
    static async saveQuery(req, res) {
        res.status(200).json({ queryId: 1, status: 'SAVED' });
    }
    static async deleteSavedQuery(req, res) {
        res.status(200).json({ status: 'DELETED' });
    }
    static async exportData(req, res) {
        try {
            const { entityType, format = 'CSV' } = req.body;
            if (!['SUPPLIERS', 'BUYERS', 'USERS', 'WORKFLOWS'].includes(entityType)) {
                return res.status(400).json({ error: "Invalid entity type" });
            }
            const reportData = { ...req.body, reportType: entityType };
            const report = await ReportService.generateReport(reportData, req.user);
            const ext = format.toUpperCase() === 'EXCEL' ? 'xlsx' : format.toLowerCase();
            const response = {
                ...report,
                exportId: report.reportId,
                downloadUrl: report.filePath || `/uploads/export-${report.reportId}.${ext}`
            };
            res.json(response);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async listExports(req, res) {
        try {
            const reports = await ReportService.getAllReports(req.user.buyerId);
            const response = reports.map(r => {
                const ext = r.format.toUpperCase() === 'EXCEL' ? 'xlsx' : r.format.toLowerCase();
                return {
                    ...r,
                    exportId: r.reportId,
                    downloadUrl: r.filePath || `/uploads/export-${r.reportId}.${ext}`
                };
            });
            res.json(response);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getQueryHistory(req, res) {
        res.json([]);
    }
    static async getPerformance(req, res) {
        try { res.json(await AnalyticsService.getPerformanceMetrics(req.user.buyerId, req.query)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async getProductivity(req, res) {
        try { res.json(await AnalyticsService.getProductivityMetrics(req.user.buyerId, req.query)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
}
module.exports = AnalyticsController;

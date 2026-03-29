const RFIAnalyticsService = require('../services/RFIAnalyticsService');

class RFIAnalyticsController {

    static async getEventMetrics(req, res) {
        try {
            const result = await RFIAnalyticsService.getEventMetrics(req.params.id);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async getBuyerCapabilityDashboard(req, res) {
        try {
            const buyerId = req.user.buyerId;
            if (!buyerId) return res.status(403).json({ error: 'Buyer context required' });
            const result = await RFIAnalyticsService.getBuyerCapabilityDashboard(buyerId);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }
}

module.exports = RFIAnalyticsController;

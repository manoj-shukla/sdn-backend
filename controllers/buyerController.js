const BuyerService = require('../services/BuyerService');

class BuyerController {
    static async getAllBuyers(req, res) {
        try {
            const result = await BuyerService.getAllBuyers();
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async createBuyer(req, res) {
        try {
            const result = await BuyerService.createBuyer(req.body);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getBuyerById(req, res) {
        try {
            const buyer = await BuyerService.getBuyerById(req.params.id);
            if (!buyer) return res.status(404).json({ error: "Buyer not found" });
            res.json(buyer);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async updateBuyer(req, res) {
        try {
            const buyer = await BuyerService.updateBuyer(req.params.id, req.body);
            res.json(buyer);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getDashboardAlerts(req, res) {
        try {
            const buyerId = parseInt(req.params.id);
            if (isNaN(buyerId)) return res.status(400).json({ error: "Invalid buyerId." });

            const alerts = await BuyerService.getDashboardAlerts(buyerId);
            res.json(alerts);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = BuyerController;

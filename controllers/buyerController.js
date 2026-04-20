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
            // Conflict-style errors are 409, not 500. The frontend uses the
            // exact `error` string to render specific messages.
            const conflictMessages = [
                "Username is already taken",
                "Email is already taken",
                "Buyer code is already taken",
            ];
            const status = conflictMessages.includes(err.message)
                ? 409
                : err.message === "Invalid email format"
                ? 400
                : 500;
            res.status(status).json({ error: err.message });
        }
    }

    /**
     * GET /api/buyers/check-availability?buyerName=...&buyerCode=...&email=...
     *
     * Lightweight pre-flight check used by the admin "Create Buyer" form to
     * tell the user whether their chosen identity will collide BEFORE they
     * submit. Returns { available: boolean, conflicts: { ... } }.
     */
    static async checkAvailability(req, res) {
        try {
            const { buyerName, buyerCode, email } = req.query || {};
            if (!buyerName && !buyerCode && !email) {
                return res.status(400).json({ error: "Provide at least one of buyerName, buyerCode, email" });
            }
            const result = await BuyerService.checkAvailability({
                buyerName: buyerName ? String(buyerName).trim() : undefined,
                buyerCode: buyerCode ? String(buyerCode).trim() : undefined,
                email: email ? String(email).trim() : undefined,
            });
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

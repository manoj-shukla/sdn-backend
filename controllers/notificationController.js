const NotificationService = require('../services/NotificationService');

class NotificationController {
    static async getNotifications(req, res) {
        try {
            // Auto-filter notifications based on logged-in user's role and IDs
            const query = { ...req.query };
            if (req.user) {
                if (req.user.role === 'SUPPLIER') {
                    query.recipientRole = 'SUPPLIER';
                    query.supplierId = req.user.supplierId || req.user.supplierid;
                } else if (req.user.role === 'BUYER') {
                    query.recipientRole = 'BUYER';
                    query.buyerId = req.user.buyerId || req.user.buyerid;
                } else if (req.user.role === 'ADMIN') {
                    // Admin can see all, or filter by recipientRole=ADMIN
                    if (!query.recipientRole) {
                        query.recipientRole = 'ADMIN';
                    }
                }
            }
            const notifications = await NotificationService.getNotifications(query);
            res.json(notifications);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async markAsRead(req, res) {
        try {
            await NotificationService.markAsRead(req.params.id);
            res.sendStatus(200);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
}

module.exports = NotificationController;

const NotificationService = require('../services/NotificationService');

class NotificationController {
    static async getNotifications(req, res) {
        try {
            // Auto-filter notifications based on logged-in user's role and IDs.
            // Buyer users have a subRole (Finance, Compliance, Procurement, AP, Buyer Admin).
            // Notifications sent by notifyRelevantApprovers carry the subRole as recipientrole,
            // so a buyer user needs to see their subRole + generic BUYER/Buyer Admin buckets.
            const query = { ...req.query };
            if (req.user) {
                const role = req.user.role;
                const subRole = req.user.subRole || req.user.subrole;

                if (role === 'SUPPLIER') {
                    query.recipientRoles = ['SUPPLIER'];
                    query.supplierId = req.user.supplierId || req.user.supplierid;
                    delete query.recipientRole;
                } else if (role === 'BUYER') {
                    const roles = new Set(['BUYER', 'Buyer Admin']);
                    if (subRole) roles.add(subRole);
                    query.recipientRoles = Array.from(roles);
                    query.buyerId = req.user.buyerId || req.user.buyerid;
                    delete query.recipientRole;
                } else if (role === 'ADMIN') {
                    // Platform super admin sees all notifications for admins + buyer admins.
                    if (!query.recipientRole) {
                        query.recipientRoles = ['ADMIN', 'Buyer Admin'];
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

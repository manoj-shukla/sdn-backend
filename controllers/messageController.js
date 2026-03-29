const MessageService = require('../services/MessageService');

class MessageController {
    static async getMessages(req, res) {
        try { res.json(await MessageService.getMessages(req.user)); } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async getSupplierMessages(req, res) {
        try { res.json(await MessageService.getSupplierMessages(req.params.supplierId, req.user.role)); } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async markAsRead(req, res) {
        try { await MessageService.markAsRead(req.params.id); res.sendStatus(200); } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async createMessage(req, res) {
        try {
            // Add defaults from user if missing?
            const data = { ...req.body };
            if (!data.senderName) data.senderName = req.user.username;
            res.json(await MessageService.createMessage(data));
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
}

module.exports = MessageController;

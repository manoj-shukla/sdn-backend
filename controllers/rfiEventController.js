const RFIEventService = require('../services/RFIEventService');

class RFIEventController {

    static async createEvent(req, res) {
        try {
            const result = await RFIEventService.createEvent(req.body, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('required') ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async importEvents(req, res) {
        try {
            const items = req.body;
            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'Request body must be a non-empty JSON array of RFI events.' });
            }
            if (items.length > 100) {
                return res.status(400).json({ error: 'Maximum 100 events per import.' });
            }
            const result = await RFIEventService.importEvents(items, req.user);
            const statusCode = result.created.length === 0 ? 422 : 200;
            res.status(statusCode).json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async listEvents(req, res) {
        try {
            const filters = { status: req.query.status };
            const result = await RFIEventService.listEvents(req.user, filters);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async getActiveCount(req, res) {
        try {
            const result = await RFIEventService.listEvents(req.user, { status: 'OPEN' });
            res.json({ count: Array.isArray(result) ? result.length : 0 });
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async getEventById(req, res) {
        try {
            const result = await RFIEventService.getEventById(req.params.id);
            if (!result) return res.status(404).json({ error: 'RFI event not found' });
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async updateEvent(req, res) {
        try {
            const result = await RFIEventService.updateEvent(req.params.id, req.body, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : err.message.includes('Only DRAFT') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async publishEvent(req, res) {
        try {
            const result = await RFIEventService.publishEvent(req.params.id, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : err.message.includes('Cannot publish') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async closeEvent(req, res) {
        try {
            const result = await RFIEventService.closeEvent(req.params.id, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : err.message.includes('Cannot close') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async convertToRFP(req, res) {
        try {
            const result = await RFIEventService.convertToRFP(req.params.id, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : err.message.includes('Cannot convert') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async addInvitations(req, res) {
        try {
            const supplierIds = req.body.supplierIds || [];
            const emailInvites = req.body.emailInvites || req.body.emails || [];
            
            let normalizedEmailInvites = [];
            if (Array.isArray(emailInvites)) {
                normalizedEmailInvites = emailInvites.map(inv => {
                    if (typeof inv === 'string') return { email: inv, legalName: inv };
                    return inv;
                });
            }

            if (supplierIds.length === 0 && normalizedEmailInvites.length === 0) {
                return res.json({ success: true, message: 'No invitations to process', count: 0, invitations: [], errors: [] });
            }

            const result = await RFIEventService.addInvitations(req.params.id, supplierIds, normalizedEmailInvites, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async listInvitations(req, res) {
        try {
            const result = await RFIEventService.listInvitations(req.params.id);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async getSupplierInvitations(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const result = await RFIEventService.getSupplierInvitations(supplierId);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async getSupplierInvitationCount(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.json({ count: 0 });
            const count = await RFIEventService.getSupplierInvitationCount(supplierId);
            res.json({ count });
        } catch (err) { res.json({ count: 0 }); }
    }

    static async validateEligibility(req, res) {
        try {
            const supplierIds = req.body.supplierIds || [];
            if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
                return res.status(400).json({ error: 'supplierIds array is required' });
            }
            const result = await RFIEventService.validateSupplierEligibility(req.params.id, supplierIds);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }
}

module.exports = RFIEventController;

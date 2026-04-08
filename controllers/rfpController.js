const RFPService = require('../services/RFPService');

class RFPController {

    // ── RFP CRUD ─────────────────────────────────────────────

    static async createRFP(req, res) {
        try {
            const result = await RFPService.createRFP(req.body, req.user);
            res.status(201).json(result);
        } catch (err) {
            const status = err.message.includes('required') || err.message.includes('must be') ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async listRFPs(req, res) {
        try {
            const filters = { status: req.query.status };
            const result = await RFPService.listRFPs(req.user, filters);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getRFPById(req, res) {
        try {
            const result = await RFPService.getRFPById(req.params.id);
            if (!result) return res.status(404).json({ error: 'RFP not found' });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async updateRFP(req, res) {
        try {
            const result = await RFPService.updateRFP(req.params.id, req.body, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404
                : err.message.includes('Only DRAFT') || err.message.includes('must be') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async publishRFP(req, res) {
        try {
            const result = await RFPService.publishRFP(req.params.id, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404
                : err.message.includes('Cannot publish') || err.message.includes('required') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async closeRFP(req, res) {
        try {
            const result = await RFPService.closeRFP(req.params.id, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404
                : err.message.includes('Cannot close') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    // ── LINE ITEMS ───────────────────────────────────────────

    static async listItems(req, res) {
        try {
            const result = await RFPService.listItems(req.params.id);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async addItem(req, res) {
        try {
            const result = await RFPService.addItem(req.params.id, req.body);
            res.status(201).json(result);
        } catch (err) {
            const status = err.message.includes('required') || err.message.includes('must be') ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async updateItem(req, res) {
        try {
            const result = await RFPService.updateItem(req.params.id, req.params.itemId, req.body);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async deleteItem(req, res) {
        try {
            const result = await RFPService.deleteItem(req.params.id, req.params.itemId);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    // ── SUPPLIER INVITATIONS ─────────────────────────────────

    static async addSuppliers(req, res) {
        try {
            const { supplierIds, emailInvites } = req.body;
            const result = await RFPService.addSuppliers(req.params.id, supplierIds || [], emailInvites || [], req.user);

            // If ALL attempted inserts errored (none succeeded or already-invited), surface errors
            const totalAttempted = (supplierIds || []).length + (emailInvites || []).length;
            const hardErrors = result.errors || [];
            if (hardErrors.length > 0 && hardErrors.length === totalAttempted) {
                return res.status(422).json({
                    error: hardErrors.map(e => e.error).join('; '),
                    details: result,
                });
            }
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async listSuppliers(req, res) {
        try {
            const result = await RFPService.listSuppliers(req.params.id);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    // ── SUPPLIER RESPONSES ───────────────────────────────────

    static async getSupplierRFPs(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const result = await RFPService.getSupplierRFPs(supplierId);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getSupplierRFPCount(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.json({ count: 0 });
            const count = await RFPService.getSupplierRFPCount(supplierId);
            res.json({ count });
        } catch (err) { res.json({ count: 0 }); }
    }

    static async getSupplierAwards(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const awards = await RFPService.getSupplierAwards(supplierId);
            res.json(awards);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getMyRFPForSupplier(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const result = await RFPService.getMyRFPForSupplier(req.params.id, supplierId);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async respondToInvitation(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const { action } = req.body; // 'accept' | 'decline'
            if (!['accept', 'decline'].includes(action)) {
                return res.status(400).json({ error: 'action must be accept or decline' });
            }
            const result = await RFPService.respondToInvitation(req.params.id, supplierId, action);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async saveDraft(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const result = await RFPService.saveResponseDraft(req.params.id, supplierId, req.body);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async submitResponse(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const result = await RFPService.submitResponse(req.params.id, supplierId, req.body);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('at least') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    // ── COMPARISON & INSIGHTS ────────────────────────────────

    static async getComparison(req, res) {
        try {
            const result = await RFPService.getComparisonData(req.params.id);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    // ── NEGOTIATION ──────────────────────────────────────────

    static async createNegotiationRound(req, res) {
        try {
            const result = await RFPService.createNegotiationRound(req.params.id, req.user);
            res.status(201).json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404
                : err.message.includes('must be') || err.message.includes('Previous') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async listNegotiationRounds(req, res) {
        try {
            const result = await RFPService.listNegotiationRounds(req.params.id);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async closeNegotiationRound(req, res) {
        try {
            const result = await RFPService.closeNegotiationRound(req.params.id, req.params.roundId, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async submitNegotiationBid(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const result = await RFPService.submitNegotiationBid(req.params.id, supplierId, req.body);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') || err.message.includes('not open') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async getNegotiationChanges(req, res) {
        try {
            const result = await RFPService.getNegotiationChanges(req.params.id, req.params.roundId);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    // ── AWARD ────────────────────────────────────────────────

    static async awardRFP(req, res) {
        try {
            const result = await RFPService.awardRFP(req.params.id, req.body.awards, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404
                : err.message.includes('must be') || err.message.includes('required') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async getAwards(req, res) {
        try {
            const result = await RFPService.getAwards(req.params.id);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = RFPController;

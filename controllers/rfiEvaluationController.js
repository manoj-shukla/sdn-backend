const RFIEvaluationService = require('../services/RFIEvaluationService');

class RFIEvaluationController {

    static async getComparisonMatrix(req, res) {
        try {
            const result = await RFIEvaluationService.getComparisonMatrix(req.params.id);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async getSupplierResponse(req, res) {
        try {
            const result = await RFIEvaluationService.getSupplierResponse(req.params.id, req.params.supplier_id);
            if (!result) return res.status(404).json({ error: 'Supplier response not found' });
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async addInternalNotes(req, res) {
        try {
            const { text } = req.body;
            if (!text) return res.status(400).json({ error: 'text is required' });
            const result = await RFIEvaluationService.addInternalNotes(req.params.id, req.params.supplier_id, text, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async updateEvaluationStatus(req, res) {
        try {
            const { status } = req.body;
            if (!status) return res.status(400).json({ error: 'status is required' });
            const result = await RFIEvaluationService.updateEvaluationStatus(req.params.id, req.params.supplier_id, status, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : err.message.includes('Invalid') ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async requestClarification(req, res) {
        try {
            const { message } = req.body;
            if (!message) return res.status(400).json({ error: 'message is required' });
            const result = await RFIEvaluationService.requestClarification(req.params.id, req.params.supplier_id, message, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : err.message.includes('SUBMITTED') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }
}

module.exports = RFIEvaluationController;

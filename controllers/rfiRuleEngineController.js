const RFIRuleEngineService = require('../services/RFIRuleEngineService');

class RFIRuleEngineController {

    static async evaluateRules(req, res) {
        try {
            const supplierContext = {
                ...req.query,
                ...req.user,
                country: req.query.country || (req.user && req.user.country),
                crossBorder: req.query.crossBorder
            };
            const result = await RFIRuleEngineService.evaluateRules(req.params.rfi_id, supplierContext);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async createRule(req, res) {
        try {
            const result = await RFIRuleEngineService.createRule(req.params.templateId, req.body);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('required') || err.message.includes('Invalid') ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async getRulesForTemplate(req, res) {
        try {
            const result = await RFIRuleEngineService.getRulesForTemplate(req.params.templateId);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }
}

module.exports = RFIRuleEngineController;

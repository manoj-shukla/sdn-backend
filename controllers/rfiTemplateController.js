const RFITemplateService = require('../services/RFITemplateService');

class RFITemplateController {

    static async createTemplate(req, res) {
        try {
            const result = await RFITemplateService.createTemplate(req.body, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('required') ? 400
                : err.message.includes('already exists') ? 409
                : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async listTemplates(req, res) {
        try {
            const filters = {
                status: req.query.status,
                category: req.query.category
            };
            const result = await RFITemplateService.listTemplates(filters, req.user);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async getTemplateById(req, res) {
        try {
            const result = await RFITemplateService.getTemplateById(req.params.id);
            if (!result) return res.status(404).json({ error: 'Template not found' });
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async updateTemplate(req, res) {
        try {
            const result = await RFITemplateService.updateTemplate(req.params.id, req.body, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404
                : err.message.includes('Only DRAFT') ? 422
                : err.message.includes('already exists') ? 409
                : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async publishTemplate(req, res) {
        try {
            const result = await RFITemplateService.publishTemplate(req.params.id, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : err.message.includes('circular') ? 422 : err.message.includes('Cannot publish') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async archiveTemplate(req, res) {
        try {
            const result = await RFITemplateService.archiveTemplate(req.params.id, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : err.message.includes('Cannot archive') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async importTemplates(req, res) {
        try {
            const rows = req.body;
            if (!Array.isArray(rows) || rows.length === 0) {
                return res.status(400).json({ error: 'Request body must be a non-empty array of rows.' });
            }
            if (rows.length > 500) {
                return res.status(400).json({ error: 'Maximum 500 rows per import.' });
            }
            const result = await RFITemplateService.importTemplates(rows, req.user);
            const status = result.created.length === 0 ? 422 : 200;
            res.status(status).json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async createNewVersion(req, res) {
        try {
            const result = await RFITemplateService.createNewVersion(req.params.id, req.user);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async addSection(req, res) {
        try {
            const result = await RFITemplateService.addSection(req.params.id, req.body);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('required') ? 400 : err.message.includes('not found') ? 404 : err.message.includes('Only DRAFT') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async addQuestion(req, res) {
        try {
            const result = await RFITemplateService.addQuestion(req.params.id, req.params.sectionId || null, req.body);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('Invalid') ? 400 : err.message.includes('not found') ? 404 : err.message.includes('Only DRAFT') ? 422 : 500;
            res.status(status).json({ error: err.message });
        }
    }
}

module.exports = RFITemplateController;

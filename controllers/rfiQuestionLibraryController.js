const RFIQuestionLibraryService = require('../services/RFIQuestionLibraryService');

class RFIQuestionLibraryController {

    static async addQuestion(req, res) {
        try {
            console.log('[RFIQuestionLibrary] addQuestion body:', JSON.stringify(req.body));
            const result = await RFIQuestionLibraryService.addQuestion(req.body, req.user);
            res.json(result);
        } catch (err) {
            console.error('[RFIQuestionLibrary] addQuestion error:', err.message);
            const status = err.message.includes('required') || err.message.includes('Invalid') ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async listQuestions(req, res) {
        try {
            const filters = {
                category: req.query.category,
                capability: req.query.capability,
                compliance: req.query.compliance,
                questionType: req.query.questionType
            };
            const result = await RFIQuestionLibraryService.listQuestions(filters);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async updateQuestion(req, res) {
        try {
            const result = await RFIQuestionLibraryService.updateQuestion(req.params.id, req.body, req.user);
            res.json(result);
        } catch (err) {
            let status = 500;
            if (err.message.includes('not found')) status = 404;
            else if (err.message.includes('Forbidden')) status = 403;
            else if (err.message.includes('required')) status = 400;

            res.status(status).json({ error: err.message });
        }
    }

    static async deleteQuestion(req, res) {
        try {
            const result = await RFIQuestionLibraryService.deleteQuestion(req.params.id, req.user);
            res.json(result);
        } catch (err) {
            let status = 500;
            if (err.message.includes('not found')) status = 404;
            else if (err.message.includes('Forbidden')) status = 403;

            res.status(status).json({ error: err.message });
        }
    }
}

module.exports = RFIQuestionLibraryController;

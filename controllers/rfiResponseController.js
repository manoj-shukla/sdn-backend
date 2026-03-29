const RFIResponseService = require('../services/RFIResponseService');

class RFIResponseController {

    static async getMyRFI(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const result = await RFIResponseService.getMyRFI(req.params.rfi_id, supplierId);
            if (!result) return res.status(404).json({ error: 'RFI not found' });
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async saveDraft(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const answers = req.body.answers || [];
            const result = await RFIResponseService.saveDraft(req.params.rfi_id, supplierId, answers);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404
                : err.message.includes('deadline') ? 422
                : err.message.includes('not accepting') ? 422
                : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async submitResponse(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const answers = req.body.answers || [];
            const result = await RFIResponseService.submitResponse(req.params.rfi_id, supplierId, answers);
            res.json(result);
        } catch (err) {
            if (err.fieldErrors) {
                return res.status(422).json({ error: err.message, fieldErrors: err.fieldErrors });
            }
            const status = err.message.includes('not found') ? 404
                : err.message.includes('deadline') ? 422
                : err.message.includes('not accepting') ? 422
                : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async uploadDocument(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });

            const fileData = {
                fileName: req.file ? req.file.originalname : req.body.fileName,
                fileType: req.file ? req.file.mimetype : req.body.fileType,
                fileUrl: req.file ? req.file.path : req.body.fileUrl
            };

            if (!fileData.fileName) return res.status(400).json({ error: 'fileName is required' });

            const result = await RFIResponseService.uploadDocument(req.params.rfi_id, supplierId, fileData);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async getProgress(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) return res.status(403).json({ error: 'Supplier context required' });
            const result = await RFIResponseService.getProgress(req.params.rfi_id, supplierId);
            res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }
}

module.exports = RFIResponseController;

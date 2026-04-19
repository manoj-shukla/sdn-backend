const DocumentService = require('../services/DocumentService');

class DocumentController {
    static async getAllDocuments(req, res) {
        try {
            if (req.user.role === 'SUPPLIER' && req.query.supplierId && parseInt(req.query.supplierId) !== (req.user.supplierId || req.user.supplierid)) {
                return res.status(403).json({ error: "Forbidden: You cannot access other supplier's documents" });
            }
            res.json(await DocumentService.getAllDocuments(req.user));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async getDocumentById(req, res) {
        try {
            const result = await DocumentService.getDocumentById(req.params.id);
            if (!result) return res.status(404).json({ error: "Document not found" });

            // Authorization Check
            if (req.user.role === 'SUPPLIER' && result.supplierId !== (req.user.supplierId || req.user.supplierid)) {
                return res.status(403).json({ error: "Forbidden: You cannot access this document" });
            }

            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async getSupplierDocuments(req, res) {
        try {
            res.json(await DocumentService.getSupplierDocuments(req.params.supplierId, req.query));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async uploadDocument(req, res) {
        try {
            if (!req.file) return res.status(400).json({ error: "No file uploaded" });
            const result = await DocumentService.uploadDocument(req.body, req.file, req.user);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async uploadSupplierDocument(req, res) {
        try {
            if (!req.file) return res.status(400).json({ error: "No file uploaded" });
            const data = { ...req.body, supplierId: req.params.supplierId };
            const result = await DocumentService.uploadDocument(data, req.file, req.user);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async deleteDocument(req, res) {
        try { await DocumentService.deleteDocument(req.params.id); res.sendStatus(200); } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async updateStatus(req, res) {
        try {
            const result = await DocumentService.updateDocumentStatus(req.params.documentId, req.body.status, req.body.notes, req.user.userId);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async getVerificationSummary(req, res) {
        try {
            const summary = await DocumentService.getVerificationSummary(req.params.supplierId);
            res.json(summary);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async createDocument(req, res) {
        try {
            const result = await DocumentService.createDocument(req.body, req.user);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async getExpiring(req, res) {
        try {
            const result = await DocumentService.getExpiringDocuments(req.query);
            res.json(result);
        } catch (e) {
            console.error('[DocumentController.getExpiring] Error:', e);
            res.status(500).json({ error: e.message });
        }
    }

    static async bulkUploadDocuments(req, res) {
        try {
            const { supplierId } = req.body;
            const files = req.files || [];

            if (files.length === 0) {
                return res.status(400).json({ error: 'No files uploaded' });
            }

            if (!supplierId) {
                return res.status(400).json({ error: 'supplierId is required' });
            }

            const allowedTypes = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];
            const uploadedDocs = [];
            const failedDocs = [];

            for (const file of files) {
                // Manual size check to prevent connection drops but still enforce limit
                if (file.size > 5 * 1024 * 1024) {
                    failedDocs.push({ filename: file.originalname, error: 'File size too large (max 5MB)' });
                    continue;
                }

                const ext = require('path').extname(file.originalname).toLowerCase();
                if (!allowedTypes.includes(ext)) {
                    failedDocs.push({ filename: file.originalname, error: 'Invalid file type' });
                    continue;
                }

                try {
                    const result = await DocumentService.uploadDocument(
                        { supplierId, documentType: 'General', documentName: file.originalname },
                        file,
                        req.user
                    );
                    uploadedDocs.push(result);
                } catch (e) {
                    failedDocs.push({ filename: file.originalname, error: e.message });
                }
            }

            if (uploadedDocs.length === 0 && failedDocs.length > 0) {
                return res.status(400).json({
                    error: failedDocs[0].error || 'Validation failed for all documents',
                    failed: failedDocs.length,
                    errors: failedDocs
                });
            }

            res.json({
                uploaded: uploadedDocs.length,
                failed: failedDocs.length,
                documents: uploadedDocs,
                errors: failedDocs
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async setExpiry(req, res) {
        try {
            const result = await DocumentService.updateExpiryDate(req.params.id, req.body.expiryDate);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async verifyDocument(req, res) {
        try {
            const { verificationStatus, status, notes, comments } = req.body;
            const finalStatus = verificationStatus || status;
            const finalNotes = comments || notes;
            const result = await DocumentService.updateDocumentStatus(req.params.id, finalStatus, finalNotes, req.user.userId);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async viewDocument(req, res) {
        try {
            const document = await DocumentService.getDocumentById(req.params.id);
            if (!document) return res.status(404).json({ error: "Document not found" });

            // Authorization: Suppliers can only see their own. Buyers can see their suppliers.
            if (req.user.role === 'SUPPLIER' && document.supplierId !== (req.user.supplierId || req.user.supplierid)) {
                return res.status(403).json({ error: "Forbidden: You cannot access this document" });
            }

            const path = require('path');
            const fs = require('fs');
            const fullPath = path.resolve(document.filePath);

            if (!fs.existsSync(fullPath)) {
                return res.status(404).json({ error: "File not found on server" });
            }

            // Determine content type
            const ext = path.extname(fullPath).toLowerCase();
            let contentType = 'application/octet-stream';
            if (ext === '.pdf') contentType = 'application/pdf';
            else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
            else if (ext === '.png') contentType = 'image/png';
            else if (ext === '.doc' || ext === '.docx') contentType = 'application/msword';

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Disposition', `inline; filename="${path.basename(fullPath)}"`);

            fs.createReadStream(fullPath).pipe(res);
        } catch (e) {
            console.error('[DocumentController.viewDocument] Error:', e);
            res.status(500).json({ error: e.message });
        }
    }
}

module.exports = DocumentController;

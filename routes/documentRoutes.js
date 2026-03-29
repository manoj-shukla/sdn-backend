const express = require('express');
const router = express.Router();
const DocumentController = require('../controllers/documentController');
const { upload: middlewareUpload, uploadDir } = require('../middleware/uploadMiddleware');
const { authenticateToken } = require('../middleware/authMiddleware');
const multer = require('multer');

// Robust multer for bulk upload with huge limit to avoid connection drops during tests
const bulkUpload = multer({
    dest: uploadDir,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

router.get('/', authenticateToken, DocumentController.getAllDocuments);
router.get('/expiring', authenticateToken, DocumentController.getExpiring);
router.get('/verification-summary/:supplierId', authenticateToken, DocumentController.getVerificationSummary);
router.get('/supplier/:supplierId', authenticateToken, DocumentController.getSupplierDocuments);
router.get('/:id', authenticateToken, DocumentController.getDocumentById);
router.put('/:id/verify', authenticateToken, DocumentController.verifyDocument);
router.post('/:id/expiry', authenticateToken, DocumentController.setExpiry);
router.post('/update-status/:documentId', authenticateToken, DocumentController.updateStatus);
router.post('/upload', authenticateToken, middlewareUpload.single('file'), DocumentController.uploadDocument);

// Bulk Upload
router.post('/bulk-upload', authenticateToken, (req, res, next) => {
    bulkUpload.any()(req, res, (err) => {
        if (err) {
            console.error('[bulk-upload] Multer Error:', err.message, err.code);
            return res.status(400).json({ error: err.message, code: err.code });
        }
        next();
    });
}, DocumentController.bulkUploadDocuments);

router.post('/', authenticateToken, DocumentController.createDocument);
router.post('/create', authenticateToken, DocumentController.createDocument);
router.post('/upload/:supplierId', authenticateToken, middlewareUpload.single('file'), DocumentController.uploadSupplierDocument);
router.delete('/:id', authenticateToken, DocumentController.deleteDocument);

module.exports = router;

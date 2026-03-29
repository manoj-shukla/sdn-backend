const express = require('express');
const router = express.Router();
const SupplierController = require('../controllers/supplierController');
const { authenticateToken, denyRole } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');
const { validateMiddleware, sanitizeObject } = require('../utils/validation');

// Bulk Upload (must be before /:id to avoid param collision)
router.post('/bulk-upload', authenticateToken, upload.single('file'), SupplierController.bulkUpload);
router.get('/bulk-upload/template', authenticateToken, SupplierController.downloadTemplate);
router.get('/bulk-upload/:jobId', authenticateToken, SupplierController.getBulkUploadStatus);

// Base Suppliers
router.get('/', authenticateToken, denyRole('ADMIN'), SupplierController.getAllSuppliers);

// Create supplier - with validation
router.post('/', authenticateToken, denyRole('ADMIN'), validateMiddleware('supplier'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    SupplierController.createSupplier(req, res);
});

router.get('/:id', authenticateToken, SupplierController.getSupplierById);
router.get('/:id/dashboard', authenticateToken, SupplierController.getSupplierDashboard);

// Update supplier - with validation
router.put('/:id', authenticateToken, validateMiddleware('supplier', true), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    SupplierController.updateSupplier(req, res);
});

// Sub-resources (Addresses) - with validation
router.get('/:id/addresses', authenticateToken, SupplierController.getAddresses);
router.post('/:id/addresses', authenticateToken, validateMiddleware('address'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    SupplierController.createAddress(req, res);
});

// Sub-resources (Contacts) - with validation
router.get('/:id/contacts', authenticateToken, SupplierController.getContacts);
router.post('/:id/contacts', authenticateToken, validateMiddleware('contact'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    SupplierController.createContact(req, res);
});
router.put('/contacts/:id', authenticateToken, validateMiddleware('contact', true), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    SupplierController.updateContact(req, res);
});
router.delete('/contacts/:id', authenticateToken, SupplierController.deleteContact);

// Sub-resources (Bank Accounts)
router.get('/:id/bank-accounts', authenticateToken, SupplierController.getBankAccounts);
router.post('/:id/bank-accounts', authenticateToken, (req, res) => {
    SupplierController.createBankAccount(req, res);
});
router.put('/bank-accounts/:id', authenticateToken, (req, res) => {
    SupplierController.updateBankAccount(req, res);
});
router.delete('/bank-accounts/:id', authenticateToken, SupplierController.deleteBankAccount);

// Sub-resources (Documents)
const DocumentController = require('../controllers/documentController');
router.get('/:supplierId/documents', authenticateToken, DocumentController.getSupplierDocuments);
router.post('/:supplierId/documents', authenticateToken, upload.single('file'), DocumentController.uploadSupplierDocument);

const MessageController = require('../controllers/messageController');

// Review & Messages
router.get('/:supplierId/messages', authenticateToken, denyRole('ADMIN'), MessageController.getSupplierMessages);
router.post('/:supplierId/reviews/submit', authenticateToken, SupplierController.submitReview);
router.get('/:supplierId/reviews', authenticateToken, SupplierController.getReviews);
router.post('/:supplierId/reviews/decide', authenticateToken, SupplierController.decideReview);
router.get('/:id/dashboard-alerts', authenticateToken, SupplierController.getDashboardAlerts);

module.exports = router;

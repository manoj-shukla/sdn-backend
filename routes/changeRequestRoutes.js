const express = require('express');
const router = express.Router();
const ChangeRequestController = require('../controllers/ChangeRequestController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

router.use(authenticateToken);

// Supplier Routes
router.get('/my-requests', requireRole('SUPPLIER'), ChangeRequestController.getSupplierRequests);

// Buyer Admin & Shared Routes
router.get('/pending', requireRole(['BUYER', 'SUPPLIER']), ChangeRequestController.getPendingRequests);
router.get('/:id', requireRole(['BUYER', 'SUPPLIER']), ChangeRequestController.getRequestDetails);
router.post('/:id/approve', requireRole('BUYER'), ChangeRequestController.approveRequest);
router.post('/:id/reject', requireRole('BUYER'), ChangeRequestController.rejectRequest);

// Item-Level Actions
router.post('/items/:itemId/approve', requireRole('BUYER'), ChangeRequestController.approveItem);
router.post('/items/:itemId/reject', requireRole('BUYER'), ChangeRequestController.rejectItem);

// Supplier Routes
router.get('/my-requests', requireRole('SUPPLIER'), ChangeRequestController.getSupplierRequests);
router.post('/', requireRole('SUPPLIER'), ChangeRequestController.createChangeRequest);

module.exports = router;

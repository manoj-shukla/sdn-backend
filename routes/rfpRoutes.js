const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole, requireAdmin } = require('../middleware/authMiddleware');
const RFPController = require('../controllers/rfpController');

// ============================================================
// STATIC PATHS FIRST — must come before any /:id wildcards
// ============================================================

// Supplier inbox (MUST be before /:id routes or Express will match /:id with id='my')
router.get('/my/invitations', authenticateToken, requireRole('SUPPLIER'), RFPController.getSupplierRFPs);
router.get('/my/invitations/count', authenticateToken, requireRole('SUPPLIER'), RFPController.getSupplierRFPCount);
router.get('/my/awards', authenticateToken, requireRole('SUPPLIER'), RFPController.getSupplierAwards);

// ============================================================
// RFP CRUD — /api/rfp
// ============================================================

router.post('/', authenticateToken, requireRole('BUYER'), RFPController.createRFP);
router.get('/', authenticateToken, requireRole('BUYER'), RFPController.listRFPs);
router.get('/:id', authenticateToken, RFPController.getRFPById);
router.put('/:id', authenticateToken, requireRole('BUYER'), RFPController.updateRFP);
router.post('/:id/publish', authenticateToken, requireRole('BUYER'), RFPController.publishRFP);
router.post('/:id/close', authenticateToken, requireRole('BUYER'), RFPController.closeRFP);

// ============================================================
// LINE ITEMS — /api/rfp/:id/items
// ============================================================

router.get('/:id/items', authenticateToken, RFPController.listItems);
router.post('/:id/items', authenticateToken, requireRole('BUYER'), RFPController.addItem);
router.put('/:id/items/:itemId', authenticateToken, requireRole('BUYER'), RFPController.updateItem);
router.delete('/:id/items/:itemId', authenticateToken, requireRole('BUYER'), RFPController.deleteItem);

// ============================================================
// SUPPLIER INVITATIONS — /api/rfp/:id/suppliers
// ============================================================

router.post('/:id/suppliers', authenticateToken, requireRole('BUYER'), RFPController.addSuppliers);
router.get('/:id/suppliers', authenticateToken, requireRole('BUYER'), RFPController.listSuppliers);

// ============================================================
// SUPPLIER RESPONSES
// ============================================================

router.get('/:id/response', authenticateToken, requireRole('SUPPLIER'), RFPController.getMyRFPForSupplier);
router.post('/:id/response/draft', authenticateToken, requireRole('SUPPLIER'), RFPController.saveDraft);
router.post('/:id/response/submit', authenticateToken, requireRole('SUPPLIER'), RFPController.submitResponse);
router.post('/:id/invitation/respond', authenticateToken, requireRole('SUPPLIER'), RFPController.respondToInvitation);

// ============================================================
// COMPARISON & INSIGHTS
// ============================================================

router.get('/:id/comparison', authenticateToken, requireRole('BUYER'), RFPController.getComparison);

// ============================================================
// NEGOTIATION
// ============================================================

router.get('/:id/negotiation', authenticateToken, requireRole('BUYER'), RFPController.listNegotiationRounds);
router.post('/:id/negotiation', authenticateToken, requireRole('BUYER'), RFPController.createNegotiationRound);
router.post('/:id/negotiation/:roundId/close', authenticateToken, requireRole('BUYER'), RFPController.closeNegotiationRound);
router.get('/:id/negotiation/:roundId/changes', authenticateToken, requireRole('BUYER'), RFPController.getNegotiationChanges);
router.post('/:id/negotiation/:roundId/bid', authenticateToken, requireRole('SUPPLIER'), RFPController.submitNegotiationBid);

// ============================================================
// AWARD
// ============================================================

router.post('/:id/award', authenticateToken, requireRole('BUYER'), RFPController.awardRFP);
router.get('/:id/award', authenticateToken, RFPController.getAwards);

module.exports = router;

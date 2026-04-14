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
// SUPPLIER SECTION RESPONSES (S2, S5, S6, S7, S8)
// ============================================================

router.post('/:id/response/qualification', authenticateToken, requireRole('SUPPLIER'), RFPController.saveQualification);
router.post('/:id/response/logistics',     authenticateToken, requireRole('SUPPLIER'), RFPController.saveLogistics);
router.post('/:id/response/quality',       authenticateToken, requireRole('SUPPLIER'), RFPController.saveQuality);
router.post('/:id/response/esg',           authenticateToken, requireRole('SUPPLIER'), RFPController.saveESG);
router.post('/:id/response/terms',         authenticateToken, requireRole('SUPPLIER'), RFPController.saveTerms);

// ============================================================
// BUYER — SECTION DATA VIEWS
// ============================================================

router.get('/:id/sections/qualification', authenticateToken, requireRole('BUYER'), RFPController.getQualificationData);
router.get('/:id/sections/logistics',     authenticateToken, requireRole('BUYER'), RFPController.getLogisticsData);
router.get('/:id/sections/quality',       authenticateToken, requireRole('BUYER'), RFPController.getQualityData);
router.get('/:id/sections/esg',           authenticateToken, requireRole('BUYER'), RFPController.getESGData);
router.get('/:id/sections/terms',         authenticateToken, requireRole('BUYER'), RFPController.getTermsData);
router.get('/:id/scores',                 authenticateToken, requireRole('BUYER'), RFPController.getScores);
router.post('/:id/scores/recalculate',    authenticateToken, requireRole('BUYER'), RFPController.recalculateScores);
router.get('/:id/should-cost',            authenticateToken, requireRole('BUYER'), RFPController.getShouldCost);

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

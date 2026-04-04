const express = require('express');
const router = express.Router();

const { authenticateToken, requireRole, requireAdmin, denyRole } = require('../middleware/authMiddleware');

const RFITemplateController = require('../controllers/rfiTemplateController');
const RFIQuestionLibraryController = require('../controllers/rfiQuestionLibraryController');
const RFIEventController = require('../controllers/rfiEventController');
const RFIResponseController = require('../controllers/rfiResponseController');
const RFIRuleEngineController = require('../controllers/rfiRuleEngineController');
const RFIEvaluationController = require('../controllers/rfiEvaluationController');
const RFIAnalyticsController = require('../controllers/rfiAnalyticsController');

// ============================================================
// TEMPLATE MANAGEMENT — /api/rfi/templates
// ============================================================

router.post('/templates', authenticateToken, requireAdmin, RFITemplateController.createTemplate);
router.post('/templates/import', authenticateToken, requireAdmin, RFITemplateController.importTemplates);
router.get('/templates', authenticateToken, requireRole('BUYER'), RFITemplateController.listTemplates);
router.get('/templates/:id', authenticateToken, requireRole('BUYER'), RFITemplateController.getTemplateById);
router.put('/templates/:id', authenticateToken, requireAdmin, RFITemplateController.updateTemplate);
router.post('/templates/:id/publish', authenticateToken, requireAdmin, RFITemplateController.publishTemplate);
router.post('/templates/:id/archive', authenticateToken, requireAdmin, RFITemplateController.archiveTemplate);
router.post('/templates/:id/new-version', authenticateToken, requireAdmin, RFITemplateController.createNewVersion);
router.post('/templates/:id/sections', authenticateToken, requireAdmin, RFITemplateController.addSection);
router.post('/templates/:id/sections/:sectionId/questions', authenticateToken, requireAdmin, RFITemplateController.addQuestion);
router.post('/templates/:id/questions', authenticateToken, requireAdmin, RFITemplateController.addQuestion);

// Template rules
router.get('/templates/:templateId/rules', authenticateToken, requireRole('BUYER'), RFIRuleEngineController.getRulesForTemplate);
router.post('/templates/:templateId/rules', authenticateToken, requireAdmin, RFIRuleEngineController.createRule);

// ============================================================
// QUESTION LIBRARY — /api/rfi/questions
// ============================================================

router.post('/questions', authenticateToken, requireAdmin, RFIQuestionLibraryController.addQuestion);
router.get('/questions', authenticateToken, requireRole('BUYER'), RFIQuestionLibraryController.listQuestions);
router.put('/questions/:id', authenticateToken, requireAdmin, RFIQuestionLibraryController.updateQuestion);
router.delete('/questions/:id', authenticateToken, requireAdmin, RFIQuestionLibraryController.deleteQuestion);

// ============================================================
// RFI EVENTS — /api/rfi/events
// ============================================================

router.post('/events', authenticateToken, requireAdmin, RFIEventController.createEvent);
router.post('/events/import', authenticateToken, requireAdmin, RFIEventController.importEvents);
router.get('/events', authenticateToken, requireRole('BUYER'), RFIEventController.listEvents);
router.get('/events/active-count', authenticateToken, requireRole('BUYER'), RFIEventController.getActiveCount);
router.get('/events/:id', authenticateToken, RFIEventController.getEventById);
router.put('/events/:id', authenticateToken, requireAdmin, RFIEventController.updateEvent);
router.post('/events/:id/publish', authenticateToken, requireAdmin, RFIEventController.publishEvent);
router.post('/events/:id/close', authenticateToken, requireAdmin, RFIEventController.closeEvent);
router.post('/events/:id/convert-to-rfp', authenticateToken, requireAdmin, RFIEventController.convertToRFP);

// Invitations
router.post('/events/:id/invitations', authenticateToken, requireAdmin, RFIEventController.addInvitations);
router.get('/events/:id/invitations', authenticateToken, requireRole('BUYER'), RFIEventController.listInvitations);
router.post('/events/:id/invitations/validate', authenticateToken, requireAdmin, RFIEventController.validateEligibility);

// Supplier's own invitation inbox
router.get('/invitations', authenticateToken, requireRole('SUPPLIER'), RFIEventController.getSupplierInvitations);

// ============================================================
// SUPPLIER RESPONSES — /api/rfi/responses
// ============================================================

router.get('/responses/:rfi_id', authenticateToken, requireRole('SUPPLIER'), RFIResponseController.getMyRFI);
router.post('/responses/:rfi_id/draft', authenticateToken, requireRole('SUPPLIER'), RFIResponseController.saveDraft);
router.post('/responses/:rfi_id/submit', authenticateToken, requireRole('SUPPLIER'), RFIResponseController.submitResponse);
router.post('/responses/:rfi_id/documents', authenticateToken, requireRole('SUPPLIER'), RFIResponseController.uploadDocument);
router.get('/responses/:rfi_id/progress', authenticateToken, requireRole('SUPPLIER'), RFIResponseController.getProgress);

// ============================================================
// RULE ENGINE — /api/rfi/rules
// ============================================================

router.get('/rules/:rfi_id/evaluate', authenticateToken, RFIRuleEngineController.evaluateRules);
router.post('/rules/:rfi_id/evaluate', authenticateToken, RFIRuleEngineController.evaluateRules);

// ============================================================
// BUYER EVALUATION — /api/rfi/events/:id/evaluation
// ============================================================

router.get('/events/:id/evaluation', authenticateToken, requireRole('BUYER'), RFIEvaluationController.getComparisonMatrix);
router.get('/events/:id/evaluation/:supplier_id', authenticateToken, requireRole('BUYER'), RFIEvaluationController.getSupplierResponse);
router.post('/events/:id/evaluation/:supplier_id/notes', authenticateToken, requireRole('BUYER'), RFIEvaluationController.addInternalNotes);
router.put('/events/:id/evaluation/:supplier_id/status', authenticateToken, requireRole('BUYER'), RFIEvaluationController.updateEvaluationStatus);
router.post('/events/:id/evaluation/:supplier_id/clarification', authenticateToken, requireRole('BUYER'), RFIEvaluationController.requestClarification);

// ============================================================
// ANALYTICS — /api/rfi/analytics
// ============================================================

router.get('/analytics/events/:id', authenticateToken, requireRole('BUYER'), RFIAnalyticsController.getEventMetrics);
router.get('/analytics/buyer', authenticateToken, requireRole('BUYER'), RFIAnalyticsController.getBuyerCapabilityDashboard);

module.exports = router;

const express = require('express');
const router = express.Router();
const InvitationController = require('../controllers/invitationController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const { upload } = require('../middleware/uploadMiddleware');

// Bulk (before /:id)
router.post('/bulk-invite', authenticateToken, requireAdmin, upload.single('file'), InvitationController.bulkInvite);
router.post('/bulk', authenticateToken, requireAdmin, InvitationController.bulkInvite);
router.get('/bulk-invite/template', authenticateToken, requireAdmin, InvitationController.downloadTemplate);

router.get('/pending', authenticateToken, requireAdmin, InvitationController.getAllInvitations);
router.get('/', authenticateToken, requireAdmin, InvitationController.getAllInvitations);
router.get('/buyer/:buyerId', authenticateToken, requireAdmin, InvitationController.getInvitationsByBuyer);
router.post('/', authenticateToken, requireAdmin, InvitationController.createInvitation);
router.post('/:invitationId/revoke', authenticateToken, requireAdmin, InvitationController.revokeInvitation);
router.post('/:invitationId/resend', authenticateToken, requireAdmin, InvitationController.resendInvitation);
router.delete('/:invitationId', authenticateToken, requireAdmin, InvitationController.revokeInvitation);
router.get('/validate', InvitationController.verifyToken); // Public endpoint
router.post('/accept', InvitationController.acceptInvitation); // Public endpoint


module.exports = router;

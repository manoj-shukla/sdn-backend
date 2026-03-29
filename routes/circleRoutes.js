const express = require('express');
const router = express.Router();
const CircleController = require('../controllers/circleController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const { validateMiddleware, sanitizeObject } = require('../utils/validation');

router.get('/', authenticateToken, CircleController.getBuyerCircles);
router.get('/:id', authenticateToken, CircleController.getCircleById);
router.get('/buyer/:buyerId', authenticateToken, CircleController.getBuyerCircles);

// Create circle - with validation of both role and data
router.post('/', authenticateToken, requireAdmin, validateMiddleware('circle'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    CircleController.createCircle(req, res);
});

router.put('/:id', authenticateToken, requireAdmin, CircleController.updateCircle);
router.delete('/:id', authenticateToken, requireAdmin, CircleController.deleteCircle);

// Supplier/Member Management
router.post('/:id/suppliers', authenticateToken, requireAdmin, CircleController.addSupplier);
router.post('/:id/suppliers/bulk', authenticateToken, requireAdmin, CircleController.bulkAddSuppliers);
router.delete('/:id/suppliers/:supplierId', authenticateToken, requireAdmin, CircleController.removeSupplier);
router.get('/:id/suppliers', authenticateToken, CircleController.getSuppliers);

// Workflow Management
router.post('/:id/workflows', authenticateToken, requireAdmin, CircleController.assignWorkflow);
router.delete('/:id/workflows/:workflowId', authenticateToken, requireAdmin, CircleController.removeWorkflow);
router.get('/:id/workflows', authenticateToken, CircleController.getWorkflows);

// Stats
router.get('/:id/stats', authenticateToken, CircleController.getStats);

module.exports = router;

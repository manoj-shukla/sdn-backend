const express = require('express');
const router = express.Router();
const BuyerController = require('../controllers/buyerController');
const WorkflowService = require('../services/WorkflowService');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');

router.get('/', authenticateToken, BuyerController.getAllBuyers);
router.post('/', authenticateToken, BuyerController.createBuyer);
router.get('/:id', authenticateToken, BuyerController.getBuyerById);
router.put('/:id', authenticateToken, BuyerController.updateBuyer);

// Buyer-scoped workflow and role endpoints
router.get('/:id/workflows', authenticateToken, requireRole('BUYER'), async (req, res) => {
    try {
        const workflows = await WorkflowService.getWorkflows(req.params.id);
        res.json({ data: workflows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/workflows', authenticateToken, requireRole('BUYER'), async (req, res) => {
    try {
        const { name, description, steps } = req.body;
        const workflow = await WorkflowService.createWorkflow(req.params.id, name, description, steps);
        res.json({ data: workflow });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id/roles', authenticateToken, requireRole('BUYER'), async (req, res) => {
    try {
        const roles = await WorkflowService.getRoles(req.params.id);
        res.json({ data: roles });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/roles', authenticateToken, requireRole('BUYER'), async (req, res) => {
    try {
        const { roleName, description, permissions } = req.body;
        const role = await WorkflowService.createRole(req.params.id, roleName, description, permissions || []);
        res.json({ data: role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id/roles/:roleId', authenticateToken, requireRole('BUYER'), async (req, res) => {
    try {
        await WorkflowService.deleteRole(req.params.roleId);
        res.json({ success: true, message: "Role deleted successfully" });
    } catch (err) {
        const status = err.status || 500;
        res.status(status).json({ error: err.message });
    }
});

router.get('/:id/dashboard-alerts', authenticateToken, BuyerController.getDashboardAlerts);

module.exports = router;

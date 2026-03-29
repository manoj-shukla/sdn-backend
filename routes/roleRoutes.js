const express = require('express');
const router = express.Router();
const RoleController = require('../controllers/RoleController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validateMiddleware, sanitizeObject } = require('../utils/validation');

router.get('/', authenticateToken, RoleController.getRoles);
router.get('/:id', authenticateToken, RoleController.getRoleById);

// Create role - with validation
router.post('/', authenticateToken, validateMiddleware('role'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    RoleController.createRole(req, res);
});

// Update role - with validation
router.put('/:id', authenticateToken, validateMiddleware('role', true), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    RoleController.updateRole(req, res);
});

router.delete('/:id', authenticateToken, RoleController.deleteRole);
router.put('/:id/permissions', authenticateToken, RoleController.updatePermissions);

module.exports = router;

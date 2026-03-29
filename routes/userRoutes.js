const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const { authenticateToken, requireRole, requireAdmin, enforceSelfOrAdmin } = require('../middleware/authMiddleware');
const { validateMiddleware, sanitizeObject } = require('../utils/validation');

router.get('/', authenticateToken, requireRole('ADMIN'), UserController.getUsers);
router.post('/bulk', authenticateToken, requireAdmin, UserController.bulkCreateUsers);

// Create user (admin and buyer admin) - with validation
router.post('/', authenticateToken, requireAdmin, validateMiddleware('user'), (req, res, next) => {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    UserController.createUser(req, res);
});

router.get('/buyer/:buyerId', authenticateToken, requireRole(['ADMIN', 'BUYER']), UserController.getBuyerUsers);
router.post('/:id/password', authenticateToken, enforceSelfOrAdmin, validateMiddleware('changePassword'), UserController.changePassword);

// Get user by ID
router.get('/:id', authenticateToken, enforceSelfOrAdmin, UserController.getUserById);

// Update user role
router.put('/:id/role', authenticateToken, requireRole('ADMIN'), UserController.updateUserRole);

// Update user status (activate/deactivate)
router.put('/:id/status', authenticateToken, requireRole('ADMIN'), UserController.updateUserStatus);

// Update user profile
router.put('/:id/profile', authenticateToken, enforceSelfOrAdmin, UserController.updateUserProfile);

// Update user - with validation
router.put('/:id', authenticateToken, enforceSelfOrAdmin, validateMiddleware('user', true), (req, res, next) => {
    // Sanitize input
    req.body = sanitizeObject(req.body);
    UserController.updateUser(req, res);
});

router.delete('/:id', authenticateToken, requireRole('ADMIN'), UserController.deleteUser);

module.exports = router;

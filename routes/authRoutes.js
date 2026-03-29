const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validateMiddleware, sanitizeObject } = require('../utils/validation');

// Login - with validation
router.post('/login', validateMiddleware('login'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    AuthController.login(req, res);
});

router.get('/me', authenticateToken, AuthController.getMe);

// Refresh JWT token (used after sandbox role changes to get fresh token with updated subRole)
router.post('/refresh-token', authenticateToken, AuthController.refreshToken);

// Forgot password - with validation (email only)
router.post('/forgot-password', (req, res, next) => {
    const { email } = req.body;
    if (!email || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ error: 'Valid email address is required' });
    }
    req.body = { email: email.trim() };
    AuthController.forgotPassword(req, res);
});

// Reset password - with validation
router.post('/reset-password', validateMiddleware('passwordReset'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    AuthController.resetPassword(req, res);
});

// Change password - with validation
router.post('/change-password', authenticateToken, validateMiddleware('changePassword'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    AuthController.changePassword(req, res);
});

module.exports = router;

const express = require('express');
const router = express.Router();
const MessageController = require('../controllers/messageController');
const { authenticateToken, denyRole } = require('../middleware/authMiddleware');
const { validateMiddleware, sanitizeObject } = require('../utils/validation');

router.get('/', authenticateToken, MessageController.getMessages);

// Create message - with validation
router.post('/', authenticateToken, validateMiddleware('message'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    MessageController.createMessage(req, res);
});

router.patch('/:id/read', authenticateToken, MessageController.markAsRead);

module.exports = router;

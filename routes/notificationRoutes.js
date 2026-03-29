const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/', authenticateToken, NotificationController.getNotifications);
router.patch('/:id/read', authenticateToken, NotificationController.markAsRead);

module.exports = router;

const express = require('express');
const router = express.Router();
const ReportController = require('../controllers/ReportController');
const { authenticateToken } = require('../middleware/authMiddleware');
const { validateMiddleware, sanitizeObject } = require('../utils/validation');

router.get('/', authenticateToken, ReportController.getAllReports);
router.get('/:id', authenticateToken, ReportController.getReport);

// Generate report - with validation
router.post('/generate', authenticateToken, validateMiddleware('report'), (req, res, next) => {
    req.body = sanitizeObject(req.body);
    ReportController.generateReport(req, res);
});

router.delete('/:id', authenticateToken, ReportController.deleteReport);

module.exports = router;

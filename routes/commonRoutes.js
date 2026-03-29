const express = require('express');
const router = express.Router();
const SupplierController = require('../controllers/supplierController');
const { authenticateToken } = require('../middleware/authMiddleware');

const { requireAdmin } = require('../middleware/authMiddleware');
const db = require('../config/database');

// Top-level CRUD for contacts/addresses (mapped to SupplierController logic)
router.put('/contacts/:id', authenticateToken, SupplierController.updateContact);
router.delete('/contacts/:id', authenticateToken, SupplierController.deleteContact);

router.put('/addresses/:id', authenticateToken, SupplierController.updateAddress);
router.delete('/addresses/:id', authenticateToken, SupplierController.deleteAddress);

// Admin-only test endpoint to manipulate DB state (e.g. bypass supplier workflow)
router.post('/db/query', authenticateToken, requireAdmin, (req, res) => {
    const { query } = req.body;
    const isSelect = query.trim().toUpperCase().startsWith('SELECT');

    if (isSelect) {
        db.all(query, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, rows });
        });
    } else {
        db.run(query, [], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, changes: this.changes });
        });
    }
});

module.exports = router;

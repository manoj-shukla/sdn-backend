const CircleService = require('../services/CircleService');

class CircleController {
    static async getBuyerCircles(req, res) {
        try {
            let buyerId = parseInt(req.params.buyerId || req.query.buyerId);

            // If still NaN, and user is a BUYER, use their own buyerId
            if (isNaN(buyerId) && req.user && req.user.role === 'BUYER') {
                buyerId = req.user.buyerId;
            }

            if (isNaN(buyerId)) return res.status(400).json({ error: "Invalid or missing buyerId." });

            // RBAC: Verify user is requesting their own data
            if (req.user) {
                if (req.user.role === 'BUYER') {
                    if (req.user.buyerId !== buyerId) {
                        return res.status(403).json({ error: 'You can only view your own circles' });
                    }
                } else if (req.user.role === 'SUPPLIER') {
                    return res.status(403).json({ error: 'Suppliers cannot access circles' });
                } else if (req.user.role === 'ADMIN') {
                    return res.status(403).json({ error: 'Admins are not authorized to view circles' });
                }
            }

            res.json(await CircleService.getBuyerCircles(buyerId));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async getCircleById(req, res) {
        try {
            const circle = await CircleService.getCircleById(req.params.id);
            if (!circle) return res.status(404).json({ error: "Circle not found" });
            res.json(circle);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async createCircle(req, res) {
        try {
            console.log('[CircleController] Creating circle. Body:', req.body, 'User:', req.user?.userId);
            const circle = await CircleService.createCircle(req.body, req.user);
            res.status(200).json(circle);
        } catch (e) {
            console.error('[CircleController] Create circle FAILED:', e);
            const status = e.status || 500;
            res.status(status).json({ error: e.message });
        }
    }

    static async updateCircle(req, res) {
        try {
            const circle = await CircleService.updateCircle(req.params.id, req.body);
            res.json(circle);
        } catch (e) {
            const status = e.status || 500;
            res.status(status).json({ error: e.message });
        }
    }

    static async deleteCircle(req, res) {
        try {
            await CircleService.deleteCircle(req.params.id);
            res.sendStatus(200);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async addSupplier(req, res) {
        try {
            const supplierId = req.params.supplierId || req.body.supplierId;
            if (!supplierId) return res.status(400).json({ error: "supplierId is required" });
            const result = await CircleService.addSupplierToCircle(req.params.id, supplierId);
            res.status(200).json(result);
        } catch (e) {
            const status = e.status || 500;
            res.status(status).json({ error: e.message });
        }
    }

    static async removeSupplier(req, res) {
        try {
            const result = await CircleService.removeSupplierFromCircle(req.params.id, req.params.supplierId);
            res.status(200).json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async bulkAddSuppliers(req, res) {
        try {
            const { supplierIds } = req.body;
            if (!Array.isArray(supplierIds)) return res.status(400).json({ error: "supplierIds array is required" });

            const results = await CircleService.bulkAddSuppliers(req.params.id, supplierIds);
            const status = results.failed > 0 && results.added > 0 ? 207 : (results.failed > 0 && results.added === 0 ? 400 : 200);
            res.status(status).json(results);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async getSuppliers(req, res) {
        try {
            const data = await CircleService.getCircleSuppliers(req.params.id, req.query);
            // Tests expect array directly if no pagination
            if (!req.query.page && !req.query.pageSize) {
                return res.json(data.suppliers);
            }
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async assignWorkflow(req, res) {
        try {
            const workflowId = req.body.workflowId || req.params.workflowId;
            if (!workflowId) return res.status(400).json({ error: "workflowId is required" });
            const result = await CircleService.assignWorkflowToCircle(req.params.id, workflowId);
            res.status(200).json(result);
        } catch (e) {
            const status = e.status || 500;
            res.status(status).json({ error: e.message });
        }
    }

    static async removeWorkflow(req, res) {
        try {
            await CircleService.removeWorkflowFromCircle(req.params.id, req.params.workflowId);
            res.sendStatus(200);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async getWorkflows(req, res) {
        try {
            res.json(await CircleService.getCircleWorkflows(req.params.id));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async getStats(req, res) {
        try {
            const stats = await CircleService.getCircleStats(req.params.id);
            res.json(stats);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
}

module.exports = CircleController;

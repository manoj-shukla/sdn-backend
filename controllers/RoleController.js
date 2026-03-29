const RoleService = require('../services/RoleService');

class RoleController {
    static async getRoles(req, res) {
        try {
            const buyerId = req.user.role === 'ADMIN' ? (req.query.buyerId || req.user.buyerId) : req.user.buyerId;
            if (!buyerId) return res.status(400).json({ error: "Buyer ID is required" });

            const roles = await RoleService.getRoles(buyerId);
            res.json(roles);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getRoleById(req, res) {
        try {
            const role = await RoleService.getRoleById(req.params.id);
            if (!role) return res.status(404).json({ error: "Role not found" });
            res.json(role);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async createRole(req, res) {
        try {
            const buyerId = req.user.role === 'ADMIN' ? (req.body.buyerId || req.user.buyerId) : req.user.buyerId;
            if (!buyerId) return res.status(400).json({ error: "Buyer ID is required" });

            const role = await RoleService.createRole({ ...req.body, buyerId });
            res.json(role);
        } catch (err) {
            console.error('[RoleController.createRole]', err);
            res.status(500).json({ error: err.message });
        }
    }

    static async updateRole(req, res) {
        try {
            const role = await RoleService.updateRole(req.params.id, req.body);
            res.json(role);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async deleteRole(req, res) {
        try {
            await RoleService.deleteRole(req.params.id);
            res.sendStatus(200);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async updatePermissions(req, res) {
        try {
            const { permissions } = req.body;
            if (!permissions) return res.status(400).json({ error: "Permissions are required" });

            const role = await RoleService.updateRole(req.params.id, { permissions });
            res.json(role);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = RoleController;

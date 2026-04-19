const InvitationService = require('../services/InvitationService');

class InvitationController {
    static async getAllInvitations(req, res) {
        try {
            const status = req.path.includes('pending') ? 'PENDING' : null;
            const invitations = await InvitationService.getAllInvitations({ ...req.user, status });
            res.json(invitations);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async getInvitationsByBuyer(req, res) {
        try {
            const buyerId = parseInt(req.params.buyerId);
            if (isNaN(buyerId)) return res.status(400).json({ error: "Invalid buyerId" });

            // Security Check: Ensure user can only access their own buyer's invitations
            const requesterBuyerId = req.user.buyerid || req.user.buyerId;
            if (req.user.role !== 'ADMIN' && String(requesterBuyerId) !== String(buyerId)) {
                return res.status(403).json({ error: "Forbidden: You can only view invitations for your own organization." });
            }

            const invitations = await InvitationService.getAllInvitations({ buyerId });
            res.json(invitations);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async createInvitation(req, res) {
        try {
            const result = await InvitationService.createInvitation(req.body, req.user);
            res.status(200).json(result);
        } catch (err) {
            console.error("[InvitationController.createInvitation] Error:", err.message);
            const status = err.message === "Supplier already exists" ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async verifyToken(req, res) {
        try {
            const result = await InvitationService.verifyToken(req.query.token);
            res.json(result);
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    }

    static async acceptInvitation(req, res) {
        try {
            const { token } = req.query;
            const { companyName, password } = req.body;

            if (!token) return res.status(400).json({ error: "Token is required" });
            if (!companyName || !password) return res.status(400).json({ error: "Missing required fields" });

            const result = await InvitationService.processAcceptance(token, { companyName, password });
            res.json(result);
        } catch (err) {
            console.error("Accept Invitation Error:", err);
            res.status(400).json({ error: err.message });
        }
    }

    static async revokeInvitation(req, res) {
        try {
            const buyerId = req.user.role === 'ADMIN' ? null : (req.user.buyerid || req.user.buyerId);
            const result = await InvitationService.revokeInvitation(req.params.invitationId, buyerId);
            res.json(result);
        } catch (err) {
            const status = err.message === 'Invitation not found or unauthorized' ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async resendInvitation(req, res) {
        try {
            const buyerId = req.user.role === 'ADMIN' ? null : (req.user.buyerid || req.user.buyerId);
            const result = await InvitationService.resendInvitation(req.params.invitationId, buyerId);
            res.json(result);
        } catch (err) {
            const status = err.message === 'Invitation not found or unauthorized' ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async bulkInvite(req, res) {
        try {
            const UserService = require('../services/UserService');
            const currentUser = await UserService.getUserById(req.user.userId);

            if (!currentUser) {
                return res.status(401).json({ error: 'User not found' });
            }

            const role = (currentUser.role || '').toUpperCase();
            const subRole = (currentUser.subrole || currentUser.subRole || '').toUpperCase();

            // Allow if global ADMIN OR Buyer Admin (incl. SEM, SUPER ADMIN, etc)
            const isGlobalAdmin = role === 'ADMIN';
            const isAdminSubRole = subRole.includes('ADMIN') || subRole.includes('SEM') || subRole.includes('SUPER');
            const isBuyerAdmin = role === 'BUYER' && isAdminSubRole;


            if (!isBuyerAdmin && !isGlobalAdmin) {
                // console.warn(`[bulkInvite] PERMISSION DENIED for user ${req.user.username}. Role: ${role}, SubRole: ${subRole}`);
                return res.status(403).json({ error: 'Only Admins can perform bulk invitations' });
            }

            const BulkInvitationService = require('../services/BulkInvitationService');

            // Handle both file upload and JSON invitations
            if (req.file) {
                const results = await BulkInvitationService.processUpload(req.file.path, req.user);
                res.json(results);
            } else if (req.body.invitations && Array.isArray(req.body.invitations)) {
                // Handle JSON invitations array
                const results = await BulkInvitationService.processInvitations(req.body.invitations, req.user);
                res.json(results);
            } else {
                return res.status(400).json({ error: 'No file uploaded or invitations provided' });
            }
        } catch (e) {
            console.error('Bulk invite error:', e);
            res.status(500).json({ error: e.message });
        }
    }

    static async downloadTemplate(req, res) {
        try {
            const BulkInvitationService = require('../services/BulkInvitationService');
            const buffer = BulkInvitationService.generateTemplate();
            res.setHeader('Content-Disposition', 'attachment; filename=supplier_bulk_invitation_template.xlsx');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.send(buffer);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
}

module.exports = InvitationController;

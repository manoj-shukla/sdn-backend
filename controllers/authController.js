const AuthService = require('../services/AuthService');

class AuthController {
    static async login(req, res) {
        try {
            const { username, password } = req.body;
            const result = await AuthService.login(username, password);
            res.json(result);
        } catch (err) {
            let status = 500;
            let message = err.message;
            if (err.message === 'Invalid credentials') status = 401;
            else if (err.message === 'Account is inactive') status = 403;
            else if (err.message && (err.message.includes('EAI_AGAIN') || err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT') || err.message.includes('connect'))) {
                message = 'Database unavailable. Please try again shortly or contact support.';
            }
            res.status(status).json({ error: message });
        }
    }

    static async getMe(req, res) {
        try {
            const user = await AuthService.getMe(req.user.userId);

            // Apply multi-tenant context overrides if X-Supplier-Id was passed and verified
            if (req.user.supplierId && user.memberships && Array.isArray(user.memberships)) {
                const active = user.memberships.find(m =>
                    parseInt(m.supplierId || m.supplierid) === parseInt(req.user.supplierId)
                );
                if (active) {
                    user.supplierId = parseInt(active.supplierId || active.supplierid);
                    user.buyerId = parseInt(active.buyerId || active.buyerid);
                    user.supplierName = active.supplierName || active.suppliername;
                    user.approvalStatus = active.approvalStatus || active.approvalstatus;
                }
            }

            res.json(user);
        } catch (err) {
            const status = err.message === 'User not found' ? 404 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    // Refresh JWT token with current DB state (used after sandbox role changes)
    static async refreshToken(req, res) {
        try {
            const result = await AuthService.refreshToken(req.user.userId);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async forgotPassword(req, res) {
        try {
            const { email } = req.body;
            const result = await AuthService.requestPasswordReset(email);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    static async resetPassword(req, res) {
        try {
            const { token, newPassword } = req.body;
            const result = await AuthService.resetPassword(token, newPassword);
            res.json(result);
        } catch (err) {
            const status = err.message === 'Invalid or expired reset token' ? 401 : 500;
            res.status(status).json({ error: err.message });
        }
    }

    static async changePassword(req, res) {
        try {
            const { currentPassword, newPassword } = req.body;
            const result = await AuthService.changePassword(req.user.userId, currentPassword, newPassword);
            res.json(result);
        } catch (err) {
            const status = err.message === 'Current password is incorrect' ? 400 : 500;
            res.status(status).json({ error: err.message });
        }
    }
}

module.exports = AuthController;

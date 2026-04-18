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

            if (user.memberships && Array.isArray(user.memberships) && user.memberships.length > 0) {
                // Determine which membership is "active":
                //   1. If X-Supplier-Id header was sent (and verified by middleware), match it.
                //   2. Otherwise match the supplierId stored in the JWT (req.user.supplierId).
                //   3. Fall back to the first membership — this handles the case where
                //      users.supplierid is NULL or stale (e.g. re-invited suppliers).
                const requestedId = req.user.supplierId ? parseInt(req.user.supplierId) : null;
                const active = (requestedId
                    ? user.memberships.find(m => parseInt(m.supplierId || m.supplierid) === requestedId)
                    : null) || user.memberships[0];

                user.supplierId = parseInt(active.supplierId || active.supplierid);
                user.buyerId = parseInt(active.buyerId || active.buyerid);
                user.supplierName = active.supplierName || active.suppliername;
                user.approvalStatus = active.approvalStatus || active.approvalstatus;
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

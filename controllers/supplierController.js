const SupplierService = require('../services/SupplierService');

class SupplierController {
    static async getAllSuppliers(req, res) {
        try {
            const result = await SupplierService.getAllSuppliers(req.user);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async createSupplier(req, res) {
        try {
            const result = await SupplierService.createSupplier(req.body, req.user);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async getSupplierById(req, res) {
        try {
            const result = await SupplierService.getSupplierById(req.params.id, req.user);
            if (!result) return res.status(404).json({ error: "Supplier not found", code: "NOT_FOUND" });
            if (result.__accessDenied) return res.status(403).json({ error: "You do not have permission to view this supplier.", code: "ACCESS_DENIED" });
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    static async updateSupplier(req, res) {
        try {
            const result = await SupplierService.updateSupplier(req.params.id, req.body, req.user);
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    }

    // Sub-resources
    static async getContacts(req, res) {
        try { res.json(await SupplierService.getContacts(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async createContact(req, res) {
        try { res.json(await SupplierService.createContact(req.params.id, req.body, req.user)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async updateContact(req, res) {
        try { res.json(await SupplierService.updateContact(req.params.id, req.body, req.user)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async deleteContact(req, res) {
        try { await SupplierService.deleteContact(req.params.id); res.sendStatus(200); } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async getAddresses(req, res) {
        try { res.json(await SupplierService.getAddresses(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async createAddress(req, res) {
        try { res.json(await SupplierService.createAddress(req.params.id, req.body, req.user)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async updateAddress(req, res) {
        try { res.json(await SupplierService.updateAddress(req.params.id, req.body, req.user)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async deleteAddress(req, res) {
        try { await SupplierService.deleteAddress(req.params.id); res.sendStatus(200); } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async getBankAccounts(req, res) {
        try { res.json(await SupplierService.getBankAccounts(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async createBankAccount(req, res) {
        try { res.json(await SupplierService.createBankAccount(req.params.id, req.body, req.user)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async updateBankAccount(req, res) {
        try { res.json(await SupplierService.updateBankAccount(req.params.id, req.body, req.user)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async deleteBankAccount(req, res) {
        try { await SupplierService.deleteBankAccount(req.params.id); res.sendStatus(200); } catch (e) { res.status(500).json({ error: e.message }); }
    }

    // Reviews
    static async getReviews(req, res) {
        try { res.json(await SupplierService.getReviews(req.params.supplierId)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async submitReview(req, res) {
        try { res.json(await SupplierService.submitForReview(req.params.supplierId)); } catch (e) { res.status(500).json({ error: e.message }); }
    }
    static async decideReview(req, res) {
        try {
            const { supplierId } = req.params;
            const result = await SupplierService.processReviewDecision(
                supplierId,
                req.user.userId,
                req.user.username,
                req.user.buyerId,
                req.body
            );
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async getDashboardAlerts(req, res) {
        try {
            const supplierId = req.params.id;
            const result = await SupplierService.getDashboardAlerts(supplierId);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async getSupplierDashboard(req, res) {
        try {
            const result = await SupplierService.getDashboardAnalytics(req.params.id, req.user);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    // Bulk Upload
    static async bulkUpload(req, res) {
        try {
            const UserService = require('../services/UserService');
            const currentUser = await UserService.getUserById(req.user.userId);

            if (!currentUser) {
                return res.status(403).json({ error: 'User not found' });
            }

            const role = (currentUser.role || '').toUpperCase();
            const subRole = (currentUser.subrole || currentUser.subRole || '').toUpperCase();

            // Allow if global ADMIN OR Buyer Admin (incl. SEM, SUPER ADMIN, etc)
            const isGlobalAdmin = role === 'ADMIN';
            const isAdminSubRole = subRole.includes('ADMIN') || subRole.includes('SEM') || subRole.includes('SUPER');
            const isBuyerAdmin = role === 'BUYER' && isAdminSubRole;

            console.log(`[bulkUpload] DEBUG: userId=${req.user.userId}, db_role=${role}, db_subRole=${subRole}, isBuyerAdmin=${isBuyerAdmin}, isGlobalAdmin=${isGlobalAdmin}`);

            if (!isBuyerAdmin && !isGlobalAdmin) {
                console.warn(`[bulkUpload] PERMISSION DENIED for user ${req.user.username}. Role: ${role}, SubRole: ${subRole}`);
                return res.status(403).json({ error: 'Only Admins can perform bulk uploads' });
            }
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
            const BulkUploadService = require('../services/BulkUploadService');
            const results = await BulkUploadService.processUpload(req.file.path, req.user);
            res.json(results);
        } catch (e) {
            console.error('Bulk upload error:', e);
            res.status(500).json({ error: e.message });
        }
    }

    static async getBulkUploadStatus(req, res) {
        // Return completed status - jobs are synchronous so they finish immediately
        const { jobId } = req.params;
        res.json({ jobId, status: 'completed', progress: 100 });
    }

    static async downloadTemplate(req, res) {
        try {
            const BulkUploadService = require('../services/BulkUploadService');
            const buffer = BulkUploadService.generateTemplate();
            res.setHeader('Content-Disposition', 'attachment; filename=supplier_bulk_upload_template.xlsx');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.send(buffer);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
}

module.exports = SupplierController;

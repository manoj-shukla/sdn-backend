const db = require('../config/database');

class AuditService {
    static async logChange(supplierId, action, entityId, entityType, changes, performedByUserId, userRole) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO supplier_audit_logs 
                (supplierId, action, entityId, entityType, changes, performedByUserId, userRole) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            const params = [
                supplierId,
                action,
                entityId,
                entityType,
                JSON.stringify(changes),
                performedByUserId,
                userRole
            ];

            db.run(query, params, function (err) {
                if (err) {
                    console.error("Audit Log Error:", err);
                    // Don't reject main flow just because audit failed, but log it
                    resolve(null);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }
}

module.exports = AuditService;

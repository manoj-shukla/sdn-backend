const db = require('../config/database');

class NotificationService {
    static async getNotifications(query) {
        const { recipientRole } = query;
        // Ensure IDs are parsed as integers to avoid type mismatch with INTEGER columns
        const supplierId = query.supplierId ? parseInt(query.supplierId, 10) : null;
        const buyerId = query.buyerId ? parseInt(query.buyerId, 10) : null;
        return new Promise((resolve, reject) => {
            let sql = `SELECT notificationid, type, message, entityid, recipientrole, isread, createdat FROM notifications WHERE 1=1`;
            const params = [];

            if (recipientRole) {
                sql += ` AND recipientrole = ?`;
                params.push(recipientRole);
            }
            if (supplierId) {
                sql += ` AND supplierid = ?`;
                params.push(supplierId);
            }
            if (buyerId) {
                sql += ` AND buyerid = ?`;
                params.push(buyerId);
            }

            sql += ` ORDER BY createdat DESC`;

            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    static async createNotification(data) {
        const { type, message, entityId, recipientRole, supplierId, buyerId } = data;
        return new Promise((resolve, reject) => {
            db.run(`INSERT INTO notifications (type, message, entityid, recipientrole, supplierid, buyerid) VALUES (?, ?, ?, ?, ?, ?)`,
                [type, message, entityId, recipientRole, supplierId, buyerId],
                function (err) {
                    if (err) return reject(err);
                    resolve({ notificationId: this.lastID, ...data });
                }
            );
        });
    }

    static async markAsRead(notificationId) {
        return new Promise((resolve, reject) => {
            db.run(`UPDATE notifications SET isread = TRUE WHERE notificationid = ?`, [notificationId], function (err) {
                if (err) return reject(err);
                resolve({ success: true, changes: this.changes });
            });
        });
    }
}

module.exports = NotificationService;

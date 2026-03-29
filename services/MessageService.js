const db = require('../config/database');

class MessageService {
    static async getMessages(user) {
        return new Promise((resolve, reject) => {
            const { role, subRole, supplierId, buyerId, memberships } = user;
            if (role === 'BUYER' && buyerId) {
                // Roles to check: user's subRole, and simplified versions (e.g. 'Compliance Reviewer' -> 'Compliance')
                const roles = ['BUYER'];
                if (subRole) {
                    roles.push(subRole);
                    // Add simplified versions for common approval categories
                    if (subRole.toLowerCase().includes('compliance')) roles.push('Compliance');
                    if (subRole.toLowerCase().includes('finance')) roles.push('Finance');
                    if (subRole.toLowerCase().includes('ap') || subRole.toLowerCase().includes('payable')) roles.push('AP');
                    if (subRole.toLowerCase().includes('procurement')) roles.push('Procurement');
                    if (subRole.toLowerCase().includes('admin')) roles.push('Admin');
                }

                // If specialized admin, see all buyer notifications? 
                // For now, if subRole is 'Admin' or 'Buyer Admin', let's include all standard categories
                if (subRole === 'Admin' || subRole === 'Buyer Admin') {
                    roles.push('Compliance', 'Finance', 'AP', 'Procurement');
                }

                // Unique roles only
                const uniqueRoles = [...new Set(roles)];

                // Construct placeholders for SQL IN clause
                const placeholders = uniqueRoles.map(() => '?').join(',');
                const params = [buyerId, ...uniqueRoles];

                db.all(`SELECT * FROM messages WHERE buyerid = ? AND recipientrole IN (${placeholders}) AND type != 'SYSTEM' ORDER BY sentat DESC`,
                    params,
                    (err, rows) => err ? reject(err) : resolve(rows)
                );
            } else if (role === 'SUPPLIER' && (supplierId || (memberships && memberships.length > 0))) {
                const targetIds = memberships && memberships.length > 0
                    ? memberships.map(m => m.supplierId || m.supplierid)
                    : [supplierId];

                const placeholders = targetIds.map(() => '?').join(',');

                db.all(`SELECT * FROM messages WHERE supplierid IN (${placeholders}) AND recipientrole = 'SUPPLIER' ORDER BY sentat DESC`,
                    targetIds,
                    (err, rows) => err ? reject(err) : resolve(rows)
                );
            } else if (role === 'ADMIN') {
                db.all("SELECT * FROM messages WHERE type != 'SYSTEM' AND (recipientrole = 'ADMIN' OR sendername = ?) ORDER BY sentat DESC LIMIT 100", [user.username], (err, rows) => err ? reject(err) : resolve(rows));
            } else {
                resolve([]);
            }
        });
    }

    static async getSupplierMessages(supplierId, role) {
        return new Promise((resolve, reject) => {
            db.all("SELECT * FROM messages WHERE supplierid = ? AND recipientrole = 'SUPPLIER' ORDER BY sentat DESC", [supplierId], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    static async markAsRead(messageId) {
        return new Promise((resolve, reject) => {
            db.run("UPDATE messages SET isread = TRUE WHERE messageid = ?", [messageId], (err) => err ? reject(err) : resolve());
        });
    }

    static async createMessage(data, user) {
        return new Promise((resolve, reject) => {
            let { supplierId, buyerId, subject, content, senderName, recipientRole, priority, type } = data;

            // Isolation fix: If sender is a BUYER, ensure buyerId is their own
            if (user && user.role === 'BUYER') {
                buyerId = user.buyerId;
            }

            db.run("INSERT INTO messages (supplierid, buyerid, subject, content, sendername, recipientrole, priority, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [supplierId, buyerId, subject, content, senderName || (user ? user.username : "System"), recipientRole || 'SUPPLIER', priority || 'NORMAL', type || 'MESSAGE'],
                function (err) {
                    if (err) return reject(err);
                    // Return the created message with all fields
                    resolve({
                        messageId: this.lastID,
                        supplierId,
                        buyerId,
                        subject,
                        content,
                        senderName: senderName || "System",
                        recipientRole: recipientRole || 'SUPPLIER',
                        priority: priority || 'NORMAL',
                        type: type || 'MESSAGE'
                    });
                }
            );
        });
    }
}

module.exports = MessageService;

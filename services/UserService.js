const db = require('../config/database');
const bcrypt = require('bcryptjs');
const { isValidEmail } = require('../utils/validation');

class UserService {
    static async getUsers(page = 1, pageSize = 10, filters = {}) {
        return new Promise((resolve, reject) => {
            const offset = (page - 1) * pageSize;

            let query = "SELECT userId as \"userId\", username, email, role, subRole as \"subRole\", buyerId as \"buyerId\", supplierId as \"supplierId\", isActive as \"isActive\", phone, \"firstName\", \"lastName\" FROM users";
            let countQuery = "SELECT COUNT(*) as count FROM users";
            const params = [];

            const whereClauses = ["(is_deleted = false OR is_deleted IS NULL)"];
            if (filters.role) {
                whereClauses.push("role = ?");
                params.push(filters.role);
            }
            if (filters.buyerId) {
                whereClauses.push("buyerId = ?");
                params.push(filters.buyerId);
            }
            if (filters.search) {
                whereClauses.push("(username ILIKE ? OR email ILIKE ?)");
                params.push(`%${filters.search}%`, `%${filters.search}%`);
            }

            if (whereClauses.length > 0) {
                const whereStr = " WHERE " + whereClauses.join(" AND ");
                query += whereStr;
                countQuery += whereStr;
            }

            query += " LIMIT ? OFFSET ?";
            const queryParams = [...params, pageSize, offset];

            db.all(query, queryParams, (err, rows) => {
                if (err) return reject(err);
                db.get(countQuery, params, (err, row) => {
                    resolve({
                        users: rows,
                        total: row?.count || 0,
                        page,
                        pageSize
                    });
                });
            });
        });
    }

    static async getAdmins() {
        return new Promise((resolve, reject) => {
            db.all("SELECT userId as \"userId\", username, email, role, subRole as \"subRole\" FROM users WHERE role = 'ADMIN' AND (is_deleted = false OR is_deleted IS NULL)", [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    static async getUserById(userId) {
        return new Promise((resolve, reject) => {
            db.get("SELECT userId as \"userId\", username, email, role, subRole as \"subRole\", buyerId as \"buyerId\", supplierId as \"supplierId\", isActive as \"isActive\", phone, \"firstName\", \"lastName\" FROM users WHERE userId = ? AND (is_deleted = false OR is_deleted IS NULL)", [userId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    static async getBuyerUsers(buyerId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    u.userId as "userId", 
                    u.username as "username", 
                    u.email as "email", 
                    u.role as "role", 
                    u.subRole as "subRole", 
                    u.circleId as "circleId", 
                    c.circleName as "circleName" 
                FROM users u
                LEFT JOIN circles c ON u.circleId = c.circleId
                WHERE u.buyerId = ? AND u.role = 'BUYER' AND (u.is_deleted = false OR u.is_deleted IS NULL)
            `;
            db.all(query, [buyerId], (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    static async createUser(data) {
        return new Promise((resolve, reject) => {
            const { username, email, role, subRole, buyerId, supplierId, circleId, password } = data;

            if (!isValidEmail(email)) {
                return reject(new Error("Invalid email format"));
            }



            if (password && password.length < 6) {
                return reject(new Error("Password must be at least 6 characters"));
            }

            const defaultPassword = password || "SDNtech123!";

            bcrypt.hash(defaultPassword, 10, (err, hash) => {
                if (err) return reject(err);

                let dbRole = role;
                let dbSubRole = subRole;

                if (!['ADMIN', 'BUYER', 'SUPPLIER'].includes(role)) {
                    dbSubRole = role;
                    dbRole = 'ADMIN';
                }

                db.run(`INSERT INTO users (username, email, role, subRole, buyerId, supplierId, circleId, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [username, email, dbRole, dbSubRole || null, buyerId || null, supplierId || null, circleId || null, hash],
                    function (err) {
                        if (err) return reject(err);
                        db.get("SELECT userId as \"userId\", username, email, role, subRole as \"subRole\", buyerId as \"buyerId\", supplierId as \"supplierId\", circleId as \"circleId\" FROM users WHERE userId = ?", [this.lastID], (err, row) => resolve(row));
                    }
                );
            });
        });
    }

    static async updateUser(userId, data) {
        return new Promise((resolve, reject) => {

            const { username, email, role, subRole, circleId, supplierId, isActive, phone, firstName, lastName } = data;

            // Build dynamic update query - only update fields that are provided
            const updates = [];
            const params = [];

            if (username !== undefined && username !== null) {
                updates.push('username = ?');
                params.push(username);
            }
            if (email !== undefined && email !== null) {
                if (!isValidEmail(email)) {
                    return reject(new Error("Invalid email format"));
                }
                updates.push('email = ?');
                params.push(email);
            }
            if (role !== undefined && role !== null) {
                let dbRole = role;
                if (!['ADMIN', 'BUYER', 'SUPPLIER'].includes(role)) {
                    dbRole = 'BUYER';
                }
                updates.push('role = ?');
                params.push(dbRole);
            }
            if (subRole !== undefined && subRole !== null) {
                updates.push('subrole = ?');
                params.push(subRole);
            }
            if (circleId !== undefined) {
                updates.push('circleid = ?');
                params.push(circleId);
            }
            if (supplierId !== undefined) {
                updates.push('supplierid = ?');
                params.push(supplierId);
            }
            if (isActive !== undefined) {
                updates.push('isactive = ?');
                params.push(isActive);
            }

            if (phone !== undefined) {
                updates.push('phone = ?');
                params.push(phone);
            }
            if (firstName !== undefined) {
                updates.push('"firstName" = ?');
                params.push(firstName);
            }
            if (lastName !== undefined) {
                updates.push('"lastName" = ?');
                params.push(lastName);
            }

            if (updates.length === 0) {
                return db.get('SELECT userid as "userId", username, email, role, subrole as "subRole", buyerid as "buyerId", supplierid as "supplierId", circleid as "circleId", isactive as "isActive", phone, "firstName", "lastName" FROM users WHERE userid = ?', [userId], (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                });
            }

            params.push(userId);
            const sql = `UPDATE users SET ${updates.join(', ')} WHERE userid = ?`;

            db.run(sql, params, function (err) {
                if (err) {
                    return reject(err);
                }
                db.get('SELECT userid as "userId", username, email, role, subrole as "subRole", buyerid as "buyerId", supplierid as "supplierId", circleid as "circleId", isactive as "isActive", phone, "firstName", "lastName" FROM users WHERE userid = ?', [userId], (err, row) => resolve(row));
            });
        });
    }

    static async deleteUser(userId, performedByUserId) {
        return new Promise((resolve, reject) => {
            db.run("UPDATE users SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP WHERE userId = ?", [userId], function(err) {
                if (err) return reject(err);
                
                // Record Audit Log
                const auditDetails = JSON.stringify({ userId, action: 'SOFT_DELETE' });
                db.run("INSERT INTO user_audit_logs (userId, action, performedByUserId, details) VALUES (?, ?, ?, ?)",
                    [userId, 'DELETE', performedByUserId, auditDetails],
                    (auditErr) => {
                        if (auditErr) console.warn("[UserService.deleteUser] Audit logging failed:", auditErr.message);
                        resolve();
                    }
                );
            });
        });
    }

    static async bulkCreateUsers(usersData) {
        const results = {
            created: 0,
            errors: []
        };

        const promises = usersData.map(async (userData) => {
            try {
                const user = await this.createUser(userData);
                if (user) results.created++;
            } catch (err) {
                // Treat duplicate key errors as success (user already exists == effectively created)
                const isDuplicate = err.message && (
                    err.message.includes('duplicate') ||
                    err.message.includes('unique constraint') ||
                    err.message.includes('UNIQUE constraint')
                );
                if (!isDuplicate) {
                    results.errors.push({
                        username: userData.username,
                        error: err.message
                    });
                } else {
                    // User already exists - count as created for idempotency
                    results.created++;
                }
            }
        });

        await Promise.all(promises);
        return results;
    }
}

module.exports = UserService;

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const WorkflowService = require('./WorkflowService'); // Will need to make sure this path is correct after move
const { isValidEmail } = require('../utils/validation');

class BuyerService {
    static async getAllBuyers() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    buyerid, 
                    buyername, 
                    buyercode, 
                    email, 
                    phone, 
                    country, 
                    isactive, 
                    createdat, 
                    updatedat, 
                    issandboxactive 
                FROM buyers
            `;
            db.all(query, [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map(row => ({
                    buyerId: row.buyerid || row.buyerId,
                    buyerName: row.buyername || row.buyerName,
                    buyerCode: row.buyercode || row.buyerCode,
                    email: row.email,
                    phone: row.phone,
                    country: row.country,
                    isActive: row.isactive || row.isActive,
                    createdAt: row.createdat || row.createdAt,
                    updatedAt: row.updatedat || row.updatedAt,
                    isSandboxActive: row.issandboxactive || row.isSandboxActive
                })));
            });
        });
    }

    /**
     * Check whether a proposed buyer identity is available.
     *
     * Looks at BOTH tables used by the create-buyer flow so we can surface
     * conflicts upfront (before committing any row):
     *   - buyers.buyername  / buyers.buyercode / buyers.email
     *   - sdn_users.username / sdn_users.email
     *
     * @param {Object} opts  { buyerName, buyerCode, email }
     * @returns {Promise<{
     *     available: boolean,
     *     conflicts: {
     *         buyerName?: boolean,
     *         buyerCode?: boolean,
     *         email?: boolean,
     *         username?: boolean
     *     }
     * }>}
     */
    static async checkAvailability({ buyerName, buyerCode, email } = {}) {
        const conflicts = {};

        const nameKey = buyerName ? String(buyerName).trim().toLowerCase() : null;
        const codeKey = buyerCode ? String(buyerCode).trim().toLowerCase() : null;
        const emailKey = email ? String(email).trim().toLowerCase() : null;

        // Check buyers table for name, code, or email collisions.
        // We use db.all to ensure we catch ALL conflicts, not just the first one the DB finds.
        const buyersRows = await new Promise((resolve, reject) => {
            db.all(
                `SELECT buyername, buyercode, email FROM buyers
                 WHERE (? IS NOT NULL AND LOWER(buyername) = ?)
                    OR (? IS NOT NULL AND LOWER(buyercode) = ?)
                    OR (? IS NOT NULL AND LOWER(email) = ?)`,
                [nameKey, nameKey, codeKey, codeKey, emailKey, emailKey],
                (err, rows) => (err ? reject(err) : resolve(rows || []))
            );
        });

        for (const row of buyersRows) {
            if (nameKey && String(row.buyername || '').toLowerCase() === nameKey) conflicts.buyerName = true;
            if (codeKey && String(row.buyercode || '').toLowerCase() === codeKey) conflicts.buyerCode = true;
            if (emailKey && String(row.email || '').toLowerCase() === emailKey) conflicts.email = true;
        }

        // Check sdn_users table for username or email collisions.
        // The create-buyer flow uses buyerName as the sdn_users.username.
        const usersRows = await new Promise((resolve, reject) => {
            db.all(
                `SELECT username, email FROM sdn_users
                 WHERE (? IS NOT NULL AND LOWER(username) = ?)
                    OR (? IS NOT NULL AND LOWER(email) = ?)`,
                [nameKey, nameKey, emailKey, emailKey],
                (err, rows) => (err ? reject(err) : resolve(rows || []))
            );
        });

        for (const row of usersRows) {
            if (nameKey && String(row.username || '').toLowerCase() === nameKey) conflicts.username = true;
            if (emailKey && String(row.email || '').toLowerCase() === emailKey) conflicts.email = true;
        }

        return {
            available: Object.keys(conflicts).length === 0,
            conflicts,
        };
    }

    static async createBuyer(data) {
        const { buyerName, buyerCode, email, phone, country, password, isSandboxActive } = data;

        if (!isValidEmail(email)) {
            throw new Error("Invalid email format");
        }

        // Pre-flight uniqueness check across BOTH buyers and sdn_users.
        // Without the sdn_users check we hit a nasty partial-creation bug: the
        // buyer row commits, then the sdn_users INSERT fails with a UNIQUE
        // constraint violation, leaving an orphan buyer with no admin user.
        const { available, conflicts } = await BuyerService.checkAvailability({ buyerName, buyerCode, email });
        if (!available) {
            if (conflicts.email) throw new Error("Email is already taken");
            if (conflicts.buyerCode) throw new Error("Buyer code is already taken");
            // buyerName OR username collision both surface as the same message
            throw new Error("Username is already taken");
        }

        return new Promise((resolve, reject) => {
            const sandboxActive = isSandboxActive === true || isSandboxActive === 'true';

            // Duplicate Validation Check (defence-in-depth — race-safe net in
            // case another request commits between our checkAvailability call
            // above and the INSERT below). Case-insensitive to match how the
            // upstream pre-flight check works.
            const nameKey = String(buyerName || '').trim().toLowerCase();
            const codeKey = String(buyerCode || '').trim().toLowerCase();
            const emailKey = String(email || '').trim().toLowerCase();
            db.get(
                `SELECT buyerid FROM buyers
                 WHERE LOWER(buyername) = ? OR LOWER(buyercode) = ? OR LOWER(email) = ?`,
                [nameKey, codeKey, emailKey],
                (err, row) => {
                if (err) return reject(err);
                if (row) return reject(new Error("Username is already taken"));

                db.run(`INSERT INTO buyers (buyername, buyercode, email, phone, country, issandboxactive, isactive) VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
                    [buyerName, buyerCode, email, phone, country, sandboxActive],
                    function (insertErr) {
                        if (insertErr) return reject(insertErr);

                        const buyerId = this.lastID;

                        // Create Admin User for Buyer
                        const defaultPassword = password || "SDNtech123!";
                        bcrypt.hash(defaultPassword, 10, (hashErr, hash) => {
                            if (hashErr) {
                                // Non-fatal, return buyer without user logic
                                return db.get("SELECT * FROM buyers WHERE buyerid = ?", [buyerId], (err, row) => {
                                    if (row) {
                                        resolve({
                                            buyerId: row.buyerid || row.buyerId,
                                            buyerName: row.buyername || row.buyerName,
                                            buyerCode: row.buyercode || row.buyerCode,
                                            email: row.email,
                                            phone: row.phone,
                                            country: row.country,
                                            isSandboxActive: row.issandboxactive || row.isSandboxActive,
                                            isActive: row.isactive || row.isActive,
                                            userCreated: false,
                                            error: "Failed to hash password"
                                        });
                                    } else resolve(null);
                                });
                            }

                            db.run(`INSERT INTO sdn_users (username, email, role, subrole, buyerid, password) VALUES (?, ?, ?, ?, ?, ?)`,
                                [buyerName, email, 'BUYER', 'Buyer Admin', buyerId, hash],
                                async function (userErr) {
                                    if (userErr) {
                                        // Roll back the orphan buyer row so we don't leave
                                        // a buyer record without an admin user. This should
                                        // only fire on a race against another create (the
                                        // pre-flight checkAvailability covered the normal case).
                                        const msg = /uniq|duplicate/i.test(userErr.message || '')
                                            ? "Username is already taken"
                                            : "Failed to create admin user";
                                        return db.run(
                                            "DELETE FROM buyers WHERE buyerid = ?",
                                            [buyerId],
                                            () => reject(new Error(msg))
                                        );
                                    }

                                    // Seed Defaults
                                    try {
                                        await WorkflowService.seedDefaults(buyerId);
                                    } catch (e) {
                                        console.error("Seeding failed", e);
                                    }

                                    db.get("SELECT buyerid, buyername, buyercode, email, phone, country, issandboxactive, isactive FROM buyers WHERE buyerid = ?", [buyerId], (err, row) => {
                                        if (row) {
                                            resolve({
                                                buyerId: row.buyerid || row.buyerId,
                                                buyerName: row.buyername || row.buyerName,
                                                buyerCode: row.buyercode || row.buyerCode,
                                                email: row.email,
                                                phone: row.phone,
                                                country: row.country,
                                                isSandboxActive: row.issandboxactive || row.isSandboxActive,
                                                isActive: row.isactive || row.isActive,
                                                userCreated: true,
                                                adminUsername: buyerName
                                            });
                                        } else resolve(null);
                                    });
                                }
                            );
                        });
                    }
                );
            });
        });
    }

    static async getBuyerById(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT buyerid, buyername, buyercode, email, phone, country, issandboxactive, isactive FROM buyers WHERE buyerid = ?", [id], (err, row) => {
                if (err) return reject(err);
                if (row) {
                    resolve({
                        buyerId: row.buyerid || row.buyerId,
                        buyerName: row.buyername || row.buyerName,
                        buyerCode: row.buyercode || row.buyerCode,
                        email: row.email,
                        phone: row.phone,
                        country: row.country,
                        isSandboxActive: row.issandboxactive || row.isSandboxActive,
                        isActive: row.isactive || row.isActive
                    });
                } else resolve(null);
            });
        });
    }

    static async updateBuyer(id, data) {
        return new Promise((resolve, reject) => {
            const { buyerName, email, phone, country, isSandboxActive } = data;

            if (email !== undefined && !isValidEmail(email)) {
                return reject(new Error("Invalid email format"));
            }

            const sandboxActive = isSandboxActive === true || isSandboxActive === 'true';

            // Duplicate Validation Check
            db.get(`SELECT buyerid FROM buyers WHERE (buyername = ? OR email = ?) AND buyerid != ?`, [buyerName, email, id], (err, row) => {
                if (err) return reject(err);
                if (row) return reject(new Error("Username is already taken"));

                db.run(`UPDATE buyers SET buyername = ?, email = ?, phone = ?, country = ?, issandboxactive = ? WHERE buyerid = ?`,
                    [buyerName, email, phone, country, sandboxActive, id],
                    function (updateErr) {
                        if (updateErr) return reject(updateErr);
                        db.get("SELECT buyerid, buyername, buyercode, email, phone, country, issandboxactive, isactive FROM buyers WHERE buyerid = ?", [id], (err, row) => {
                            // Ensure consistent camelCase response
                            if (row) {
                                const result = {
                                    buyerId: row.buyerid || row.buyerId,
                                    buyerName: row.buyername || row.buyerName,
                                    buyerCode: row.buyercode || row.buyerCode,
                                    email: row.email,
                                    phone: row.phone,
                                    country: row.country,
                                    isSandboxActive: row.issandboxactive || row.isSandboxActive,
                                    isActive: row.isactive || row.isActive
                                };
                                resolve(result);
                            } else {
                                resolve(row);
                            }
                        });
                    }
                );
            });
        });
    }

    static async getDashboardAlerts(buyerId) {
        return new Promise(async (resolve, reject) => {
            try {
                const alerts = [];

                // 1. Expiring Documents
                const expiringDocs = await new Promise((res, rej) => {
                    db.get(`
                        SELECT COUNT(*) as count 
                        FROM documents d
                        JOIN suppliers s ON d.supplierid = s.supplierid
                        WHERE s.buyerid = ? 
                          AND d.expirydate <= CURRENT_DATE + INTERVAL '30 days'
                          AND d.expirydate >= CURRENT_DATE
                    `, [buyerId], (err, row) => err ? rej(err) : res(row?.count || 0));
                });
                if (expiringDocs > 0) {
                    alerts.push({
                        type: 'DOCUMENT_EXPIRY',
                        severity: 'WARNING',
                        count: parseInt(expiringDocs),
                        message: `${expiringDocs} documents are expiring in the next 30 days.`
                    });
                }

                // 2. High Risk Suppliers
                const highRiskCount = await new Promise((res, rej) => {
                    db.get(`SELECT COUNT(*) as count FROM suppliers WHERE buyerid = ? AND risklevel = 'High'`, [buyerId], (err, row) => err ? rej(err) : res(row?.count || 0));
                });
                if (highRiskCount > 0) {
                    alerts.push({
                        type: 'HIGH_RISK_SUPPLIER',
                        severity: 'CRITICAL',
                        count: parseInt(highRiskCount),
                        message: `${highRiskCount} suppliers are flagged as High Risk.`
                    });
                }

                resolve({
                    alerts,
                    suppliersWithExpiringDocs: expiringDocs > 0 ? [{ type: 'DOCUMENT_EXPIRY', count: expiringDocs }] : []
                });
            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = BuyerService;

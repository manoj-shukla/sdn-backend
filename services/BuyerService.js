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

    static async createBuyer(data) {
        return new Promise((resolve, reject) => {
            const { buyerName, buyerCode, email, phone, country, password, isSandboxActive } = data;

            if (!isValidEmail(email)) {
                return reject(new Error("Invalid email format"));
            }

            const defaultPassword = password || "SDNtech123!";
            const sandboxActive = isSandboxActive === true || isSandboxActive === 'true';

            // Duplicate Validation Check
            db.get(`SELECT buyerid FROM buyers WHERE buyername = ? OR buyercode = ? OR email = ?`, [buyerName, buyerCode, email], (err, row) => {
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
                                        return db.get("SELECT * FROM buyers WHERE buyerid = ?", [buyerId], (err, row) => resolve({ ...row, userCreated: false, error: "Failed to create admin user" }));
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

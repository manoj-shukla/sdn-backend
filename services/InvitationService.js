const db = require('../config/database');
const crypto = require('crypto');
const { isValidEmail } = require('../utils/validation');

class InvitationService {
    static async getAllInvitations(user) {
        return new Promise((resolve, reject) => {
            let query = "SELECT * FROM invitations";
            let params = [];

            const userRole = (user.role || '').toUpperCase();
            const buyerId = user.buyerId || user.buyerid;

            console.log(`[InvitationService.getAllInvitations] Role: ${userRole}, BuyerId: ${buyerId}`);

            if (buyerId) {
                query += " WHERE buyerid = ?";
                params.push(buyerId);
            }

            if (user.status) {
                query += (params.length > 0 ? " AND" : " WHERE") + " status = ?";
                params.push(user.status.toUpperCase());
            }

            query += " ORDER BY createdat DESC";

            db.all(query, params, (err, rows) => {
                if (err) return reject(err);

                // Map to camelCase and enrich
                const enriched = rows.map(r => ({
                    invitationId: r.invitationId || r.invitationid,
                    buyerId: r.buyerId || r.buyerid,
                    buyerName: r.buyerName || r.buyername,
                    supplierId: r.supplierId || r.supplierid,
                    supplierName: r.supplierName || r.suppliername,
                    email: r.email,
                    invitationToken: r.invitationToken || r.invitationtoken || r.token,
                    status: r.status,
                    expiresAt: r.expiresAt || r.expiresat,
                    acceptedAt: r.acceptedAt || r.acceptedat,
                    createdAt: r.createdAt || r.createdat,
                    legalName: r.legalName || r.legalname,
                    supplierType: r.supplierType || r.suppliertype,
                    country: r.country,
                    internalCode: r.internalCode || r.internalcode,
                    role: r.role,
                    // Constructed field
                    invitationLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/accept-invite?token=${r.invitationToken || r.invitationtoken || r.token}`
                }));
                resolve(enriched);
            });
        });
    }

    static async createInvitation(data, user) {
        return new Promise((resolve, reject) => {
            const { email, role, buyerId } = data;
            if (!isValidEmail(email)) {
                return reject(new Error("Invalid email format"));
            }
            const token = crypto.randomBytes(32).toString('hex');

            // If user is buyer, force buyerId
            const userRoleCheck = (user.role || '').toUpperCase();
            const bid = userRoleCheck === 'BUYER' ? (user.buyerId || user.buyerid) : buyerId;
            const userRole = role || 'SUPPLIER';

            // Check for existing user, invitation, or supplier name
            const { legalName, supplierType, country, internalCode, isPreApproved, buyerComments } = data;

            const checkQuery = `
                SELECT email as identifier FROM users WHERE email = ?
                UNION
                SELECT email as identifier FROM invitations WHERE email = ? AND status != 'REVOKED' AND status != 'EXPIRED'
                UNION
                SELECT legalname as identifier FROM suppliers WHERE legalname = ?
            `;

            db.get(checkQuery, [email, email, legalName], (err, row) => {
                if (err) return reject(err);
                if (row) return reject(new Error("Supplier already exists"));

                // Calculate expiry in JS for DB compatibility
                const expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + 7);

                db.run(`INSERT INTO invitations (email, role, buyerid, invitationtoken, expiresat, status, legalname, suppliertype, country, internalcode, ispreapproved, buyercomments) 
                        VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
                    [email, userRole, bid, token, expiresAt, legalName, supplierType, country, internalCode, isPreApproved, buyerComments],
                    function (err) {
                        if (err) {
                            console.error("[InvitationService] Insert Error:", err.message);
                            return reject(err);
                        }
                        const invitationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/accept-invite?token=${token}`;
                        console.log(`[INVITE SIMULATION] To: ${email} | Link: ${invitationLink}`);
                        resolve({ invitationId: this.lastID, email, token, invitationLink });
                    }
                );
            });
        });
    }

    static async verifyToken(token) {
        return new Promise((resolve, reject) => {
            // Fix: schema uses invitationToken, not token
            // Fix: Use CURRENT_TIMESTAMP for Postgres compatibility instead of datetime('now')
            db.get("SELECT * FROM invitations WHERE invitationtoken = ? AND status = 'PENDING' AND expiresat > CURRENT_TIMESTAMP", [token], (err, row) => {
                if (err) return reject(err);
                if (!row) return reject(new Error("Invalid or expired invitation token"));

                // Normalize keys
                const invitation = {
                    ...row,
                    invitationId: row.invitationId || row.invitationid,
                    buyerId: row.buyerId || row.buyerid,
                    supplierId: row.supplierId || row.supplierid,
                    email: row.email,
                    legalName: row.legalName || row.legalname,
                    buyerName: row.buyerName || row.buyername,
                    country: row.country,
                    internalCode: row.internalCode || row.internalcode
                };
                resolve(invitation);
            });
        });
    }

    static async acceptInvitation(token, supplierId, legalName) {
        return new Promise((resolve, reject) => {
            db.run("UPDATE invitations SET status = 'ACCEPTED', acceptedat = CURRENT_TIMESTAMP, supplierid = ?, suppliername = ? WHERE invitationtoken = ?",
                [supplierId, legalName, token],
                (err) => {
                    if (err) return reject(err);
                    resolve();
                });
        });
    }

    static async processAcceptance(token, { companyName, password, businessType, country }) {
        // Dynamic imports to avoid circular dependencies if any
        const AuthService = require('./AuthService');
        const bcrypt = require('bcryptjs');

        return new Promise(async (resolve, reject) => {
            try {
                // 1. Validate Token
                const invitation = await this.verifyToken(token);

                // 2. Check if user already exists
                db.get("SELECT userId FROM users WHERE email = ?", [invitation.email], async (err, existingUser) => {
                    if (err) return reject(err);

                    const createSupplierAndMembership = (targetUserId) => {
                        const bType = businessType || invitation.suppliertype || 'Enterprise';
                        const ctry = country || invitation.country || 'India';

                        db.run(`INSERT INTO suppliers (legalname, businesstype, country, createdbyuserid, createdbyusername, buyerid, approvalstatus) 
                                VALUES (?, ?, ?, ?, 'System', ?, 'DRAFT')`,
                            [companyName, bType, ctry, targetUserId, invitation.buyerId],
                            function (err) {
                                if (err) return reject(err);
                                const supplierId = this.lastID;
                                const code = `SDN-SUP-${String(supplierId).padStart(3, '0')}`;
                                db.run("UPDATE suppliers SET suppliercode = ? WHERE supplierid = ?", [code, supplierId]);

                                // 4. Update user role and linking
                                db.run(`UPDATE users SET role = 'SUPPLIER', supplierid = ?, buyerid = ? WHERE userid = ?`,
                                    [supplierId, invitation.buyerId, targetUserId],
                                    (err) => {
                                        if (err) return reject(err);

                                        // 5. Create Membership
                                        db.run(`INSERT INTO user_supplier_memberships (userid, supplierid) VALUES (?, ?)`,
                                            [targetUserId, supplierId],
                                            async (err) => {
                                                if (err) return reject(err);
                                                await InvitationService.acceptInvitation(token, supplierId, companyName);
                                                try {
                                                    const loginResult = await AuthService.login(invitation.email, password);
                                                    resolve(loginResult);
                                                } catch (e) {
                                                    reject(e);
                                                }
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    };

                    if (existingUser) {
                        return createSupplierAndMembership(existingUser.userId || existingUser.userid);
                    }

                    // 3. Create User if doesn't exist
                    bcrypt.hash(password, 10, (err, hash) => {
                        if (err) return reject(err);
                        db.run(`INSERT INTO users (username, email, password, role, supplierid, buyerid) VALUES (?, ?, ?, ?, ?, ?)`,
                            [invitation.email, invitation.email, hash, 'SUPPLIER', null, null],
                            function (err) {
                                if (err) return reject(err);
                                createSupplierAndMembership(this.lastID);
                            }
                        );
                    });
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    static revokeInvitation(invitationId, buyerId) {
        return new Promise((resolve, reject) => {
            let query = `UPDATE invitations SET status = 'REVOKED' WHERE invitationid = ?`;
            const params = [invitationId];

            if (buyerId) {
                query += ` AND buyerid = ?`;
                params.push(buyerId);
            }

            db.run(query, params, (err) => {
                if (err) return reject(err);
                resolve({ success: true });
            });
        });
    }

    static async resendInvitation(invitationId, userOrBuyerId) {
        return new Promise((resolve, reject) => {
            const newToken = crypto.randomBytes(32).toString('hex');
            const newExpiry = new Date();
            newExpiry.setDate(newExpiry.getDate() + 7);

            // Handle both legacy (just buyerId) and new (user object) signatures
            const isObject = userOrBuyerId !== null && typeof userOrBuyerId === 'object';
            const buyerId = isObject ? userOrBuyerId.buyerId : userOrBuyerId;
            const isAdmin = isObject && userOrBuyerId.role === 'ADMIN';

            let query = `UPDATE invitations SET invitationtoken = ?, expiresat = ?, status = 'PENDING' WHERE invitationid = ?`;
            let params = [newToken, newExpiry, parseInt(invitationId)];

            if (!isAdmin && buyerId) {
                query += ` AND buyerid = ?`;
                params.push(buyerId);
            }

            db.run(query, params, function (err) {
                if (err) return reject(err);
                if (this.changes === 0) return reject(new Error("Invitation not found or unauthorized"));

                db.get("SELECT email FROM invitations WHERE invitationid = ?", [invitationId], (err, row) => {
                    const email = row?.email || 'unknown';
                    const invitationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/accept-invite?token=${newToken}`;
                    console.log(`[RESEND SIMULATION] To: ${email} | Link: ${invitationLink}`);
                    resolve({ message: "Invitation resent successfully", token: newToken, invitationLink });
                });
            });
        });
    }
}

module.exports = InvitationService;

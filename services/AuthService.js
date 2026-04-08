const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../middleware/authMiddleware');
const { isValidEmail } = require('../utils/validation');
const SALT_ROUNDS = 10;

class AuthService {
    static async login(username, password) {
        return new Promise((resolve, reject) => {
                db.get(`
                    SELECT u.*, b.isSandboxActive, s.approvalStatus, s.legalName as supplierName
                    FROM users u 
                    LEFT JOIN buyers b ON u.buyerid = b.buyerid 
                    LEFT JOIN suppliers s ON u.supplierid = s.supplierid
                    WHERE u.username = ? OR u.email = ?
                `, [username, username], async (err, user) => {
                    try {
                        if (err) {
                            console.error("[AuthService.login] DB Error:", err.message);
                            return reject(err);
                        }
                        if (!user) {
                            console.warn(`[AuthService.login] User not found for: ${username}`);
                            return reject(new Error("Invalid credentials"));
                        }
                        
                        console.log(`[AuthService.login] Found user: ${user.username}, role: ${user.role}, supplierId: ${user.supplierid || user.supplierId}`);

                        const isActiveValue = user.isactive !== undefined ? user.isactive : user.isActive;
                        if (isActiveValue === false || isActiveValue === 0 || isActiveValue === 'false' || isActiveValue === '0') {
                            console.warn(`[AuthService.login] Account inactive for: ${username}`);
                            return reject(new Error("Account is inactive"));
                        }

                        const validPassword = await bcrypt.compare(password, user.password || '');
                        if (!validPassword) {
                            console.warn(`[AuthService.login] Invalid password for: ${username}`);
                            return reject(new Error("Invalid credentials"));
                        }

                        console.log(`[AuthService.login] Password verified. Fetching memberships...`);
                        const memberships = await AuthService.getMemberships(user.userid || user.userId);
                        console.log(`[AuthService.login] Memberships count: ${memberships.length}`);

                        const tokenData = {
                            userId: user.userid || user.userId,
                            username: user.username,
                            role: user.role,
                            supplierId: user.supplierid || user.supplierId,
                            buyerId: user.buyerid || user.buyerId,
                            subRole: user.subrole || user.subRole,
                            isSandboxActive: user.issandboxactive || user.isSandboxActive,
                            approvalStatus: user.approvalstatus || user.approvalStatus,
                            memberships,
                            mustChangePassword: user.mustchangepassword || user.mustChangePassword || false
                        };
                        
                        const token = jwt.sign(tokenData, SECRET_KEY, { expiresIn: '1h' });
                        console.log(`[AuthService.login] Token generated for userId: ${tokenData.userId}`);

                        const userDto = {
                            ...tokenData,
                            email: user.email,
                            createdAt: user.createdat || user.createdAt,
                            supplierName: user.suppliername || user.supplierName
                        };

                        resolve({ token, user: userDto });
                    } catch (e) {
                        console.error("[AuthService.login] Critical Error:", e);
                        reject(e);
                    }
                });
        });
    }

    static async getMemberships(userId) {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT m.supplierid, s.buyerid, s.legalname as suppliername, b.buyername, s.approvalstatus
                FROM user_supplier_memberships m
                JOIN suppliers s ON m.supplierid = s.supplierid
                JOIN buyers b ON s.buyerid = b.buyerid
                WHERE m.userid = ? AND m.isactive = TRUE
            `, [userId], (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map(r => ({
                    supplierId: r.supplierid || r.supplierId,
                    buyerId: r.buyerid || r.buyerId,
                    supplierName: r.suppliername || r.supplierName,
                    buyerName: r.buyername || r.buyerName,
                    approvalStatus: r.approvalstatus || r.approvalStatus
                })));
            });
        });
    }

    static async getMe(userId) {
        return new Promise((resolve, reject) => {
            db.get(`
                SELECT u.userid, u.username, u.email, u.role, u.buyerid, u.supplierid, u.subrole, u.circleid, b.issandboxactive, s.approvalstatus, s.legalname as suppliername
                FROM users u
                LEFT JOIN buyers b ON u.buyerid = b.buyerid 
                LEFT JOIN suppliers s ON u.supplierid = s.supplierid
                WHERE u.userid = ?
            `, [userId], async (err, row) => {
                if (err) return reject(err);
                if (!row) return reject(new Error("User not found"));

                const memberships = await AuthService.getMemberships(userId);

                const mappedUser = {
                    userId: row.userid || row.userId,
                    username: row.username,
                    email: row.email,
                    role: row.role,
                    buyerId: row.buyerid || row.buyerId,
                    supplierId: row.supplierid || row.supplierId,
                    subRole: row.subrole || row.subRole,
                    circleId: row.circleid || row.circleId,
                    isSandboxActive: row.issandboxactive || row.isSandboxActive,
                    approvalStatus: row.approvalstatus || row.approvalStatus,
                    supplierName: row.suppliername || row.supplierName,
                    memberships,
                    mustChangePassword: row.mustchangepassword || row.mustChangePassword || false
                };
                resolve(mappedUser);
            });
        });
    }

    static async requestPasswordReset(email) {
        return new Promise((resolve, reject) => {
            if (!isValidEmail(email)) {
                return reject(new Error("Invalid email format"));
            }
            db.get(`SELECT userid FROM users WHERE email = ?`, [email], (err, user) => {
                if (err) return reject(err);

                // Security: Don't reveal if user exists, but for logic we proceed if they do
                if (!user) {
                    return resolve({ message: "If an account exists, a reset link has been sent." });
                }

                const resetToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

                db.run(`
                    INSERT INTO password_resets (email, token, expiresat)
                    VALUES ($1, $2, NOW() + INTERVAL '1 hour')
                    ON CONFLICT (email) DO UPDATE SET token = $2, expiresat = NOW() + INTERVAL '1 hour'
                `, [email, resetToken],
                    (err) => {
                        if (err) return reject(new Error("Failed to generate token"));

                        // Log the link for simulation
                        console.log(`[EMAIL SIMULATION] To: ${email} | Subject: Password Reset | Link: http://localhost:3001/auth/reset-password?token=${resetToken}`);
                        resolve({ message: "If an account exists, a reset link has been sent.", debugToken: resetToken });
                    }
                );
            });
        });
    }

    static async resetPassword(token, newPassword) {
        return new Promise(async (resolve, reject) => {
            let userId = null;

            const resetData = await new Promise((res, rej) => {
                db.get(`SELECT email, expiresat FROM password_resets WHERE token = ?`, [token], (err, row) => {
                    if (err) {
                        console.error("[AuthService.resetPassword] DB Error:", err);
                        rej(err);
                    } else res(row);
                });
            });

            if (resetData) {
                console.log("[AuthService.resetPassword] Found token in DB for user:", resetData.email);
                if (new Date(resetData.expiresat) < new Date()) {
                    console.warn("[AuthService.resetPassword] Reset token expired for user:", resetData.email);
                    return reject(new Error("Reset token expired"));
                }
                const user = await new Promise((res, rej) => {
                    db.get("SELECT userid FROM users WHERE email = ?", [resetData.email], (err, row) => {
                        if (err || !row) res(null); else res(row);
                    });
                });
                userId = user ? user.userid : null;
            } else {
                // Fallback to JWT for testing
                try {
                    console.log("[AuthService.resetPassword] Token not in DB, trying JWT fallback");
                    const decoded = jwt.verify(token, SECRET_KEY);
                    userId = decoded.userId || decoded.userid;
                    console.log("[AuthService.resetPassword] JWT Decoded userId:", userId);
                } catch (e) {
                    console.error("[AuthService.resetPassword] JWT Verification failed:", e.message);
                    return reject(new Error("Invalid or expired reset token"));
                }
            }

            if (!userId) {
                console.error("[AuthService.resetPassword] No userId found");
                return reject(new Error("Could not identify user from token"));
            }

            const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
            db.run(`UPDATE users SET password = ?, mustchangepassword = false WHERE userid = ?`, [hashedPassword, userId], (err) => {
                if (err) {
                    console.error("[AuthService.resetPassword] UPDATE Error:", err);
                    return reject(err);
                }
                // Clear reset token if it was in DB
                db.run(`DELETE FROM password_resets WHERE email = (SELECT email FROM users WHERE userid = ?)`, [userId]);
                resolve({ success: true, message: "Password updated successfully" });
            });
        });
    }

    static async changePassword(userId, currentPassword, newPassword) {
        return new Promise((resolve, reject) => {
            console.log(`DEBUG [AuthService.changePassword]: Attempting change for userId=${userId}`);
            db.get('SELECT * FROM users WHERE userid = ?', [userId], async (err, user) => {
                if (err) {
                    console.error(`DEBUG [AuthService.changePassword]: DB Error: ${err.message}`);
                    return reject(err);
                }
                if (!user) {
                    console.error(`DEBUG [AuthService.changePassword]: User ${userId} not found`);
                    return reject(new Error('User not found'));
                }

                // Postgres returns lowercase field names
                const passwordHash = user.password || user.PASSWORD || user.passwordhash;
                if (!passwordHash) {
                    console.error(`DEBUG [AuthService.changePassword]: No password hash for user ${userId}. Keys: ${Object.keys(user)}`);
                    return reject(new Error('User has no password set'));
                }

                const validPassword = await bcrypt.compare(currentPassword, passwordHash);
                if (!validPassword) {
                    console.log(`DEBUG [AuthService.changePassword]: Password mismatch for user ${userId}`);
                    return reject(new Error('Current password is incorrect'));
                }

                const hashedPassword = await bcrypt.hash(newPassword, 10);
                db.run('UPDATE users SET password = ?, mustchangepassword = FALSE WHERE userid = ?',
                    [hashedPassword, userId], (err) => {
                        if (err) {
                            console.error(`DEBUG [AuthService.changePassword]: Update Error: ${err.message}`);
                            return reject(err);
                        }
                        resolve({ success: true, message: 'Password changed successfully' });
                    }
                );
            });
        });
    }

    // Refresh JWT token by re-reading user from DB (used after sandbox role changes)
    static async refreshToken(userId) {
        return new Promise((resolve, reject) => {
            db.get(`
                SELECT u.*, b.isSandboxActive, s.approvalStatus, s.legalName as supplierName
                FROM users u 
                LEFT JOIN buyers b ON u.buyerid = b.buyerid 
                LEFT JOIN suppliers s ON u.supplierid = s.supplierid
                WHERE u.userid = ?
            `, [userId], async (err, user) => {
                if (err) return reject(err);
                if (!user) return reject(new Error('User not found'));

                const memberships = await AuthService.getMemberships(userId);

                const token = jwt.sign({
                    userId: user.userid || user.userId,
                    username: user.username,
                    role: user.role,
                    supplierId: user.supplierid || user.supplierId,
                    buyerId: user.buyerid || user.buyerId,
                    subRole: user.subrole || user.subRole,
                    isSandboxActive: user.issandboxactive || user.isSandboxActive,
                    approvalStatus: user.approvalstatus || user.approvalStatus,
                    memberships,
                    mustChangePassword: user.mustchangepassword || user.mustChangePassword || false
                }, SECRET_KEY, { expiresIn: '1h' });

                const userDto = {
                    userId: user.userid || user.userId,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    subRole: user.subrole || user.subRole,
                    buyerId: user.buyerid || user.buyerId,
                    supplierId: user.supplierid || user.supplierId,
                    circleId: user.circleid || user.circleId,
                    createdAt: user.createdat || user.createdAt,
                    isSandboxActive: user.issandboxactive || user.isSandboxActive,
                    approvalStatus: user.approvalstatus || user.approvalStatus,
                    supplierName: user.suppliername || user.supplierName,
                    memberships,
                    mustChangePassword: user.mustchangepassword || user.mustChangePassword || false
                };

                resolve({ token, user: userDto });
            });
        });
    }
}

module.exports = AuthService;

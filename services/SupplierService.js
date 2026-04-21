const db = require('../config/database');
const WorkflowService = require('./WorkflowService');
const { isValidEmail } = require('../utils/validation');

class SupplierService {
    static async checkAvailability({ email, internalCode, buyerId } = {}) {
        const conflicts = {};

        const emailKey = email ? String(email).trim().toLowerCase() : null;
        const codeKey = internalCode ? String(internalCode).trim().toLowerCase() : null;

        if (!emailKey && !codeKey) return { available: true, conflicts: {} };

        // Check for collisions in suppliers and invitations.
        // We scope by buyerId where relevant, but email usually should be unique system-wide
        // for login purposes if they were to become a user.
        const suppliers = await new Promise((resolve, reject) => {
            db.all(
                `SELECT legalname, email, internalcode FROM suppliers
                 WHERE (?::text IS NOT NULL AND LOWER(email) = ?)
                    OR (?::text IS NOT NULL AND LOWER(internalcode) = ? AND (buyerid = ? OR buyerid IS NULL))`,
                [emailKey, emailKey, codeKey, codeKey, buyerId],
                (err, rows) => (err ? reject(err) : resolve(rows || []))
            );
        });

        for (const row of suppliers) {
            if (emailKey && String(row.email || '').toLowerCase() === emailKey) conflicts.email = true;
            if (codeKey && String(row.internalcode || '').toLowerCase() === codeKey) conflicts.internalCode = true;
        }

        const invitations = await new Promise((resolve, reject) => {
            db.all(
                `SELECT email, internalcode FROM invitations
                 WHERE status NOT IN ('REVOKED', 'EXPIRED', 'ACCEPTED')
                   AND ((?::text IS NOT NULL AND LOWER(email) = ?)
                    OR (?::text IS NOT NULL AND LOWER(internalcode) = ? AND (buyerid = ? OR buyerid IS NULL)))`,
                [emailKey, emailKey, codeKey, codeKey, buyerId],
                (err, rows) => (err ? reject(err) : resolve(rows || []))
            );
        });

        for (const row of invitations) {
            if (emailKey && String(row.email || '').toLowerCase() === emailKey) conflicts.email = true;
            if (codeKey && String(row.internalcode || '').toLowerCase() === codeKey) conflicts.internalCode = true;
        }

        return {
            available: Object.keys(conflicts).length === 0,
            conflicts,
        };
    }

    static async getAllSuppliers(user) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT 
                    supplierid, 
                    suppliercode,
                    legalname, 
                    businesstype, 
                    country, 
                    taxid, 
                    website, 
                    description, 
                    bankname, 
                    accountnumber, 
                    routingnumber, 
                    isactive, 
                    approvalstatus, 
                    submittedat, 
                    reviewedat, 
                    approvalnotes, 
                    createdbyuserid, 
                    createdbyusername, 
                    profilestatus,
                    documentstatus,
                    financestatus,
                    buyerid,
                    score,
                    risklevel,
                    assignedworkflowid,
                    (SELECT submissiontype FROM workflow_instances WHERE supplierid = s.supplierid ORDER BY instanceid DESC LIMIT 1) as submissiontype
                FROM suppliers s
            `;
            let params = [];

            const userRole = (user.role || '').toUpperCase();
            const buyerId = user.buyerId || user.buyerid;
            const userId = user.userId || user.userid;

            console.log(`[SupplierService.getAllSuppliers] Role: ${userRole}, BuyerId: ${buyerId}`);

            if (userRole === 'SUPPLIER' && user.memberships && user.memberships.length > 0) {
                const ids = user.memberships.map(m => m.supplierid || m.supplierId);
                const placeholders = ids.map(() => '?').join(',');
                query += ` WHERE s.supplierid IN (${placeholders})`;
                params = ids;
            } else if (buyerId) {
                query += " WHERE buyerid = ? OR createdbyuserid IN (SELECT userid FROM sdn_users WHERE buyerid = ?)";
                params.push(buyerId, buyerId);
            }

            db.all(query, params, (err, rows) => {
                if (err) return reject(err);
                // Normalize rows for consistency (Postgres returns lowercase keys)
                const normalizedRows = (rows || []).map(row => ({
                    ...row,
                    supplierId: row.supplierid !== undefined ? row.supplierid : row.supplierId,
                    supplierCode: row.suppliercode !== undefined ? row.suppliercode : row.supplierCode,
                    legalName: row.legalname !== undefined ? row.legalname : row.legalName,
                    businessType: row.businesstype !== undefined ? row.businesstype : row.businessType,
                    approvalStatus: row.approvalstatus !== undefined ? row.approvalstatus : row.approvalStatus,
                    profileStatus: row.profilestatus !== undefined ? row.profilestatus : row.profileStatus,
                    documentStatus: row.documentstatus !== undefined ? row.documentstatus : row.documentStatus,
                    financeStatus: row.financestatus !== undefined ? row.financestatus : row.financeStatus,
                    buyerId: row.buyerid !== undefined ? row.buyerid : row.buyerId,
                    score: row.score,
                    riskLevel: row.risklevel !== undefined ? row.risklevel : row.riskLevel,
                    assignedWorkflowId: row.assignedworkflowid !== undefined ? row.assignedworkflowid : row.assignedWorkflowId,
                    submissionType: row.submissiontype !== undefined ? row.submissiontype : row.submissionType
                }));
                resolve(normalizedRows);
            });
        });
    }

    static async createSupplier(data, user) {
        const AnalyticsService = require('./AnalyticsService');
        AnalyticsService.clearCache();

        return new Promise((resolve, reject) => {
            const { legalName, businessType, country } = data;
            const userRole = (user.role || '').toUpperCase();
            const buyerId = userRole === 'BUYER' ? user.buyerId : null;

            db.run(`INSERT INTO suppliers (legalname, businesstype, country, createdbyuserid, createdbyusername, buyerid) VALUES (?, ?, ?, ?, ?, ?)`,
                [legalName, businessType, country, user.userId, user.username, buyerId],
                function (err) {
                    if (err) return reject(err);
                    const newId = this.lastID;
                    const code = `SDN-SUP-${String(newId).padStart(3, '0')}`;

                    db.run("UPDATE suppliers SET suppliercode = ? WHERE supplierid = ?", [code, newId], (err) => {
                        if (err) return reject(err);

                        db.get("SELECT * FROM suppliers WHERE supplierid = ?", [newId], (err, row) => {
                            if (err) return reject(err);
                            // Normalize to camelCase
                            resolve({
                                ...row,
                                supplierId: row.supplierId || row.supplierid,
                                supplierCode: row.supplierCode || row.suppliercode,
                                legalName: row.legalName || row.legalname,
                                businessType: row.businessType || row.businesstype,
                                taxId: row.taxId || row.taxid,
                                approvalStatus: row.approvalStatus || row.approvalstatus,
                                buyerId: row.buyerId || row.buyerid
                            });
                        });
                    });
                }
            );
        });
    }

    static async getSupplierById(id, user) {
        const queries = {
            // Also fetch createdbyuserid so we can apply the same RBAC check as getAllSuppliers
            supplier: `SELECT s.*, u.buyerid as creator_buyerid FROM suppliers s LEFT JOIN sdn_users u ON s.createdbyuserid = u.userid WHERE s.supplierid = ?`,
            address: `SELECT * FROM addresses WHERE supplierid = ? ORDER BY isprimary DESC`,
            contacts: `SELECT userid, email, role, subrole FROM sdn_users WHERE supplierid = ?`
        };

        return new Promise((resolve, reject) => {
            db.get(queries.supplier, [id], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);

                // Normalize row early using robust pattern
                const s = {
                    ...row,
                    supplierId: row.supplierid !== undefined ? row.supplierid : row.supplierId,
                    buyerId: row.buyerid !== undefined ? row.buyerid : row.buyerId,
                    legalName: row.legalname !== undefined ? row.legalname : row.legalName,
                    businessType: row.businesstype !== undefined ? row.businesstype : row.businessType,
                    country: row.country,
                    approvalStatus: row.approvalstatus !== undefined ? row.approvalstatus : row.approvalStatus,
                    profileStatus: row.profilestatus !== undefined ? row.profilestatus : row.profileStatus,
                    documentStatus: row.documentstatus !== undefined ? row.documentstatus : row.documentStatus,
                    financeStatus: row.financestatus !== undefined ? row.financestatus : row.financeStatus,
                    supplierCode: row.suppliercode !== undefined ? row.suppliercode : row.supplierCode,
                    taxId: row.taxid !== undefined ? row.taxid : row.taxId,
                    bankName: row.bankname !== undefined ? row.bankname : row.bankName,
                    accountNumber: row.accountnumber !== undefined ? row.accountnumber : row.accountNumber,
                    routingNumber: row.routingnumber !== undefined ? row.routingnumber : row.routingNumber,
                    website: row.website,
                    description: row.description,
                    gstin: row.gstin,
                    isGstRegistered: (row.isgstregistered !== undefined ? row.isgstregistered : row.isGstRegistered) === 1 || (row.isgstregistered === true) || (row.isGstRegistered === true),
                    score: row.score,
                    riskLevel: row.risklevel || row.riskLevel,
                    assignedWorkflowId: row.assignedworkflowid || row.assignedWorkflowId
                };

                // Security Check: RBAC for different user roles
                if (user && user.role !== 'ADMIN') {
                    if (user.role === 'SUPPLIER') {
                        // Supplier users can only access their own supplier or any in their memberships
                        const currentId = parseInt(id);
                        const memberships = user.memberships || [];
                        const isMember = memberships.some(m => parseInt(m.supplierId || m.supplierid) === currentId);

                        if (parseInt(user.supplierId) !== currentId && !isMember) {
                            console.warn(`[SupplierService] Access Denied: Supplier User ${user.userId} (Supplier: ${user.supplierId}, Memberships: ${memberships.length}) tried to access Supplier ${id}`);
                            return resolve(null); // Return null to simulate 404
                        }
                    } else if (user.role === 'BUYER' && user.buyerId) {
                        // Mirror the same dual-path RBAC used in getAllSuppliers:
                        //   1. Supplier's buyerid matches the logged-in buyer (direct ownership)
                        //   2. Supplier was created by a user who belongs to this buyer (createdbyuserid path)
                        // This ensures the detail page never blocks a supplier that is visible in the directory.
                        const supplierBuyerId = parseInt(s.buyerId);
                        const userBuyerId = parseInt(user.buyerId || user.buyerid);
                        const userId = parseInt(user.userId || user.userid);
                        const creatorBuyerId = parseInt(row.creator_buyerid); // from JOIN on createdbyuserid

                        const ownedByBuyer    = !isNaN(supplierBuyerId) && supplierBuyerId === userBuyerId;
                        const createdByBuyer  = !isNaN(creatorBuyerId)  && creatorBuyerId  === userBuyerId;
                        const unassigned      = isNaN(supplierBuyerId); // buyerid is NULL in DB

                        if (!ownedByBuyer && !createdByBuyer && !unassigned) {
                            console.warn(`[SupplierService] Access Denied: Buyer User ${user.userId} (Buyer: ${userBuyerId}) tried to access Supplier ${id} (Buyer: ${supplierBuyerId}, CreatorBuyer: ${creatorBuyerId})`);
                            return resolve({ __accessDenied: true });
                        }
                        if (unassigned) {
                            console.warn(`[SupplierService] Warning: Supplier ${id} has no buyerid. Allowing Buyer ${userBuyerId} access via directory parity.`);
                        }
                    }
                }

                const supplier = s;

                Promise.all([
                    new Promise(res => db.all(queries.address, [id], (e, r) => res(r || []))),
                    new Promise(res => db.all(queries.contacts, [id], (e, r) => res(r || [])))
                ]).then(async ([addresses, contacts]) => {
                    // Logic to normalize keys and flatten structures matching original index.js logic
                    const s = supplier;
                    const a = addresses.length > 0 ? addresses[0] : {};
                    const b = {}; // bank details inside supplier table basically

                    const fullProfile = {
                        ...s,
                        supplierId: s.supplierId || s.supplierid,
                        supplierCode: s.supplierCode || s.suppliercode,
                        legalName: s.legalName || s.legalname,
                        businessType: s.businessType || s.businesstype,
                        taxId: s.taxId || s.taxid,
                        score: s.score,
                        riskLevel: s.riskLevel || s.risklevel,
                        website: s.website || s.website, // explicit fallback not strictly needed for single word but safe
                        description: s.description || s.description,
                        gstin: s.gstin || s.gstin,
                        isGstRegistered: (s.isgstregistered !== undefined ? s.isgstregistered : s.isGstRegistered) === 1 || (s.isgstregistered === true) || (s.isGstRegistered === true),
                        approvalStatus: s.approvalstatus || s.approvalStatus,

                        // Flatten primary address
                        addressLine1: a.addressLine1 || a.addressline1,
                        addressLine2: a.addressLine2 || a.addressline2,
                        city: a.city,
                        state: a.state || a.stateprovince,
                        postalCode: a.postalCode || a.postalcode,
                        country: a.country || s.country,

                        // Flatten bank
                        bankName: s.bankName || s.bankname,
                        accountNumber: s.accountNumber || s.accountnumber,
                        routingNumber: s.routingNumber || s.routingnumber,

                        addresses: addresses.map(addr => ({
                            addressId: addr.addressId || addr.addressid,
                            addressType: addr.addressType || addr.addresstype,
                            addressLine1: addr.addressLine1 || addr.addressline1,
                            addressLine2: addr.addressLine2 || addr.addressline2,
                            city: addr.city,
                            state: addr.state || addr.stateprovince,
                            postalCode: addr.postalCode || addr.postalcode,
                            country: addr.country || s.country,
                            isPrimary: (addr.isPrimary === 1 || addr.isPrimary === true || addr.isprimary === true),
                        })),

                        contacts: contacts.map(c => ({
                            userId: c.userId || c.userid,
                            email: c.email,
                            role: c.role,
                            subRole: c.subRole || c.subrole
                        })),

                        addressDetails: a,
                        bankDetails: null,
                        bankAccounts: [] // Placeholder, will be populated if needed
                    };

                    // Fetch Bank Accounts from separate table
                    const bAccounts = await new Promise(res => db.all(`SELECT * FROM bank_accounts WHERE supplierid = ?`, [id], (e, r) => res(r || [])));
                    fullProfile.bankAccounts = bAccounts.map(b => ({
                        bankId: b.bankid || b.bankId,
                        bankName: b.bankname || b.bankName,
                        accountNumber: b.accountnumber || b.accountNumber,
                        routingNumber: b.routingnumber || b.routingNumber,
                        swiftCode: b.swiftcode || b.swiftCode,
                        currency: b.currency,
                        isPrimary: !!(b.isprimary || b.isPrimary),
                        status: b.status
                    }));

                    // For backward compatibility / profile view, use the primary bank account if available
                    const primaryBank = fullProfile.bankAccounts.find(ba => ba.isPrimary) || fullProfile.bankAccounts[0];
                    if (primaryBank) {
                        fullProfile.bankName = primaryBank.bankName;
                        fullProfile.accountNumber = primaryBank.accountNumber;
                        fullProfile.routingNumber = primaryBank.routingNumber;
                    }

                    resolve(fullProfile);
                }).catch(reject);
            });
        });
    }

    // --- Bank Accounts ---
    static async getBankAccounts(supplierId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM bank_accounts WHERE supplierid = ?`, [supplierId], (err, rows) => {
                if (err) return reject(err);
                const normalized = (rows || []).map(row => ({
                    ...row,
                    bankId: row.bankid || row.bankId,
                    supplierId: row.supplierid || row.supplierId,
                    bankName: row.bankname || row.bankName,
                    accountNumber: row.accountnumber || row.accountNumber,
                    routingNumber: row.routingnumber || row.routingNumber,
                    swiftCode: row.swiftcode || row.swiftCode,
                    currency: row.currency,
                    isPrimary: !!(row.isprimary || row.isPrimary),
                    status: row.status
                }));

                if (normalized.length > 0) {
                    return resolve(normalized);
                }

                // Fallback: onboarding used PUT /api/suppliers/:id which persists
                // bank details into legacy columns on the suppliers table, not
                // into the normalized bank_accounts table. If bank_accounts is
                // empty but the supplier row has bank info, surface that data
                // (and opportunistically migrate it into bank_accounts so
                // subsequent reads/updates use the canonical table).
                db.get(
                    `SELECT supplierid, bankname, accountnumber, routingnumber FROM suppliers WHERE supplierid = ?`,
                    [supplierId],
                    (e2, sRow) => {
                        if (e2 || !sRow) return resolve([]);
                        const bankName = sRow.bankname || sRow.bankName;
                        const accountNumber = sRow.accountnumber || sRow.accountNumber;
                        const routingNumber = sRow.routingnumber || sRow.routingNumber;
                        if (!bankName && !accountNumber) return resolve([]);

                        // Attempt migration (best-effort; return the synthetic
                        // account either way so the UI shows the data now).
                        db.all(
                            `INSERT INTO bank_accounts (supplierid, bankname, accountnumber, routingnumber, currency, isprimary, status)
                             VALUES (?, ?, ?, ?, 'USD', TRUE, 'ACTIVE') RETURNING *`,
                            [supplierId, bankName, accountNumber, routingNumber || null],
                            (insErr, insRows) => {
                                const row = (insRows && insRows[0]) || null;
                                const account = row ? {
                                    ...row,
                                    bankId: row.bankid || row.bankId,
                                    supplierId: row.supplierid || row.supplierId,
                                    bankName: row.bankname || row.bankName,
                                    accountNumber: row.accountnumber || row.accountNumber,
                                    routingNumber: row.routingnumber || row.routingNumber,
                                    swiftCode: row.swiftcode || row.swiftCode,
                                    currency: row.currency,
                                    isPrimary: !!(row.isprimary || row.isPrimary),
                                    status: row.status
                                } : {
                                    // Migration failed — still surface a synthetic row
                                    // so the onboarding bank details are visible.
                                    bankId: 0,
                                    supplierId: Number(supplierId),
                                    bankName,
                                    accountNumber,
                                    routingNumber: routingNumber || '',
                                    swiftCode: '',
                                    currency: 'USD',
                                    isPrimary: true,
                                    status: 'ACTIVE'
                                };
                                resolve([account]);
                            }
                        );
                    }
                );
            });
        });
    }

    static async createBankAccount(supplierId, data, user) {
        const { bankName, accountNumber, routingNumber, swiftCode, currency, isPrimary } = data;
        const ChangeRequestService = require('./ChangeRequestService');
        return new Promise(async (resolve, reject) => {
            const current = await new Promise(res => db.get("SELECT approvalstatus FROM suppliers WHERE supplierid = ?", [supplierId], (err, row) => res(row)));
            const status = (current?.approvalstatus || current?.approvalStatus || '').toUpperCase();

            if (status === 'APPROVED') {
                const payload = { ...data };
                try {
                    const result = await ChangeRequestService.createChangeRequest(supplierId, { bank_account: JSON.stringify(payload) }, user || { userId: 0, role: 'SYSTEM' });
                    return resolve(result);
                } catch (e) {
                    return reject(e);
                }
            }

            db.run(`INSERT INTO bank_accounts (supplierid, bankname, accountnumber, routingnumber, swiftcode, currency, isprimary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [supplierId, bankName, accountNumber, routingNumber || null, swiftCode || null, currency || 'USD', isPrimary ? 1 : 0],
                function (err) {
                    if (err) return reject(err);
                    const newId = this.lastID;
                    db.get("SELECT * FROM bank_accounts WHERE bankid = ?", [newId], (err, row) => {
                        if (err) return reject(err);
                        resolve({
                            ...row,
                            bankId: row.bankid || row.bankId,
                            supplierId: row.supplierid || row.supplierId,
                            bankName: row.bankname || row.bankName,
                            accountNumber: row.accountnumber || row.accountNumber,
                            routingNumber: row.routingnumber || row.routingNumber,
                            swiftCode: row.swiftcode || row.swiftCode,
                            currency: row.currency,
                            isPrimary: !!(row.isprimary || row.isPrimary),
                            status: row.status
                        });
                    });
                }
            );
        });
    }

    static async updateBankAccount(bankId, data, user) {
        const ChangeRequestService = require('./ChangeRequestService');
        return new Promise(async (resolve, reject) => {
            // Get supplierId
            const bankAcc = await new Promise(res => db.get("SELECT supplierid FROM bank_accounts WHERE bankid = ?", [bankId], (err, row) => res(row)));
            if (!bankAcc) return reject(new Error("Bank account not found"));
            const sId = bankAcc.supplierid || bankAcc.supplierId;

            const current = await new Promise(res => db.get("SELECT approvalstatus FROM suppliers WHERE supplierid = ?", [sId], (err, row) => res(row)));
            const status = (current?.approvalstatus || current?.approvalStatus || '').toUpperCase();

            if (status === 'APPROVED') {
                const payload = {
                    bankId,
                    ...data
                };
                const result = await ChangeRequestService.createChangeRequest(sId, { bank_account: JSON.stringify(payload) }, user || { userId: 0, role: 'SYSTEM' });
                return resolve(result);
            }

            const { bankName, accountNumber, routingNumber, swiftCode, currency, isPrimary, status: bankStatus } = data;
            db.run(`UPDATE bank_accounts SET bankname = COALESCE(?, bankname), accountnumber = COALESCE(?, accountnumber), routingnumber = ?, swiftcode = ?, currency = COALESCE(?, currency), isprimary = COALESCE(?, isprimary), status = COALESCE(?, status), updatedat = CURRENT_TIMESTAMP WHERE bankid = ?`,
                [bankName || null, accountNumber || null, routingNumber || null, swiftCode || null, currency || null, isPrimary !== undefined ? (isPrimary ? 1 : 0) : null, bankStatus || null, bankId],
                function (err) {
                    if (err) return reject(err);
                    db.get("SELECT * FROM bank_accounts WHERE bankid = ?", [bankId], (err, row) => {
                        if (err) return reject(err);
                        resolve({
                            ...row,
                            bankId: row.bankid || row.bankId,
                            supplierId: row.supplierid || row.supplierId,
                            bankName: row.bankname || row.bankName,
                            accountNumber: row.accountnumber || row.accountNumber,
                            routingNumber: row.routingnumber || row.routingNumber,
                            swiftCode: row.swiftcode || row.swiftCode,
                            currency: row.currency,
                            isPrimary: !!(row.isprimary || row.isPrimary),
                            status: row.status
                        });
                    });
                }
            );
        });
    }

    static async deleteBankAccount(bankId) {
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM bank_accounts WHERE bankid = ?", [bankId], (err) => err ? reject(err) : resolve());
        });
    }

    static async updateSupplier(id, data, user) { // Added user param
        const AnalyticsService = require('./AnalyticsService');
        AnalyticsService.clearCache();

        const ChangeRequestService = require('./ChangeRequestService');

        return new Promise(async (resolve, reject) => {
            // Check current status
            const current = await new Promise(res => {
                db.get("SELECT approvalstatus, buyerid FROM suppliers WHERE supplierid = ?", [id], (err, row) => res(row));
            });

            if (!current) return reject(new Error("Supplier not found"));

            // INTERCEPTION: If Approved, create Change Request
            const status = (current.approvalstatus || current.approvalStatus || '').toUpperCase();
            console.log(`[SupplierService] Supplier ${id} status: "${status}"`);
            if (status === 'APPROVED') {
                console.log(`[SupplierService] Intercepting update for APPROVED supplier ${id}. Creating Change Request.`);
                try {
                    const result = await ChangeRequestService.createChangeRequest(id, data, user || { userId: 0, role: 'SYSTEM' });
                    return resolve(result); // Return the change request result directly
                } catch (e) {
                    console.error("Change Request Creation Failed:", e);
                    return reject(e);
                }
            }

            // Check if supplier is currently under active review (Legacy/Draft flow)
            const activeWorkflow = await new Promise(res => {

                require('../config/database').get(
                    `SELECT wi.instanceid, wi.status FROM workflow_instances wi WHERE wi.supplierid = ? AND wi.status = 'PENDING'`,
                    [id],
                    (err, row) => res(row)
                );
            });

            if (activeWorkflow) {
                return reject(new Error("Cannot edit profile while under active review. Please wait for the current approval cycle to complete or request a rework."));
            }

            const { legalName, businessType, country, taxId, website, description, bankName, accountNumber, routingNumber, gstin, isGstRegistered, approvalStatus, submittedAt } = data;

            const query = `
                UPDATE suppliers
                SET legalname = COALESCE(?, legalname),
                    businesstype = COALESCE(?, businesstype),
                    country = COALESCE(?, country),
                    taxid = COALESCE(?, taxid),
                    website = COALESCE(?, website),
                    description = COALESCE(?, description),
                    bankname = COALESCE(?, bankname),
                    accountnumber = COALESCE(?, accountnumber),
                    routingnumber = COALESCE(?, routingnumber),
                    gstin = COALESCE(?, gstin),
                    isgstregistered = COALESCE(?, isgstregistered),
                    approvalstatus = COALESCE(?, approvalstatus),
                    submittedat = COALESCE(?, submittedat),
                    score = COALESCE(?, score),
                    risklevel = COALESCE(?, risklevel)
                WHERE supplierid = ?
            `;

            db.run(query, [
                legalName || null, businessType || null, country || null, taxId || null,
                website || null, description || null, bankName || null, accountNumber || null,
                routingNumber || null, gstin || null, isGstRegistered !== undefined ? isGstRegistered : null,
                approvalStatus || null, submittedAt || null,
                data.score !== undefined ? data.score : null,
                data.riskLevel || null,
                id
            ], function (err) {
                if (err) return reject(err);

                const profileFields = [legalName, businessType, country, taxId, website, description, bankName, accountNumber, routingNumber, gstin, isGstRegistered];
                const hasUpdates = profileFields.some(f => f !== undefined);

                // Automatic transition to SUBMITTED upon any profile update is removed
                // to allow explicit final submission by the user.

                // Sync bank_accounts table when bank fields are provided during
                // onboarding or regular profile edits (non-APPROVED flow).
                // The onboarding flow sends bankName/accountNumber/routingNumber
                // via PUT /api/suppliers/:id, which previously only hit the
                // legacy suppliers columns. To keep the normalized table in
                // sync (so the portal's /bank-accounts endpoint surfaces the
                // data), upsert a primary bank_accounts row here.
                const syncBankAccounts = (done) => {
                    if (!bankName && !accountNumber && !routingNumber) return done();

                    db.get(
                        `SELECT bankid, bankname, accountnumber, routingnumber FROM bank_accounts
                         WHERE supplierid = ? AND isprimary = TRUE
                         ORDER BY bankid ASC LIMIT 1`,
                        [id],
                        (selErr, existing) => {
                            if (selErr) {
                                console.warn('[SupplierService.updateSupplier] bank_accounts select failed:', selErr.message);
                                return done();
                            }

                            if (existing && (existing.bankid || existing.bankId)) {
                                const bId = existing.bankid || existing.bankId;
                                db.run(
                                    `UPDATE bank_accounts
                                     SET bankname = COALESCE(?, bankname),
                                         accountnumber = COALESCE(?, accountnumber),
                                         routingnumber = COALESCE(?, routingnumber),
                                         updatedat = CURRENT_TIMESTAMP
                                     WHERE bankid = ?`,
                                    [bankName || null, accountNumber || null, routingNumber || null, bId],
                                    (uErr) => {
                                        if (uErr) console.warn('[SupplierService.updateSupplier] bank_accounts update failed:', uErr.message);
                                        done();
                                    }
                                );
                            } else {
                                // No primary row yet — insert one using the
                                // currently-known values, falling back to the
                                // freshly-written suppliers row columns so we
                                // never insert all-NULLs.
                                db.get(
                                    `SELECT bankname, accountnumber, routingnumber FROM suppliers WHERE supplierid = ?`,
                                    [id],
                                    (sErr, sRow) => {
                                        const effBank = bankName || (sRow && (sRow.bankname || sRow.bankName));
                                        const effAcct = accountNumber || (sRow && (sRow.accountnumber || sRow.accountNumber));
                                        const effRout = routingNumber || (sRow && (sRow.routingnumber || sRow.routingNumber));
                                        if (!effBank && !effAcct) return done();

                                        db.run(
                                            `INSERT INTO bank_accounts (supplierid, bankname, accountnumber, routingnumber, currency, isprimary, status)
                                             VALUES (?, ?, ?, ?, 'USD', TRUE, 'ACTIVE')`,
                                            [id, effBank || null, effAcct || null, effRout || null],
                                            (iErr) => {
                                                if (iErr) console.warn('[SupplierService.updateSupplier] bank_accounts insert failed:', iErr.message);
                                                done();
                                            }
                                        );
                                    }
                                );
                            }
                        }
                    );
                };

                syncBankAccounts(() => {
                    db.get("SELECT * FROM suppliers WHERE supplierid = ?", [id], (err, row) => resolve(row));
                });
            });
        });
    }

    // --- Sub-resources ---
    static async getContacts(supplierId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT contactid, supplierid, contacttype, firstname, lastname, email, phone, isprimary, designation FROM contacts WHERE supplierid = ?`, [supplierId], (err, rows) => {
                if (err) return reject(err);
                const normalized = (rows || []).map(row => ({
                    ...row,
                    contactId: row.contactid || row.contactId,
                    supplierId: row.supplierid || row.supplierId,
                    contactType: row.contacttype || row.contactType,
                    firstName: row.firstname || row.firstName,
                    lastName: row.lastname || row.lastName,
                    isPrimary: !!(row.isprimary || row.isPrimary),
                    designation: row.designation
                }));
                resolve(normalized);
            });
        });
    }

    static async createContact(supplierId, data, user) {
        const { contactType, firstName, lastName, email, phone, isPrimary, designation } = data;
        const ChangeRequestService = require('./ChangeRequestService');

        return new Promise(async (resolve, reject) => {
            if (email !== undefined && !isValidEmail(email)) {
                return reject(new Error("Invalid email format"));
            }

            const current = await new Promise(res => db.get("SELECT approvalstatus FROM suppliers WHERE supplierid = ?", [supplierId], (err, row) => res(row)));
            const status = (current?.approvalstatus || current?.approvalStatus || '').toUpperCase();

            if (status === 'APPROVED') {
                const payload = { ...data };
                try {
                    const result = await ChangeRequestService.createChangeRequest(supplierId, { contact: JSON.stringify(payload) }, user || { userId: 0, role: 'SYSTEM' });
                    return resolve(result);
                } catch (e) {
                    return reject(e);
                }
            }

            db.all(`INSERT INTO contacts (supplierid, contacttype, firstname, lastname, email, phone, isprimary, designation) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
                [supplierId, contactType, firstName, lastName, email, phone, isPrimary ? true : false, designation || null],
                function (err, rows) {
                    if (err) return reject(err);
                    const row = rows[0];
                    if (!row) return reject(new Error("Failed to create contact"));
                    resolve({
                        ...row,
                        contactId: row.contactid || row.contactId,
                        supplierId: row.supplierid || row.supplierId,
                        contactType: row.contacttype || row.contactType,
                        firstName: row.firstname || row.firstName,
                        lastName: row.lastname || row.lastName,
                        isPrimary: !!(row.isprimary || row.isPrimary),
                        designation: row.designation
                    });
                }
            );
        });
    }

    static async updateContact(contactId, data, user) {
        const ChangeRequestService = require('./ChangeRequestService');
        return new Promise(async (resolve, reject) => {
            // Get supplierId for this contact
            const contact = await new Promise(res => db.get("SELECT supplierid FROM contacts WHERE contactid = ?", [contactId], (err, row) => res(row)));
            if (!contact) return reject(new Error("Contact not found"));
            const sId = contact.supplierid || contact.supplierId;

            const current = await new Promise(res => db.get("SELECT approvalStatus FROM suppliers WHERE supplierId = ?", [sId], (err, row) => res(row)));
            const status = current?.approvalstatus || current?.approvalStatus;

            if (status === 'APPROVED') {
                const result = await ChangeRequestService.createChangeRequest(sId, data, user || { userId: 0, role: 'SYSTEM' });
                return resolve(result);
            }

            const { contactType, firstName, lastName, email, phone, isPrimary, designation } = data;

            if (email !== undefined && !isValidEmail(email)) {
                return reject(new Error("Invalid email format"));
            }

            db.run(`UPDATE contacts SET contacttype = ?, firstname = ?, lastname = ?, email = ?, phone = ?, isprimary = ?, designation = ? WHERE contactid = ?`,
                [contactType, firstName, lastName, email, phone, !!isPrimary, designation || null, contactId],
                (err) => {
                    if (err) return reject(err);
                    db.get("SELECT * FROM contacts WHERE contactid = ?", [contactId], (err, row) => {
                        if (err) return reject(err);
                        resolve({
                            ...row,
                            contactId: row.contactid || row.contactId,
                            supplierId: row.supplierid || row.supplierId,
                            contactType: row.contacttype || row.contactType,
                            firstName: row.firstname || row.firstName,
                            lastName: row.lastname || row.lastName,
                            isPrimary: !!(row.isprimary || row.isPrimary),
                            designation: row.designation
                        });
                    });
                }
            );
        });
    }

    static async deleteContact(contactId) {
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM contacts WHERE contactid = ?", [contactId], (err) => err ? reject(err) : resolve());
        });
    }

    static async getAddresses(supplierId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT addressid, supplierid, addresstype, addressline1, addressline2, city, stateprovince, postalcode, country, isprimary FROM addresses WHERE supplierid = ?`, [supplierId], (err, rows) => {
                if (err) return reject(err);
                const normalized = (rows || []).map(row => ({
                    ...row,
                    addressId: row.addressid || row.addressId,
                    supplierId: row.supplierid || row.supplierId,
                    addressType: row.addresstype || row.addressType,
                    addressLine1: row.addressline1 || row.addressLine1,
                    addressLine2: row.addressline2 || row.addressLine2,
                    city: row.city,
                    stateProvince: row.stateprovince || row.stateProvince,
                    postalCode: row.postalcode || row.postalCode,
                    country: row.country,
                    isPrimary: !!(row.isprimary || row.isPrimary)
                }));
                resolve(normalized);
            });
        });
    }

    static async createAddress(supplierId, data, user) {
        const { addressType, addressLine1, city, stateProvince, country, isPrimary, postalCode } = data;
        const ChangeRequestService = require('./ChangeRequestService');

        return new Promise(async (resolve, reject) => {
            const current = await new Promise(res => db.get("SELECT approvalstatus FROM suppliers WHERE supplierid = ?", [supplierId], (err, row) => res(row)));
            const status = (current?.approvalstatus || current?.approvalStatus || '').toUpperCase();

            // PENDING/DRAFT suppliers save directly to DB
            if (status === 'APPROVED') {
                const payload = { ...data };
                try {
                    const result = await ChangeRequestService.createChangeRequest(supplierId, { address: JSON.stringify(payload) }, user || { userId: 0, role: 'SYSTEM' });
                    return resolve(result);
                } catch (e) {
                    return reject(e);
                }
            }

            db.all(`INSERT INTO addresses (supplierid, addresstype, addressline1, city, stateprovince, country, isprimary, postalcode) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
                [supplierId, addressType, addressLine1, city, stateProvince || null, country, isPrimary ? true : false, postalCode || null],
                function (err, rows) {
                    if (err) return reject(err);
                    const row = rows[0];
                    if (!row) return reject(new Error("Failed to create address"));
                    resolve({
                        ...row,
                        addressId: row.addressid || row.addressId,
                        supplierId: row.supplierid || row.supplierId,
                        addressType: row.addresstype || row.addressType,
                        addressLine1: row.addressline1 || row.addressLine1,
                        city: row.city,
                        stateProvince: row.stateprovince || row.stateProvince,
                        country: row.country,
                        isPrimary: !!(row.isprimary || row.isPrimary),
                        postalCode: row.postalcode || row.postalCode
                    });
                }
            );
        });
    }

    static async updateAddress(addressId, data, user) {
        const ChangeRequestService = require('./ChangeRequestService');
        return new Promise(async (resolve, reject) => {
            // Get supplierId
            const addr = await new Promise(res => db.get("SELECT supplierid FROM addresses WHERE addressid = ?", [addressId], (err, row) => res(row)));
            if (!addr) return reject(new Error("Address not found"));
            const sId = addr.supplierid || addr.supplierId;

            const current = await new Promise(res => db.get("SELECT approvalStatus FROM suppliers WHERE supplierId = ?", [sId], (err, row) => res(row)));
            const status = current?.approvalstatus || current?.approvalStatus;

            if (status === 'APPROVED') {
                const result = await ChangeRequestService.createChangeRequest(sId, data, user || { userId: 0, role: 'SYSTEM' });
                return resolve(result);
            }

            const { addressType, addressLine1, city, country, isPrimary, postalCode } = data;
            db.run(`UPDATE addresses SET addresstype = ?, addressline1 = ?, city = ?, country = ?, isprimary = ?, postalcode = ? WHERE addressid = ?`,
                [addressType, addressLine1, city, country, !!isPrimary, postalCode || null, addressId],
                function (err) {
                    if (err) return reject(err);
                    db.get("SELECT * FROM addresses WHERE addressid = ?", [addressId], (err, row) => {
                        if (err) return reject(err);
                        resolve({
                            ...row,
                            addressId: row.addressid || row.addressId,
                            supplierId: row.supplierid || row.supplierId,
                            addressType: row.addresstype || row.addressType,
                            addressLine1: row.addressline1 || row.addressLine1,
                            city: row.city,
                            country: row.country,
                            isPrimary: !!(row.isprimary || row.isPrimary),
                            postalCode: row.postalcode || row.postalCode
                        });
                    });
                }
            );
        });
    }

    static async deleteAddress(addressId) {
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM addresses WHERE addressid = ?", [addressId], (err) => err ? reject(err) : resolve());
        });
    }

    // --- Reviews ---
    static async getReviews(supplierId) {
        return new Promise((resolve, reject) => {
            db.all("SELECT * FROM reviews WHERE supplierid = ?", [supplierId], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    static async submitForReview(supplierId) {
        const AnalyticsService = require('./AnalyticsService');
        AnalyticsService.clearCache();

        try {
            // 1. Get current status to determine submission type
            const current = await new Promise((resolve, reject) => {
                db.get(`SELECT approvalstatus, buyerid, legalname FROM suppliers WHERE supplierid = ?`, [supplierId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            const oldStatus = (current?.approvalstatus || current?.approvalStatus || 'DRAFT').toUpperCase();
            const submissionType = (oldStatus === 'DRAFT' || oldStatus === 'REJECTED') ? 'INITIAL' : 'RESUBMISSION';
            // REWORK_REQUIRED is treated as RESUBMISSION (existing workflow instance will be resumed + reset)

            console.log(`[submitForReview] Current status: ${oldStatus}, Determined submissionType: ${submissionType}`);

            // 2. Update status to SUBMITTED
            await new Promise((resolve, reject) => {
                db.run(`UPDATE suppliers SET approvalstatus = 'SUBMITTED', submittedat = CURRENT_TIMESTAMP WHERE supplierid = ?`, [supplierId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // 3. Determine BuyerId
            let bid = current && (current.buyerid || current.buyerId);
            const supplierName = current && (current.legalName || current.legalname);

            if (!bid) {
                console.log(`[submitForReview] BuyerId missing for supplier ${supplierId}. Attempting to resolve from invitations...`);
                try {
                    bid = await new Promise((resolveInv) => {
                        db.get(
                            `SELECT i.buyerid 
                             FROM sdn_users u 
                             JOIN invitations i ON u.email = i.email 
                             WHERE u.supplierid = ? AND i.buyerid IS NOT NULL 
                             ORDER BY i.createdat DESC LIMIT 1`,
                            [supplierId],
                            (err, invRow) => resolveInv(invRow ? (invRow.buyerid || invRow.buyerId) : null)
                        );
                    });

                    if (bid) {
                        console.log(`[submitForReview] Found BuyerId ${bid} from invitation. Updating supplier record.`);
                        await new Promise(r => db.run("UPDATE suppliers SET buyerid = ? WHERE supplierid = ?", [bid, supplierId], r));
                    }
                } catch (healingErr) {
                    console.error("[submitForReview] Error resolving buyerId:", healingErr);
                }
            }

            // 4. Initiate Workflow
            if (bid) {
                try {
                    const workflowId = await WorkflowService.getSupplierWorkflow(supplierId, bid);
                    if (workflowId) {
                        await WorkflowService.initiateWorkflow(supplierId, workflowId, submissionType);
                        console.log(`[submitForReview] Initiated workflow ${workflowId} (${submissionType}) for supplier ${supplierId}`);

                        // Send Notification to Buyer
                        const NotificationService = require('./NotificationService');
                        await NotificationService.createNotification({
                            type: 'SUBMISSION_RECEIVED',
                            message: `Supplier ${supplierName} has ${submissionType === 'INITIAL' ? 'submitted their profile' : 'resubmitted their details'} for review.`,
                            entityId: supplierId,
                            recipientRole: 'BUYER',
                            supplierId: supplierId,
                            buyerId: bid
                        });
                    } else {
                        console.warn(`[submitForReview] No active workflow found for buyer ${bid}`);
                    }
                } catch (e) {
                    console.error("Failed to initiate workflow on submit:", e);
                }
            } else {
                console.warn(`[submitForReview] Still unable to determine BuyerId for supplier ${supplierId}. Workflow not initiated.`);
            }

            return { message: "Submitted for review" };
        } catch (err) {
            console.error("Critical error in submitForReview:", err);
            throw err;
        }
    }

    static async processReviewDecision(supplierId, userId, username, buyerId, data) {
        const AnalyticsService = require('./AnalyticsService');
        AnalyticsService.clearCache();

        return new Promise((resolve, reject) => {
            const { decision, comments, section } = data;
            const validSections = ['PROFILE', 'DOCUMENTS', 'FINANCE'];
            const targetSection = validSections.includes(section) ? section : 'PROFILE';

            let status = 'PENDING';
            if (decision === 'APPROVE') status = 'APPROVED';
            else if (decision === 'REJECT') status = 'REJECTED';
            else if (decision === 'REQUEST_REWORK') status = 'REWORK_REQUIRED';

            const colMap = { 'PROFILE': 'profileStatus', 'DOCUMENTS': 'documentStatus', 'FINANCE': 'financeStatus' };
            const targetCol = colMap[targetSection];

            db.run(`UPDATE suppliers SET ${targetCol} = ? WHERE supplierid = ?`, [status, supplierId], (err) => {
                if (err) return reject(err);

                db.get("SELECT profilestatus, documentstatus, financestatus, approvalstatus FROM suppliers WHERE supplierid = ?", [supplierId], (err, row) => {
                    if (err) return reject(err);

                    const pStatus = row.profilestatus || row.profileStatus;
                    const dStatus = row.documentstatus || row.documentStatus;
                    const fStatus = row.financestatus || row.financeStatus;
                    const prevOverallStatus = row.approvalstatus || row.approvalStatus;

                    let newOverallStatus = 'IN_REVIEW';
                    const statuses = [pStatus, dStatus, fStatus];

                    if (statuses.includes('REJECTED')) newOverallStatus = 'REJECTED';
                    else if (statuses.includes('REWORK_REQUIRED')) newOverallStatus = 'REWORK_REQUIRED';
                    else if (statuses.every(s => s === 'APPROVED')) newOverallStatus = 'APPROVED';

                    db.run(`UPDATE suppliers SET approvalstatus = ?, reviewedat = CURRENT_TIMESTAMP WHERE supplierid = ?`,
                        [newOverallStatus, supplierId],
                        (err) => {
                            if (err) return reject(err);
                            db.run(`INSERT INTO reviews (supplierid, reviewdecision, reviewcomments, section, previousstatus, newstatus, reviewedbyuserid, reviewedbyusername) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                [supplierId, decision, comments, targetSection, prevOverallStatus || 'SUBMITTED', status, userId, username],
                                function (err) {
                                    if (err) return reject(err);
                                    db.get("SELECT * FROM reviews WHERE reviewid = ?", [this.lastID], (err, row) => resolve(row));
                                }
                            );
                        }
                    );
                });
            });
        });
    }

    static async getDashboardAlerts(supplierId) {
        return new Promise(async (resolve, reject) => {
            try {
                const alerts = [];
                // 1. Expiring Documents
                const expiringDocs = await new Promise((res, rej) => {
                    db.get(`
                        SELECT COUNT(*) as count 
                        FROM documents 
                        WHERE supplierid = ? 
                          AND expirydate <= CURRENT_DATE + INTERVAL '30 days'
                          AND expirydate >= CURRENT_DATE
                    `, [supplierId], (err, row) => err ? rej(err) : res(row?.count || 0));
                });
                if (expiringDocs > 0) {
                    alerts.push({
                        type: 'DOCUMENT_EXPIRY',
                        severity: 'WARNING',
                        count: parseInt(expiringDocs),
                        message: `You have ${expiringDocs} documents expiring in the next 30 days. Please update them.`
                    });
                }
                resolve({
                    alerts,
                    expiringDocuments: expiringDocs > 0 ? [{ type: 'DOCUMENT_EXPIRY', count: expiringDocs }] : []
                });
            } catch (err) { reject(err); }
        });
    }
    static async getDashboardAnalytics(supplierId, user) {
        return new Promise(async (resolve, reject) => {
            try {
                // If multi-buyer supplier user, they see aggregated data from all their memberships
                let memberships = user.memberships || [];

                // Fallback: Fetch memberships if not in token
                if (memberships.length === 0 && user.role === 'SUPPLIER') {
                    memberships = await new Promise((res) => {
                        db.all("SELECT supplierid FROM user_supplier_memberships WHERE userid = ?", [user.userId], (err, rows) => res(rows || []));
                    });
                }

                const supplierIds = memberships.length > 0
                    ? memberships.map(m => m.supplierId || m.supplierid)
                    : [supplierId];

                // Safety: Ensure supplierId is included even if memberships query returned nothing
                if (!supplierIds.includes(parseInt(supplierId))) {
                    supplierIds.push(parseInt(supplierId));
                }

                const placeholders = supplierIds.map(() => '?').join(',');

                // Fetch basic info for all associated buyers
                const buyerInfos = await new Promise((res, rej) => {
                    db.all(`
                        SELECT s.supplierid, s.buyerid, b.buyername, s.approvalstatus, s.isactive
                        FROM suppliers s
                        JOIN buyers b ON s.buyerid = b.buyerid
                        WHERE s.supplierid IN (${placeholders})
                    `, supplierIds, (err, rows) => err ? rej(err) : res(rows));
                });

                // Get summary stats (use lowercase field names from PostgreSQL)
                const totalBuyers = buyerInfos.length;
                const activeBuyers = buyerInfos.filter(b => {
                    const status = b.approvalstatus || b.approvalStatus;
                    return status === 'ACTIVE' || status === 'APPROVED';
                }).length;

                resolve({
                    supplierId,
                    buyers: buyerInfos.map(b => ({
                        id: b.buyerid || b.buyerId,
                        name: b.buyername || b.buyerName,
                        status: b.approvalstatus || b.approvalStatus,
                        isActive: b.isactive !== undefined ? b.isactive : b.isActive
                    })),
                    stats: {
                        totalBuyers,
                        activeBuyers
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = SupplierService;

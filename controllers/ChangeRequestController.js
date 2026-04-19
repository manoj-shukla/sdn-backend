const ChangeRequestService = require('../services/ChangeRequestService');
const db = require('../config/database');

class ChangeRequestController {
    static async createChangeRequest(req, res) {
        try {
            const { supplierId, requestType, ...updates } = req.body;
            // Use provided supplierId or fallback to user's primary one
            const targetSupplierId = supplierId || req.user.supplierId;
            const result = await ChangeRequestService.createChangeRequest(targetSupplierId, updates.updates || updates, req.user);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    }

    static async getPendingRequests(req, res) {
        try {
            // REFRESH role/buyerId/supplierId from DB to handle Sandbox role switching
            const user = await new Promise((resolve) => {
                db.get("SELECT role, subRole as \"subRole\", buyerId as \"buyerId\", supplierId as \"supplierId\" FROM sdn_users WHERE userId = ?", [req.user.userId], (err, row) => {
                    if (err || !row) resolve(req.user);
                    else {
                        resolve({
                            ...req.user,
                            subRole: row.subRole || req.user.subRole,
                            buyerId: row.buyerId || req.user.buyerId,
                            supplierId: row.supplierId || req.user.supplierId
                        });
                    }
                });
            });

            console.log(`[ChangeRequestController.getPendingRequests] userId: ${req.user.userId}, buyerId: ${user.buyerId}, supplierId: ${user.supplierId}, role: ${user.role}`);

            // Supplier users can only see their own change requests
            if (user.role === 'SUPPLIER' && !user.supplierId) {
                return res.json([]);
            }

            // If supplier user, filter by their supplierId
            if (user.role === 'SUPPLIER') {
                const supplierId = user.supplierId;
                // Return change requests for this supplier
                const query = `
                    SELECT
                        r.requestId as "requestId",
                        r.supplierId as "supplierId",
                        r.requestedAt as "requestedAt",
                        r.status as "status",
                        s.legalName as "supplierName"
                    FROM supplier_change_requests r
                    JOIN suppliers s ON r.supplierId = s.supplierId
                    WHERE r.supplierId = ? AND r.status = 'PENDING'
                    ORDER BY r.requestedAt DESC
                `;
                return new Promise((resolve, reject) => {
                    db.all(query, [supplierId], (err, rows) => err ? reject(err) : resolve(rows));
                }).then(data => res.json(data)).catch(e => res.status(500).json({ error: e.message }));
            }

            const { buyerId } = user;
            if (!buyerId) {
                return res.json([]);
            }

            const query = `
                SELECT
                    r.requestId as "requestId",
                    r.supplierId as "supplierId",
                    r.requestedAt as "requestedAt",
                    r.status as "status",
                    s.legalName as "supplierName",
                    s.website,
                    s.description,
                    s.country,
                    s.bankName as "bankName",
                    s.accountNumber,
                    s.taxId,
                    s.isGstRegistered,
                    s.gstin,
                    i.itemId as "itemId",
                    i.fieldName as "fieldName",
                    i.oldValue as "oldValue",
                    i.newValue as "newValue",
                    i.changeCategory as "changeCategory",
                    i.status as "itemStatus"
                FROM supplier_change_requests r
                JOIN suppliers s ON r.supplierId = s.supplierId
                LEFT JOIN supplier_change_items i ON r.requestId = i.requestId
                WHERE s.buyerId = ? AND r.status = 'PENDING'
                ORDER BY r.requestedAt DESC
            `;

            // Await the DB query so async errors are caught by the outer try/catch
            const rows = await new Promise((resolve, reject) => {
                db.all(query, [buyerId], (err, rows) => {
                    if (err) {
                        console.error(`[ChangeRequestController.getPendingRequests] DB query error for buyerId=${buyerId}:`, err.message);
                        return reject(err);
                    }
                    resolve(rows);
                });
            });

            const supplierIds = [...new Set(rows.map(r => r.supplierId || r.supplierid))].filter(Boolean);

            // Batch fetch related data
            let addresses = [], contacts = [], documents = [];
            if (supplierIds.length > 0) {
                const placeholders = supplierIds.map(() => '?').join(',');
                addresses = await new Promise(resolveInner => db.all(`SELECT * FROM addresses WHERE supplierId IN (${placeholders})`, supplierIds, (e, r) => resolveInner(r || [])));
                contacts = await new Promise(resolveInner => db.all(`SELECT * FROM contacts WHERE supplierId IN (${placeholders})`, supplierIds, (e, r) => resolveInner(r || [])));
                documents = await new Promise(resolveInner => db.all(`SELECT * FROM documents WHERE supplierId IN (${placeholders})`, supplierIds, (e, r) => resolveInner(r || [])));
            }

                // Group by SUPPLIER ID to Consolidated View
                const suppliersMap = {};

                for (const row of rows) {
                    const sid = row.supplierId || row.supplierid;
                    const rid = row.requestId || row.requestid;
                    if (!sid) continue;

                    if (!suppliersMap[sid]) {
                        const sAddresses = addresses.filter(a => (a.supplierId || a.supplierid) === sid);
                        const sContacts = contacts.filter(c => (c.supplierId || c.supplierid) === sid);
                        const sDocuments = documents.filter(d => (d.supplierId || d.supplierid) === sid);

                        suppliersMap[sid] = {
                            supplierId: sid,
                            supplierName: row.supplierName || row.suppliername,
                            // Use latest requestId as the "Handle" for the UI
                            requestId: rid,
                            latestRequestedAt: row.requestedAt || row.requestedat,
                            status: 'PENDING',

                            // Collections
                            items: [],

                            // Base Proposed (will be mutated)
                            proposed: {
                                supplierName: row.supplierName || row.suppliername,
                                website: row.website || row.Website,
                                description: row.description || row.Description,
                                country: row.country || row.Country,
                                bankName: row.bankName || row.bankname,
                                accountNumber: row.accountNumber || row.accountnumber,
                                taxId: row.taxId || row.taxid,
                                isGstRegistered: (row.isGstRegistered !== undefined ? row.isGstRegistered : row.isgstregistered) === 1 || row.isGstRegistered === true || row.isgstregistered === true,
                                gstin: row.gstin,
                                addresses: sAddresses.map(a => ({
                                    ...a,
                                    addressId: a.addressId || a.addressid,
                                    addressLine1: a.addressLine1 || a.addressline1,
                                    addressLine2: a.addressLine2 || a.addressline2,
                                    stateProvince: a.stateProvince || a.stateprovince,
                                    postalCode: a.postalCode || a.postalcode,
                                    isPrimary: a.isPrimary === 1 || a.isPrimary === true || a.isprimary === true
                                })),
                                contacts: sContacts.map(c => ({
                                    ...c,
                                    contactId: c.contactId || c.contactid,
                                    isPrimary: c.isPrimary === 1 || c.isPrimary === true || c.isprimary === true
                                })),
                                documents: sDocuments.map(d => ({
                                    ...d,
                                    documentId: d.documentId || d.documentid,
                                    documentType: d.documentType || d.documenttype,
                                    documentName: d.documentName || d.documentname,
                                    filePath: d.filePath || d.filepath,
                                    fileSize: d.fileSize || d.filesize,
                                    fileType: d.fileType || d.filetype,
                                    verificationStatus: d.verificationStatus || d.verificationstatus,
                                    expiryDate: d.expiryDate || d.expirydate
                                }))
                            }
                        };
                    }

                    const supplierObj = suppliersMap[sid];

                    // Parse Change Item
                    if (row.fieldName) {
                        const item = {
                            itemId: row.itemId || row.itemid,
                            requestId: rid,
                            fieldName: row.fieldName || row.fieldname,
                            oldValue: row.oldValue || row.oldvalue,
                            newValue: row.newValue || row.newvalue,
                            changeCategory: row.changeCategory || row.changecategory,
                            status: row.itemStatus || row.itemstatus,
                            requestedAt: row.requestedAt || row.requestedat
                        };
                        supplierObj.items.push(item);
                    }
                }

                // Now Process Each Supplier's Consolidated View
                const response = Object.values(suppliersMap).map(supp => {
                    // 1. Sort items by time (Oldest First) to apply changes correctly
                    supp.items.sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));

                    // --- LATEST WINS LOGIC ---
                    const latestByField = {};
                    supp.items.forEach(item => {
                        if (item.fieldName === 'documents') return;
                        latestByField[item.fieldName] = item;
                    });
                    supp.items = supp.items.filter(item => {
                        if (item.status === 'REJECTED') return false;
                        if (item.fieldName === 'documents') return true;
                        return item === latestByField[item.fieldName];
                    });

                    // 2. Apply Changes to 'Proposed' in order
                    supp.items.forEach(item => {
                        // Skip if already approved/rejected in a way that shouldn't affect proposed? 
                        // Actually if it's pending, we apply it to show the "Future" state.
                        // If it's approved, it's likely already in the base table? 
                        // Wait, if we have mixed status...
                        // If status is PENDING, apply it.
                        // If status is APPROVED, it should be in the base row... UNLESS it was approved just now and base row is stale?
                        // Base row comes from 'suppliers' join. So it is current DB state.
                        // So we only need to apply PENDING items to show the "Proposed" state.
                        // Approved items are already "Real".

                        // Wait! The user provided JSON showed APPROVED items in a PENDING request.
                        // If items are approved, they are applied.
                        // So we only apply items where status != 'APPROVED' ?
                        // Yes.

                        // REJECTED items are ignored.
                        // APPROVED items ARE applied to showing the current "Proposed" state (chronologically)
                        // PENDING items are applied as "Future" state.
                        if (item.status === 'REJECTED') return;

                        const val = item.newValue;
                        const field = item.fieldName;
                        const proposed = supp.proposed;

                        // -- Address Hydration/Update --
                        if (['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'].includes(field)) {
                            if (!proposed.addresses || proposed.addresses.length === 0) {
                                proposed.addresses = [{
                                    addressId: 0, isPrimary: true,
                                    addressLine1: '', city: '',
                                    country: proposed.country || '', postalCode: '', state: ''
                                }];
                            }
                            const addr = proposed.addresses.find(a => a.isPrimary) || proposed.addresses[0];
                            if (addr) addr[field] = val;
                        }
                        // -- Contact Hydration/Update --
                        else if (['firstName', 'lastName', 'email', 'phone', 'designation'].includes(field)) {
                            if (!proposed.contacts || proposed.contacts.length === 0) {
                                proposed.contacts = [{
                                    contactId: -1, isPrimary: true,
                                    firstName: '', lastName: '', email: '', phone: ''
                                }];
                            }
                            const contact = proposed.contacts.find(c => c.isPrimary) || proposed.contacts[0];
                            if (contact) contact[field] = val;
                        }
                        // -- Direct Field Update --
                        else {
                            if (field === 'legalName') proposed.supplierName = val;
                            else proposed[field] = val;
                        }
                    });

                    // 3. Cleanup Proposed Object (Nulls/IDs)
                    if (supp.proposed.addresses) {
                        supp.proposed.addresses.forEach(a => {
                            delete a.addressId;
                            Object.keys(a).forEach(key => (a[key] === '' || a[key] === null) && delete a[key]);
                        });
                    }
                    if (supp.proposed.contacts) {
                        supp.proposed.contacts.forEach(c => {
                            delete c.contactId;
                            Object.keys(c).forEach(key => (c[key] === '' || c[key] === null) && delete c[key]);
                        });
                    }
                    Object.keys(supp.proposed).forEach(key => {
                        const val = supp.proposed[key];
                        if (val === '' || val === null) delete supp.proposed[key];
                    });

                    // 4. Role-Based Permissions (Relaxed Visibility)
                    // Everyone sees everything, but only specific roles can ACT.
                    const userRole = user.subRole || user.role;
                    const isAdmin = ['Admin', 'Buyer Admin', 'ADMIN'].includes(userRole);

                    // Mark items as Actionable if user has permission
                    supp.items = supp.items.filter(i => i.status === 'PENDING').map(item => {
                        const requiredRole = ChangeRequestService.getFieldRole(item.fieldName);
                        let isActionable = false;

                        if (isAdmin) {
                            isActionable = true;
                        } else {
                            // Allow 'Shared' items or Role Match
                            const matchesRole = userRole.toLowerCase().includes(requiredRole.toLowerCase());
                            isActionable = (requiredRole === 'Shared') || matchesRole;
                        }

                        return { ...item, isActionable };
                    });

                    // Filter out requests that have NO pending items at all (already handled in step 1 sort/latest logic, but good safety)
                    if (supp.items.length === 0) return null;

                    // For non-admin users: hide the task once they have no actionable items left.
                    // This prevents "ghost tasks" where Finance already approved their items
                    // but the request still shows because Compliance hasn't acted yet.
                    if (!isAdmin && !supp.items.some(i => i.isActionable)) return null;

                    // 5. Return Consolidated Object
                    return {
                        requestId: supp.requestId, // Latest ID
                        supplierId: supp.supplierId,
                        supplierName: supp.supplierName,
                        requestedAt: supp.latestRequestedAt,
                        status: 'PENDING',
                        items: supp.items, // All items, with isActionable flag
                        proposed: supp.proposed
                    };
                }).filter(Boolean); // Remove nulls

            res.json(response);
        } catch (e) {
            console.error('[ChangeRequestController.getPendingRequests] Error:', e.message, e.stack);
            if (!res.headersSent) res.status(500).json({ error: e.message });
        }
    }

    static async getRequestDetails(req, res) {
        try {
            const request = await ChangeRequestService.getChangeRequestById(req.params.id);
            if (!request) {
                return res.status(404).json({ error: "Request not found" });
            }

            console.log(`[ChangeRequestController.getRequestDetails] Request ID: ${req.params.id}, keys: ${Object.keys(request)} `);

            // RBAC: Relaxed Visibility - Show all, mark actionable
            const userRole = req.user.subRole || req.user.role;
            const isAdmin = ['Admin', 'Buyer Admin', 'ADMIN'].includes(userRole);

            if (request.items) {
                request.items = request.items.map(i => {
                    const requiredRole = ChangeRequestService.getFieldRole(i.fieldName);
                    let isActionable = false;

                    if (isAdmin) {
                        isActionable = true;
                    } else {
                        const matchesRole = userRole.toLowerCase().includes(requiredRole.toLowerCase());
                        isActionable = (requiredRole === 'Shared') || matchesRole;
                    }
                    return { ...i, isActionable };
                });
            }

            res.json(request);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async approveRequest(req, res) {
        try {
            // Refresh subRole from DB so sandbox role-switching is always respected
            const freshUser = await new Promise((resolve) => {
                db.get("SELECT subRole as \"subRole\" FROM sdn_users WHERE userId = ?", [req.user.userId], (err, row) => {
                    if (err || !row) resolve(req.user);
                    else resolve({ ...req.user, subRole: row.subRole || req.user.subRole });
                });
            });
            const userRole = freshUser.subRole || freshUser.role;
            const result = await ChangeRequestService.approveChangeRequest(req.params.id, req.user.userId, userRole);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async rejectRequest(req, res) {
        try {
            const { reason } = req.body;
            const result = await ChangeRequestService.rejectChangeRequest(req.params.id, req.user.userId, reason);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async approveItem(req, res) {
        try {
            const userRole = req.user.subRole || req.user.role;
            let requestId = req.body.requestId;

            if (!requestId) {
                const item = await new Promise((res, rej) => {
                    db.get("SELECT requestId as \"requestId\" FROM supplier_change_items WHERE itemId = ?", [req.params.itemId], (err, row) => err ? rej(err) : res(row));
                });
                if (item) requestId = item.requestId || item.requestid;
            }

            if (!requestId) return res.status(400).json({ error: "Missing requestId" });

            const result = await ChangeRequestService.approveChangeItem(requestId, [req.params.itemId], req.user.userId, userRole);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async rejectItem(req, res) {
        try {
            let requestId = req.body.requestId;
            const reason = req.body.reason || req.body.comments;

            if (!requestId) {
                const item = await new Promise((res, rej) => {
                    db.get("SELECT requestId as \"requestId\" FROM supplier_change_items WHERE itemId = ?", [req.params.itemId], (err, row) => err ? rej(err) : res(row));
                });
                if (item) requestId = item.requestId || item.requestid;
            }

            if (!requestId) return res.status(400).json({ error: "Missing requestId" });

            const result = await ChangeRequestService.rejectChangeItem(requestId, req.params.itemId, req.user.userId, reason);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }

    static async getSupplierRequests(req, res) {
        try {
            const supplierId = req.user.supplierId;
            if (!supplierId) {
                console.error("[getSupplierRequests] 400 - req.user:", JSON.stringify(req.user));
                return res.status(400).json({ error: "User is not a supplier" });
            }

            const query = `
        SELECT
        r.requestId as "requestId",
            r.supplierId as "supplierId",
            r.status as "status",
            r.requestedAt as "requestedAt",
            i.fieldName as "fieldName",
            i.oldValue as "oldValue",
            i.newValue as "newValue",
            i.changeCategory as "changeCategory" 
                FROM supplier_change_requests r
                LEFT JOIN supplier_change_items i ON r.requestId = i.requestId
                WHERE r.supplierId = ?
            ORDER BY r.requestedAt DESC
            `;

            db.all(query, [supplierId], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });

                // Group by Request
                const requestsMap = {};
                rows.forEach(row => {
                    const rid = row.requestId || row.requestid;
                    if (!requestsMap[rid]) {
                        requestsMap[rid] = {
                            requestId: rid,
                            supplierId: row.supplierId || row.supplierid,
                            status: row.status,
                            requestedAt: row.requestedAt || row.requestedat,
                            items: []
                        };
                    }
                    const fieldName = row.fieldName || row.fieldname;
                    if (fieldName) {
                        requestsMap[rid].items.push({
                            fieldName: fieldName,
                            oldValue: row.oldValue || row.oldvalue,
                            newValue: row.newValue || row.newvalue,
                            category: row.changeCategory || row.changecategory
                        });
                    }
                });

                res.json(Object.values(requestsMap));
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
}

module.exports = ChangeRequestController;

const db = require('../config/database');
const AuditService = require('./AuditService');
const NotificationService = require('./NotificationService');

class ChangeRequestService {

    // Helper to get classification
    static async getFieldClassification(fieldName) {
        return new Promise((resolve) => {
            db.get("SELECT category FROM field_change_classification WHERE fieldName = ?", [fieldName], (err, row) => {
                if (err || !row) resolve('MINOR'); // Default to MINOR if unknown
                else resolve(row.category);
            });
        });
    }

    // Helper to map fields to Roles
    static getFieldRole(fieldName) {
        if (!fieldName) return 'Admin';

        // Normalise: snake_case → camelCase, then lowercase for regex matching
        const normalised = fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        const lower = normalised.toLowerCase();

        // Documents are reviewed by Compliance only (strict routing).
        // Previously marked 'Shared' which fanned out to multiple roles.
        if (lower === 'documents') return 'Compliance';

        // Finance: banking, tax, payment identifiers — mirrors the frontend regex
        // /bank|account|tax|gst|pan|swift|ifsc|beneficiar|routing|cheque|msme/i
        if (/bank|account|tax|gst|pan|swift|ifsc|beneficiar|routing|cheque|msme/i.test(lower)) return 'Finance';

        // Compliance: legal identity, registration, address details
        if (/legal|business.*type|registration|incorporation|address|city|country|postal|state|province|pan.*card/i.test(lower)) return 'Compliance';

        // Procurement: general company info, contacts
        if (/website|description|contact/i.test(lower)) return 'Procurement';

        // AP: payment terms, invoicing
        if (/payment.*term|currency|invoice.*email/i.test(lower)) return 'AP';

        return 'Admin'; // Unknown field — only admins can action it
    }

    static async createChangeRequest(supplierId, updates, user) {
        // 1. Fetch Current Data
        const currentData = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM suppliers WHERE supplierid = ?`, [supplierId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!currentData) throw new Error("Supplier not found");

        // 2. Calculate Diffs
        const changes = [];
        const ignoredFields = ['updatedAt', 'reviewedAt', 'submittedAt', 'approvalStatus', 'profileStatus'];

        for (const [key, newValue] of Object.entries(updates)) {
            if (ignoredFields.includes(key) || newValue === undefined) continue;

            const oldValue = currentData[key] !== undefined ? currentData[key] : currentData[key.toLowerCase()];
            // Simple equality check
            if (newValue != oldValue) {
                const category = await this.getFieldClassification(key);
                changes.push({
                    fieldName: key,
                    oldValue: oldValue ? String(oldValue) : '',
                    newValue: String(newValue),
                    changeCategory: category
                });
            }
        }

        if (changes.length === 0) {
            console.log(`[ChangeRequestService] No changes detected for supplier ${supplierId}`);
            return { message: "No changes detected", status: "NO_CHANGE" };
        }

        console.log(`[ChangeRequestService] Detected ${changes.length} changes for supplier ${supplierId}:`);
        changes.forEach(c => console.log(`  - Field: ${c.fieldName}, Category: ${c.changeCategory}, From: "${c.oldValue}" To: "${c.newValue}"`));

        // 3. Create Request Header
        const isMajor = changes.some(c => c.changeCategory === 'MAJOR');
        const status = isMajor ? 'PENDING' : 'APPROVED';
        console.log(`[ChangeRequestService] Overall request status: ${status} (isMajor: ${isMajor})`);
        const buyerId = currentData.buyerid || currentData.buyerId || currentData.buyerID;

        if (!buyerId) {
            console.warn(`[ChangeRequest] WARNING: Null buyerId for supplier ${supplierId}. Request visibility will be limited.`);
        }

        return new Promise((resolve, reject) => {
            db.run(`INSERT INTO supplier_change_requests (supplierid, requesttype, status, requestedbyuserid, buyerid) VALUES (?, ?, ?, ?, ?)`,
                [supplierId, 'PROFILE_UPDATE', status, user.userId, buyerId],
                function (err) {
                    if (err) return reject(err);
                    const requestId = this.lastID;

                    // 4. Insert Items
                    const itemPromises = changes.map(change => {
                        return new Promise((res, rej) => {
                            db.run(`INSERT INTO supplier_change_items (requestid, fieldname, oldvalue, newvalue, changecategory, status) VALUES (?, ?, ?, ?, ?, ?)`,
                                [requestId, change.fieldName, change.oldValue, change.newValue, change.changeCategory, status === 'APPROVED' ? 'APPROVED' : 'PENDING'],
                                (e) => e ? rej(e) : res()
                            );
                        });
                    });

                    Promise.all(itemPromises).then(async () => {
                        // 5. Handle Auto-Approval or Notification
                        if (status === 'APPROVED') {
                            await ChangeRequestService.finalizeRequest(requestId, supplierId, user.userId);
                            resolve({
                                message: "Changes auto-applied (Minor Update)",
                                status: "APPLIED",
                                requestId
                            });
                        } else {
                            // 6. Initiate Parallel Workflow Tasks
                            const WorkflowService = require('./WorkflowService');
                            const requiredRoles = new Set(changes.map(c => this.getFieldRole(c.fieldName)));
                            await WorkflowService.initiateUpdateWorkflow(supplierId, buyerId, Array.from(requiredRoles));

                            // 7. Notify ALL relevant approvers immediately (Parallel Flow)
                            await ChangeRequestService.notifyRelevantApprovers(requestId, buyerId, supplierId, user.userId);

                            resolve({
                                message: "Change Request created. Pending Approval.",
                                status: "PENDING_APPROVAL",
                                requestId
                            });
                        }
                    }).catch(reject);
                }
            );
        });
    }

    static async notifyRelevantApprovers(requestId, buyerId, supplierId, initiatorId) {
        // 1. Get all PENDING items
        const pendingItems = await new Promise((resolve, reject) => {
            db.all(`SELECT fieldname as "fieldName" FROM supplier_change_items WHERE requestid = ? AND status = 'PENDING'`,
                [requestId], (err, rows) => err ? reject(err) : resolve(rows || []));
        });

        if (pendingItems.length === 0) {
            return;
        }

        // 2. Fetch supplier name for richer notification copy
        const supplierRow = await new Promise((resolve) => {
            db.get(`SELECT legalname FROM suppliers WHERE supplierid = ?`, [supplierId], (err, row) => resolve(row || null));
        });
        const supplierName = (supplierRow && (supplierRow.legalname || supplierRow.legalName)) || `Supplier #${supplierId}`;

        // 3. Group items by required role so each role's notification describes
        //    only the category they're responsible for.
        const itemsByRole = new Map();
        pendingItems.forEach(item => {
            const name = item.fieldname || item.fieldName;
            const role = this.getFieldRole(name);
            if (!role || role === 'Admin') return;
            if (!itemsByRole.has(role)) itemsByRole.set(role, []);
            itemsByRole.get(role).push(name);
        });

        const categoryLabel = (role) => {
            switch (role) {
                case 'Finance':     return 'bank / finance details';
                case 'Compliance':  return 'compliance documents or legal details';
                case 'Procurement': return 'company profile details';
                case 'AP':          return 'payment / invoicing details';
                default:            return 'profile details';
            }
        };

        // 4. Send notifications to EACH role simultaneously
        const notificationPromises = [];

        for (const [role, fields] of itemsByRole.entries()) {
            console.log(`[ChangeRequest] Notifying ${role} for Request ${requestId} (${fields.length} items)`);
            notificationPromises.push(NotificationService.createNotification({
                type: 'CHANGE_REQUEST_PENDING',
                message: `${supplierName} submitted an update to ${categoryLabel(role)} (${fields.length} field${fields.length === 1 ? '' : 's'}). Your review is required.`,
                entityId: requestId,
                recipientRole: role,
                supplierId: supplierId,
                buyerId: buyerId
            }));
        }

        // 5. ALWAYS notify Buyer Admin for oversight
        notificationPromises.push(NotificationService.createNotification({
            type: 'CHANGE_REQUEST_INITIATED',
            message: `${supplierName} initiated a change request (#${requestId}) covering ${Array.from(itemsByRole.keys()).join(', ') || 'profile details'}.`,
            entityId: requestId,
            recipientRole: 'Buyer Admin',
            supplierId: supplierId,
            buyerId: buyerId
        }));

        // 6. Confirmation back to the supplier so they can see their submission was received.
        notificationPromises.push(NotificationService.createNotification({
            type: 'CHANGE_REQUEST_SUBMITTED',
            message: `Your change request #${requestId} has been submitted for review. You'll be notified once approvers take action.`,
            entityId: requestId,
            recipientRole: 'SUPPLIER',
            supplierId: supplierId,
            buyerId: buyerId
        }));

        await Promise.all(notificationPromises);
    }

    static async approveChangeItem(requestId, itemIds, approverId, approverRole) {
        // itemIds: Array of IDs to approve
        // Security check: Does approverRole match the field's required role?
        // For now trusting the caller/UI, but in production we'd verify.

        // 1. Update Items
        for (const itemId of itemIds) {
            await new Promise((resolve, reject) => {
                db.run(`UPDATE supplier_change_items SET status = 'APPROVED', reviewedbyuserid = ?, reviewedat = CURRENT_TIMESTAMP WHERE itemid = ?`,
                    [approverId, itemId], (err) => err ? reject(err) : resolve());
            });
        }

        return await this.checkRequestCompletion(requestId, approverId);
    }

    static async rejectChangeItem(requestId, itemId, approverId, reason) {
        await new Promise((resolve, reject) => {
            db.run(`UPDATE supplier_change_items SET status = 'REJECTED', rejectionreason = ?, reviewedbyuserid = ?, reviewedat = CURRENT_TIMESTAMP WHERE itemid = ?`,
                [reason || null, approverId, itemId], (err) => err ? reject(err) : resolve());
        });

        return await this.checkRequestCompletion(requestId, approverId);
    }

    static async checkRequestCompletion(requestId, approverId) {
        // Check Remaining Status
        const request = await this.getChangeRequestById(requestId);
        if (!request) {
            // Request was already finalized or cleaned up by a parallel approver — nothing to do.
            return { status: "COMPLETED", message: "Request already finalized." };
        }
        const pendingItems = (request.items || []).filter(i => i.status === 'PENDING');

        if (pendingItems.length === 0) {
            // ALL HANDLED (Approved or Rejected) -> Finalize
            const result = await this.finalizeRequest(requestId, request.supplierid || request.supplierId, approverId);
            return { status: "COMPLETED", message: "All items handled. Request finalized.", updates: result.updates };
        } else {
            // Still pending -> Check if we need to notify NEXT role
            // The notifyRelevantApprovers logic handles parallel notifications. 
            await this.notifyRelevantApprovers(requestId, request.buyerid || request.buyerId, request.supplierid || request.supplierId, request.requestedbyuserid);

            return { status: "PENDING", message: "Item processed. Waiting for other items." };
        }
    }

    static async finalizeRequest(requestId, supplierId, approverId) {
        const request = await this.getChangeRequestById(requestId);
        if (!request) {
            // Already finalized or non-existent; nothing to apply.
            return { updates: {} };
        }

        // Separate document items from field-level items
        const fieldUpdates = {};
        const documentItems = [];

        (request.items || []).forEach(item => {
            // ONLY process APPROVED items
            if (item.status !== 'APPROVED') return;

            const fieldName = item.fieldname || item.fieldName;
            const newValue = item.newvalue || item.newValue;

            if (fieldName === 'documents') {
                documentItems.push(newValue); // JSON string with doc metadata
            } else if (fieldName === 'bank_account') {
                // Collect bank account updates to apply after items loop
                if (!fieldUpdates._bankAccounts) fieldUpdates._bankAccounts = [];
                fieldUpdates._bankAccounts.push(newValue);
            } else if (fieldName === 'contact') {
                if (!fieldUpdates._contacts) fieldUpdates._contacts = [];
                fieldUpdates._contacts.push(newValue);
            } else if (fieldName === 'address') {
                if (!fieldUpdates._addresses) fieldUpdates._addresses = [];
                fieldUpdates._addresses.push(newValue);
            } else {
                fieldUpdates[fieldName] = newValue;
            }
        });

        // 1. Process Bank Account Updates (from JSON payloads)
        if (fieldUpdates._bankAccounts) {
            for (const bankJson of fieldUpdates._bankAccounts) {
                try {
                    const data = JSON.parse(bankJson);
                    const { bankId, ...updates } = data;

                    if (!bankId) {
                        // INSERT new bank account
                        const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
                        if (keys.length > 0) {
                            const columns = keys.map(k => k.toLowerCase()).join(', ') + ', supplierid';
                            const valuesClause = keys.map(() => '?').join(', ') + ', ?';
                            const values = keys.map(k => updates[k]);
                            values.push(supplierId);

                            await new Promise((resolve, reject) => {
                                db.run(`INSERT INTO bank_accounts (${columns}) VALUES (${valuesClause})`, values, (err) => err ? reject(err) : resolve());
                            });
                            console.log(`[ChangeRequest] New bank account created for supplier ${supplierId} after approval.`);
                        }
                    } else {
                        // UPDATE existing
                        const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
                        if (keys.length > 0) {
                            const setClause = keys.map(k => `${k} = ?`).join(', ');
                            const values = keys.map(k => updates[k]);
                            values.push(bankId);
                            await new Promise((resolve, reject) => {
                                db.run(`UPDATE bank_accounts SET ${setClause}, updatedat = CURRENT_TIMESTAMP WHERE bankid = ?`, values, (err) => err ? reject(err) : resolve());
                            });
                            console.log(`[ChangeRequest] Bank account ${bankId} updated for supplier ${supplierId} after approval.`);
                        }
                    }
                } catch (e) {
                    console.error("[ChangeRequest] Failed to parse/apply bank account update:", e);
                }
            }
            delete fieldUpdates._bankAccounts;
        }

        // 1.5 Process Contact Updates
        if (fieldUpdates._contacts) {
            for (const contactJson of fieldUpdates._contacts) {
                try {
                    const data = JSON.parse(contactJson);
                    const { contactId, ...updates } = data;

                    if (!contactId) {
                        // INSERT new contact
                        const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
                        if (keys.length > 0) {
                            const columns = keys.map(k => k.toLowerCase()).join(', ') + ', supplierid';
                            const valuesClause = keys.map(() => '?').join(', ') + ', ?';
                            const values = keys.map(k => updates[k]);
                            values.push(supplierId);

                            await new Promise((resolve, reject) => {
                                db.run(`INSERT INTO contacts (${columns}) VALUES (${valuesClause})`, values, (err) => err ? reject(err) : resolve());
                            });
                            console.log(`[ChangeRequest] New contact created for supplier ${supplierId} after approval.`);
                        }
                    } else {
                        // UPDATE existing
                        const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
                        if (keys.length > 0) {
                            const setClause = keys.map(k => `${k} = ?`).join(', ');
                            const values = keys.map(k => updates[k]);
                            values.push(contactId);

                            // Check table format, some places use 'contactid', 'userid' or just 'contactId'.
                            // It usually is 'contactid'
                            await new Promise((resolve, reject) => {
                                db.run(`UPDATE contacts SET ${setClause} WHERE contactid = ?`, values, (err) => err ? reject(err) : resolve());
                            });
                            console.log(`[ChangeRequest] Contact ${contactId} updated for supplier ${supplierId} after approval.`);
                        }
                    }
                } catch (e) {
                    console.error("[ChangeRequest] Failed to parse/apply contact update:", e);
                }
            }
            delete fieldUpdates._contacts;
        }

        // 1.6 Process Address Updates
        if (fieldUpdates._addresses) {
            for (const addrJson of fieldUpdates._addresses) {
                try {
                    const data = JSON.parse(addrJson);
                    const { addressId, ...updates } = data;

                    if (!addressId) {
                        // INSERT new address
                        const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
                        if (keys.length > 0) {
                            const columns = keys.map(k => k.toLowerCase()).join(', ') + ', supplierid';
                            const valuesClause = keys.map(() => '?').join(', ') + ', ?';
                            const values = keys.map(k => updates[k]);
                            values.push(supplierId);

                            await new Promise((resolve, reject) => {
                                db.run(`INSERT INTO addresses (${columns}) VALUES (${valuesClause})`, values, (err) => err ? reject(err) : resolve());
                            });
                            console.log(`[ChangeRequest] New address created for supplier ${supplierId} after approval.`);
                        }
                    } else {
                        // UPDATE existing
                        const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
                        if (keys.length > 0) {
                            const setClause = keys.map(k => `${k} = ?`).join(', ');
                            const values = keys.map(k => updates[k]);
                            values.push(addressId);

                            await new Promise((resolve, reject) => {
                                db.run(`UPDATE addresses SET ${setClause} WHERE addressid = ?`, values, (err) => err ? reject(err) : resolve());
                            });
                            console.log(`[ChangeRequest] Address ${addressId} updated for supplier ${supplierId} after approval.`);
                        }
                    }
                } catch (e) {
                    console.error("[ChangeRequest] Failed to parse/apply address update:", e);
                }
            }
            delete fieldUpdates._addresses;
        }

        // 2. Apply field-level updates to suppliers table (if any)
        if (Object.keys(fieldUpdates).length > 0) {
            const keys = Object.keys(fieldUpdates);
            const setClause = keys.map(k => `${k} = ?`).join(', ');
            const values = keys.map(k => fieldUpdates[k]);
            values.push(supplierId);

            await new Promise((resolve, reject) => {
                db.run(`UPDATE suppliers SET ${setClause} WHERE supplierid = ?`, values, (err) => err ? reject(err) : resolve());
            });
        }

        // 2. Insert documents (if any)
        for (const docJson of documentItems) {
            try {
                const doc = JSON.parse(docJson);
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO documents (supplierid, documenttype, documentname, filepath, filesize, filetype, verificationstatus, notes, uploadedbyuserid, uploadedbyusername) 
                         VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?)`,
                        [supplierId, doc.documentType, doc.documentName, doc.filePath, doc.fileSize, doc.fileType, doc.notes, doc.uploadedByUserId, doc.uploadedByUsername],
                        (err) => err ? reject(err) : resolve()
                    );
                });
                console.log(`[ChangeRequest] Document "${doc.documentName}" inserted for supplier ${supplierId} after approval.`);
            } catch (parseErr) {
                console.error(`[ChangeRequest] Failed to parse/insert document item:`, parseErr);
            }
        }

        // 3. Mark request as approved
        return await new Promise((resolve, reject) => {
            db.run(`UPDATE supplier_change_requests SET status = 'APPROVED', reviewedbyuserid = ?, reviewedat = CURRENT_TIMESTAMP WHERE requestid = ?`,
                [approverId, requestId],
                async (err) => {
                    if (err) return reject(err);

                    // Log Audit
                    const allUpdates = { ...fieldUpdates };
                    if (documentItems.length > 0) allUpdates['documents'] = `${documentItems.length} document(s) approved`;
                    await AuditService.logChange(supplierId, 'MANUAL_APPROVE', requestId, 'CHANGE_REQUEST', allUpdates, approverId, 'BUYER');

                    // Notify Supplier via Notification
                    await NotificationService.createNotification({
                        type: 'CHANGE_REQUEST_APPROVED',
                        message: 'Your profile updates have been approved and applied.',
                        entityId: requestId,
                        recipientRole: 'SUPPLIER',
                        supplierId: supplierId
                    });

                    resolve({ success: true, updates: allUpdates });
                }
            );
        });
    }

    static async applyChanges(requestId, supplierId, updates, approverId) {
        // Auto-apply logic (same as before)
        const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        const values = keys.map(k => updates[k]);
        values.push(supplierId);

        await new Promise((resolve, reject) => {
            db.run(`UPDATE suppliers SET ${setClause} WHERE supplierid = ?`, values, (err) => err ? reject(err) : resolve());
        });

        await AuditService.logChange(supplierId, 'AUTO_UPDATE', requestId, 'CHANGE_REQUEST', updates, approverId, 'SYSTEM');
    }

    static async getChangeRequestById(requestId) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT requestid as "requestId", supplierid as "supplierId", requesttype as "requestType", status, requestedbyuserid as "requestedByUserId", requestedat as "requestedAt", reviewedbyuserid as "reviewedByUserId", reviewedat as "reviewedAt", rejectionreason as "rejectionReason", buyerid as "buyerId" FROM supplier_change_requests WHERE requestid = ?`, [requestId], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);

                // Normalize request row
                const normalizedRow = {
                    requestId: row.requestId || row.requestid,
                    supplierId: row.supplierId || row.supplierid,
                    requestType: row.requestType || row.requesttype,
                    status: row.status,
                    requestedByUserId: row.requestedByUserId || row.requestedbyuserid,
                    requestedAt: row.requestedAt || row.requestedat,
                    reviewedByUserId: row.reviewedByUserId || row.reviewedbyuserid,
                    reviewedAt: row.reviewedAt || row.reviewedat,
                    rejectionReason: row.rejectionReason || row.rejectionreason,
                    buyerId: row.buyerId || row.buyerid
                };

                db.all(`SELECT itemid as "itemId", requestid as "requestId", fieldname as "fieldName", oldvalue as "oldValue", newvalue as "newValue", changecategory as "changeCategory", status, rejectionreason as "rejectionReason", reviewedbyuserid as "reviewedByUserId", reviewedat as "reviewedAt" FROM supplier_change_items WHERE requestid = ?`, [requestId], (err, items) => {
                    if (err) return reject(err);
                    normalizedRow.items = (items || []).map(i => ({
                        itemId: i.itemId || i.itemid,
                        requestId: i.requestId || i.requestid,
                        fieldName: i.fieldName || i.fieldname,
                        oldValue: i.oldValue || i.oldvalue,
                        newValue: i.newValue || i.newvalue,
                        changeCategory: i.changeCategory || i.changecategory,
                        status: i.status,
                        rejectionReason: i.rejectionReason || i.rejectionreason,
                        reviewedByUserId: i.reviewedByUserId || i.reviewedbyuserid,
                        reviewedAt: i.reviewedAt || i.reviewedat
                    }));
                    resolve(normalizedRow);
                });
            });
        });
    }

    // Validates role permissions before approving items
    static async approveChangeRequest(requestId, approverId, approverRole) {
        const request = await this.getChangeRequestById(requestId);
        if (!request) throw new Error("Not found");

        const supplierId = request.supplierid || request.supplierId;

        // FETCH ALL PENDING ITEMS FOR THIS SUPPLIER (Consolidated View)
        // We approve ALL pending items for the supplier, matching the UI consolidation.
        const allPendingItems = await new Promise((resolve, reject) => {
            db.all(`
                SELECT i.itemId as "itemId", i.requestId as "requestId", i.fieldName as "fieldName", i.oldValue as "oldValue", i.newValue as "newValue", i.changeCategory as "changeCategory", i.status
                FROM supplier_change_items i
                JOIN supplier_change_requests r ON i.requestid = r.requestid
                WHERE r.supplierid = ? AND r.status = 'PENDING' AND (i.status = 'PENDING' OR i.status IS NULL)
            `, [supplierId], (err, rows) => err ? reject(err) : resolve(rows || []));
        });

        if (allPendingItems.length === 0) {
            await this.cleanupEmptyRequests(supplierId, approverId);
            return { message: "No pending items found for this supplier.", status: "COMPLETED" };
        }

        // Log actual field names so we can verify role mapping
        console.log(`[ChangeRequestService.approveChangeRequest] requestId=${requestId}, supplierId=${supplierId}, approverRole="${approverRole}"`);
        console.log(`[ChangeRequestService.approveChangeRequest] Pending items: ${allPendingItems.map(i => `${i.fieldname || i.fieldName}(${this.getFieldRole(i.fieldname || i.fieldName)})`).join(', ')}`);

        // Filter items based on role
        let targetItemIds = [];
        if (['Admin', 'Buyer Admin', 'ADMIN'].includes(approverRole)) {
            // Admin approves ALL pending
            targetItemIds = allPendingItems.map(i => i.itemId || i.itemid);
        } else {
            // Specific Role approves ONLY their fields (strict).
            // No more 'Shared' pass-through: each field must match the approver role.
            targetItemIds = allPendingItems
                .filter(i => {
                    const fieldName = i.fieldname || i.fieldName;
                    const requiredRole = this.getFieldRole(fieldName);
                    if (!requiredRole || requiredRole === 'Admin') return false;
                    return approverRole.toLowerCase().includes(requiredRole.toLowerCase());
                })
                .map(i => i.itemid || i.itemId);
        }

        console.log(`[ChangeRequestService.approveChangeRequest] targetItemIds for "${approverRole}": [${targetItemIds.join(', ')}]`);

        if (targetItemIds.length === 0) {
            // Finance (or another role) may have already approved their items one-by-one via
            // per-item buttons. The remaining pending items belong to other roles.
            // Run cleanup in case all items are now handled, then return gracefully — do NOT
            // throw an error, because from this role's perspective they have nothing left to do.
            await this.cleanupEmptyRequests(supplierId, approverId);

            if (allPendingItems.length > 0) {
                // Other roles still have pending items — this role is done.
                return { message: "Your items have already been processed. Other roles still have pending items.", status: "ROLE_COMPLETE" };
            }
            return { message: "Request already finalized.", status: "COMPLETED" };
        }

        // Approve the specific items
        const result = await this.approveChangeItem(requestId, targetItemIds, approverId, approverRole);

        // EXTRA: Check if we can close OTHER requests for this supplier too
        // (approveChangeItem might only close the passed 'requestId')
        // We should explicitly cleanup empty requests for this supplier.
        await this.cleanupEmptyRequests(supplierId, approverId);

        return {
            message: "Approved consolidated items.",
            status: result.status,
            updates: result.updates
        };
    }

    static async cleanupEmptyRequests(supplierId, approverId) {
        // Find all PENDING requests for this supplier
        const requests = await new Promise((resolve) => {
            db.all(`SELECT requestId FROM supplier_change_requests WHERE supplierId = ? AND status = 'PENDING'`, [supplierId], (err, rows) => resolve(rows || []));
        });

        for (const req of requests) {
            // Check if it has any pending items
            const pendingCount = await new Promise(resolve => {
                db.get(`SELECT COUNT(*) as count FROM supplier_change_items WHERE requestid = ? AND status = 'PENDING'`, [req.requestId], (err, row) => resolve(row ? row.count : 0));
            });

            if (pendingCount == 0) {
                // Close it
                await this.finalizeRequest(req.requestId, supplierId, approverId);
            }
        }
    }

    static async rejectChangeRequest(requestId, approverId, reason) {
        const request = await this.getChangeRequestById(requestId);
        if (!request) throw new Error("Not found");

        const supplierId = request.supplierid || request.supplierId;

        // BULK REJECTION: Reject ALL pending items for this supplier
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                // 1. Mark all pending items as REJECTED
                db.run(`
                    UPDATE supplier_change_items 
                    SET status = 'REJECTED', reviewedByUserId = ?, reviewedAt = CURRENT_TIMESTAMP
                    WHERE status = 'PENDING' AND requestid IN (
                        SELECT requestid FROM supplier_change_requests WHERE supplierid = ? AND status = 'PENDING'
                    )
                `, [approverId, supplierId], (err) => {
                    if (err) return reject(err);

                    // 2. Mark all pending requests as REJECTED
                    db.run(`
                        UPDATE supplier_change_requests 
                        SET status = 'REJECTED', reviewedbyuserid = ?, reviewedat = CURRENT_TIMESTAMP, rejectionreason = ? 
                        WHERE supplierid = ? AND status = 'PENDING'
                    `, [approverId, reason, supplierId], (err) => {
                        if (err) return reject(err);

                        // 3. Notify Supplier via Notification
                        NotificationService.createNotification({
                            type: 'CHANGE_REQUEST_REJECTED',
                            message: `Your profile updates were rejected. Reason: ${reason}`,
                            entityId: supplierId,
                            recipientRole: 'SUPPLIER',
                            supplierId: supplierId
                        });

                        resolve({ message: "Change Requests Rejected" });
                    });
                });
            });
        });
    }
}

module.exports = ChangeRequestService;

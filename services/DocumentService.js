const db = require('../config/database');
const fs = require('fs');
const DEBUG_LOG = '/tmp/backend_debug.log';
function logDebug(msg) {
    try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) { }
}

class DocumentService {
    static getComplianceStatus(expiryDate) {
        if (!expiryDate) return 'VALID';
        const now = new Date();
        const expiry = new Date(expiryDate);
        const diffTime = expiry - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return 'EXPIRED';
        if (diffDays <= 30) return 'EXPIRING';
        return 'VALID';
    }

    static async getAllDocuments(user) {
        return new Promise((resolve, reject) => {
            let query = '';
            let params = [];

            // RBAC: Filter documents based on user role
            if (!user) {
                return reject(new Error('User not authenticated'));
            }


            if (user.role === 'SUPPLIER') {
                const targetSupplierId = user.supplierId || user.supplierid;
                if (!targetSupplierId) {
                    return reject(new Error('Supplier user has no supplierId'));
                }

                // Security check: if as specific supplierId was requested, must match
                // We'll handle this in Controller or here. Let's do it here for safety.

                query = `
                    SELECT d.*, s.legalname as supplierName
                    FROM documents d
                    JOIN suppliers s ON d.supplierid = s.supplierid
                    WHERE d.supplierid = ?
                `;
                params = [targetSupplierId];
            } else if (user.role === 'BUYER') {
                // Buyer can only see documents from their suppliers
                if (!user.buyerId) {
                    return reject(new Error('Buyer user has no buyerId'));
                }
                query = `
                    SELECT d.*, s.legalname as supplierName
                    FROM documents d
                    JOIN suppliers s ON d.supplierid = s.supplierid
                    WHERE s.buyerid = ?
                `;
                params = [user.buyerId];
            } else if (user.role === 'ADMIN') {
                // Admins should not see documents per business rule
                return resolve([]); // Return empty array instead of error
            } else {
                return reject(new Error('Invalid user role'));
            }

            db.all(query, params, (err, rows) => {
                if (err) return reject(err);

                // Map field names to handle both lowercase and camelCase from database
                const documents = rows.map(d => {
                    const expiryDate = d.expirydate || d.expiryDate;
                    return {
                        documentId: d.documentid || d.documentId,
                        supplierId: d.supplierid || d.supplierId,
                        documentType: d.documenttype || d.documentType,
                        documentName: d.documentname || d.documentName,
                        filePath: d.filepath || d.filePath,
                        fileSize: d.filesize || d.fileSize,
                        fileType: d.filetype || d.fileType,
                        verificationStatus: d.verificationstatus || d.verificationStatus,
                        expiryDate: expiryDate,
                        complianceStatus: DocumentService.getComplianceStatus(expiryDate),
                        notes: d.notes,
                        isActive: d.isactive || d.isActive,
                        uploadedByUserId: d.uploadedbyuserid || d.uploadedByUserId,
                        uploadedByUsername: d.uploadedbyusername || d.uploadedByUsername,
                        verifiedByUserId: d.verifiedbyuserid || d.verifiedByUserId,
                        verifiedAt: d.verifiedat || d.verifiedAt,
                        supplierName: d.legalname || d.legalName
                    };
                });

                resolve(documents);
            });
        });
    }

    static async getSupplierDocuments(supplierId, reqQuery = {}) {
        return new Promise(async (resolve, reject) => {
            try {
                // 1. Fetch persistent documents
                const rawDocs = await new Promise((res, rej) => {
                    logDebug(`getSupplierDocuments: Fetching docs for supplierId: ${supplierId}`);
                    db.all("SELECT * FROM documents WHERE supplierid = ? AND isactive = TRUE ORDER BY documenttype, documentid DESC", [supplierId], (err, rows) => {
                        if (err) {
                            logDebug(`getSupplierDocuments: DB Error: ${err.message}`);
                            return rej(err);
                        }
                        logDebug(`getSupplierDocuments: Found ${rows?.length || 0} persistent docs`);
                        res(rows || []);
                    });
                });

                const docs = rawDocs.map(d => {
                    const expiryDate = d.expirydate || d.expiryDate;
                    return {
                        documentId: d.documentid || d.documentId,
                        supplierId: d.supplierid || d.supplierId,
                        documentType: d.documenttype || d.documentType,
                        documentName: d.documentname || d.documentName,
                        filePath: d.filepath || d.filePath,
                        fileSize: d.filesize || d.fileSize,
                        fileType: d.filetype || d.fileType,
                        verificationStatus: d.verificationstatus || d.verificationStatus,
                        expiryDate: expiryDate,
                        complianceStatus: DocumentService.getComplianceStatus(expiryDate),
                        notes: d.notes,
                        uploadedByUserId: d.uploadedbyuserid || d.uploadedByUserId,
                        createdAt: d.createdat || d.createdAt || new Date().toISOString()
                    };
                });

                // 2. Fetch pending document change requests
                const pendingItems = await new Promise((res, rej) => {
                    db.all(`
                        SELECT i.newvalue, i.itemid, r.requestid, r.requestedat, i.status, i.rejectionreason
                        FROM supplier_change_items i
                        JOIN supplier_change_requests r ON i.requestid = r.requestid
                        WHERE r.supplierid = ? 
                          AND i.fieldname = 'documents'
                          AND i.status IN ('PENDING', 'REJECTED')
                    `, [supplierId], (err, rows) => err ? rej(err) : res(rows || []));
                });

                // 3. Merge
                const pendingDocs = pendingItems.map(item => {
                    try {
                        const d = JSON.parse(item.newValue || item.newvalue);
                        // Determine status
                        let status = item.status;
                        if (status === 'PENDING') status = 'PENDING_APPROVAL';
                        else if (status === 'REJECTED') {
                            const reason = item.rejectionreason || item.rejectionReason || '';
                            if (reason.includes('[REWORK REQUESTED]')) {
                                status = 'REWORK_REQUIRED';
                            }
                        }

                        return {
                            documentId: -(item.itemId || item.itemid), // Handle Postgres casing
                            supplierId: supplierId,
                            documentType: d.documentType,
                            documentName: d.documentName,
                            filePath: d.filePath,
                            fileSize: d.fileSize,
                            fileType: d.fileType,
                            verificationStatus: status,
                            expiryDate: d.expiryDate,
                            complianceStatus: DocumentService.getComplianceStatus(d.expiryDate),
                            notes: d.notes,
                            uploadedByUserId: d.uploadedByUserId,
                            createdAt: item.requestedAt || item.requestedat || new Date().toISOString()
                        };
                    } catch (e) { return null; }
                }).filter(Boolean);

                // 4. Apply Archiving Logic (Latest Approved Wins)
                let allDocs = [...pendingDocs, ...docs];
                const docsByType = {};
                allDocs.forEach(d => {
                    const type = d.documentType || 'Other';
                    if (!docsByType[type]) docsByType[type] = [];
                    docsByType[type].push(d);
                });

                const processedDocs = [];
                Object.values(docsByType).forEach(group => {
                    // Sort by createdAt DESC
                    group.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                    let foundLatestApproved = false;
                    group.forEach(doc => {
                        const status = (doc.verificationStatus || '').toUpperCase();
                        const isApproved = ['APPROVED', 'VERIFIED'].includes(status);

                        if (isApproved) {
                            if (!foundLatestApproved) {
                                foundLatestApproved = true; // Keep as APPROVED/VERIFIED
                            } else {
                                doc.verificationStatus = 'ARCHIVED'; // Flag as old
                            }
                        }
                        processedDocs.push(doc);
                    });
                });

                // Final Sort: Pending first, then by Type
                processedDocs.sort((a, b) => {
                    if (a.documentType < b.documentType) return -1;
                    if (a.documentType > b.documentType) return 1;
                    return new Date(b.createdAt) - new Date(a.createdAt);
                });

                // Apply filtering if documentType is provided
                let filteredDocs = processedDocs;
                if (reqQuery && reqQuery.documentType) {
                    filteredDocs = processedDocs.filter(d => d.documentType === reqQuery.documentType);
                }

                logDebug(`getSupplierDocuments: Final processedDocs count: ${processedDocs.length}`);
                resolve(filteredDocs);
            } catch (err) {
                reject(err);
            }
        });
    }

    static async uploadDocument(data, file, user) {
        const { supplierId, documentType, notes } = data;

        // Check if supplier is APPROVED — if so, route through Change Request
        const supplier = await new Promise((resolve, reject) => {
            db.get("SELECT approvalstatus, buyerid FROM suppliers WHERE supplierid = ?", [supplierId], (err, row) => {
                if (err) {
                    console.error(`[DocumentService] DB Get Error:`, err.message);
                    return reject(err);
                }
                resolve(row);
            });
        });

        const status = supplier?.approvalstatus || supplier?.approvalStatus;

        if (status === 'APPROVED') {
            const ChangeRequestService = require('./ChangeRequestService');
            const buyerId = supplier.buyerid || supplier.buyerId;

            // Store file metadata as JSON in newValue for deferred insertion
            const docMetadata = JSON.stringify({
                documentType: documentType,
                documentName: file.originalname,
                filePath: file.path,
                fileSize: file.size,
                fileType: file.mimetype,
                notes: notes || '',
                uploadedByUserId: user.userId || user.userid,
                uploadedByUsername: user.username
            });

            // Create a Change Request with the document as an item
            return new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO supplier_change_requests (supplierid, requesttype, status, requestedbyuserid, buyerid) VALUES (?, ?, 'PENDING', ?, ?)`,
                    [supplierId, 'DOCUMENT_UPLOAD', user.userId || user.userid, buyerId],
                    function (err) {
                        if (err) return reject(err);
                        const requestId = this.lastID;

                        db.run(
                            `INSERT INTO supplier_change_items (requestid, fieldname, oldvalue, newvalue, changecategory, status) VALUES (?, ?, ?, ?, ?, ?)`,
                            [requestId, 'documents', '', docMetadata, 'MAJOR', 'PENDING'],
                            async (err) => {
                                if (err) return reject(err);

                                // Notify approvers
                                try {
                                    const WorkflowService = require('./WorkflowService');
                                    await WorkflowService.initiateUpdateWorkflow(supplierId, buyerId);
                                    await ChangeRequestService.notifyRelevantApprovers(requestId, buyerId, supplierId, user.userId);
                                } catch (e) {
                                    console.error("[DocumentService] Notification error:", e);
                                }

                                resolve({
                                    message: `Document "${file.originalname}" submitted for approval.`,
                                    status: 'PENDING_APPROVAL',
                                    requestId,
                                    documentId: requestId, // Use requestId as documentId for tracking
                                    documentName: file.originalname,
                                    documentType: documentType
                                });
                            }
                        );
                    }
                );
            });
        }

        // Non-approved supplier: direct insert (onboarding flow, unchanged)
        return new Promise((resolve, reject) => {
            const finalDocumentName = data.documentName || data.documentname || file.originalname;
            db.run(`INSERT INTO documents 
                (supplierid, documenttype, documentname, filepath, filesize, filetype, verificationstatus, notes, uploadedbyuserid, uploadedbyusername) 
                VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
                [supplierId, documentType, finalDocumentName, file.path, file.size, file.mimetype, notes, user.userId || user.userid, user.username],
                function (err) {
                    if (err) {
                        logDebug(`uploadDocument: INSERT Error: ${err.message}`);
                        return reject(err);
                    }
                    const docId = this.lastID;
                    logDebug(`uploadDocument: Successfully inserted docId: ${docId} for supplierId: ${supplierId}`);

                    // Reset supplier status
                    db.run(`
                        UPDATE suppliers 
                        SET approvalstatus = 'SUBMITTED', submittedat = CURRENT_TIMESTAMP 
                        WHERE supplierid = ? AND approvalstatus IN ('APPROVED', 'REWORK_REQUIRED', 'DRAFT', 'SUBMITTED')
                    `, [supplierId], (err) => {
                    });

                    db.get("SELECT * FROM documents WHERE documentid = ?", [docId], (err, row) => {
                        if (row) {
                            row.documentId = row.documentId || row.documentid;
                            row.supplierId = row.supplierId || row.supplierid;
                        }
                        resolve(row);
                    });
                }
            );
        });
    }

    static async deleteDocument(id) {
        return new Promise((resolve, reject) => {
            db.run("DELETE FROM documents WHERE documentid = ?", [id], (err) => err ? reject(err) : resolve());
        });
    }

    static async updateDocumentStatus(documentId, status, notes, userId) {
        return new Promise((resolve, reject) => {
            let dbStatus = status.toUpperCase();
            if (dbStatus === 'APPROVED') dbStatus = 'VERIFIED';

            db.run(`UPDATE documents SET verificationstatus = ?, notes = ?, verifiedbyuserid = ?, verifiedat = CURRENT_TIMESTAMP WHERE documentid = ?`,
                [dbStatus, notes, userId, documentId],
                (err) => {
                    if (err) return reject(err);
                    db.get("SELECT * FROM documents WHERE documentid = ?", [documentId], (err, row) => {
                        if (row) {
                            row.documentId = row.documentid || row.documentId;
                            row.verificationStatus = row.verificationstatus || row.verificationStatus;
                        }
                        resolve(row || { success: true, verificationStatus: dbStatus });
                    });
                }
            );
        });
    }

    /**
     * Get document verification summary for a supplier.
     * Used to determine if Compliance approval button should be visible.
     * All required documents must be VERIFIED for Compliance step to proceed.
     */
    static async getVerificationSummary(supplierId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT documentid, documenttype, documentname, verificationstatus FROM documents WHERE supplierid = ? AND isactive = TRUE`,
                [supplierId],
                (err, rows) => {
                    if (err) return reject(err);

                    const documents = rows || [];
                    const total = documents.length;
                    const verified = documents.filter(d => d.verificationstatus === 'VERIFIED' || d.verificationStatus === 'VERIFIED').length;
                    const pending = documents.filter(d => d.verificationstatus === 'PENDING' || d.verificationStatus === 'PENDING').length;
                    const rejected = documents.filter(d => d.verificationstatus === 'REJECTED' || d.verificationStatus === 'REJECTED').length;
                    const rework = documents.filter(d => d.verificationstatus === 'REWORK_REQUIRED' || d.verificationStatus === 'REWORK_REQUIRED').length;

                    resolve({
                        supplierId,
                        totalDocuments: total,
                        verified,
                        pending,
                        rejected,
                        reworkRequired: rework,
                        allVerified: total > 0 && verified === total,
                        canApproveCompliance: total > 0 && verified === total,
                        documents: documents.map(d => ({
                            documentId: d.documentid || d.documentId,
                            documentType: d.documenttype || d.documentType,
                            documentName: d.documentname || d.documentName,
                            verificationStatus: d.verificationstatus || d.verificationStatus
                        }))
                    });
                }
            );
        });
    }

    static async createDocument(data, user) {
        const { supplierId, documentType, expiryDate, notes, documentName } = data;
        return new Promise((resolve, reject) => {
            db.run(`INSERT INTO documents 
                (supplierid, documenttype, documentname, expirydate, verificationstatus, notes, uploadedbyuserid, uploadedbyusername) 
                VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
                [supplierId, documentType, documentName || 'New Document', expiryDate, notes, user.userId || user.userid, user.username],
                function (err) {
                    if (err) return reject(err);
                    const docId = this.lastID;
                    db.get("SELECT documentid as \"documentId\", supplierid as \"supplierId\", documenttype as \"documentType\", documentname as \"documentName\", expirydate as \"expiryDate\", verificationstatus as \"verificationStatus\", notes, uploadedbyuserid as \"uploadedByUserId\", uploadedbyusername as \"uploadedByUserName\" FROM documents WHERE documentid = ?", [docId], (err, row) => resolve(row));
                }
            );
        });
    }

    static async getExpiringDocuments(query) {
        const { days = 30, supplierId, buyerId } = query;
        return new Promise((resolve, reject) => {
            let sql = `
                SELECT d.*, s.legalname as supplierName
                FROM documents d
                JOIN suppliers s ON d.supplierid = s.supplierid
                WHERE d.expirydate <= CURRENT_DATE + CAST(? AS INTEGER)
                  AND d.expirydate >= CURRENT_DATE
                  AND d.isactive = TRUE
            `;
            const params = [parseInt(days) || 30];
            if (supplierId) {
                sql += ` AND d.supplierid = ?`;
                params.push(supplierId);
            }
            if (buyerId) {
                sql += ` AND s.buyerid = ?`;
                params.push(buyerId);
            }

            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map(d => {
                    const expiryDate = d.expirydate || d.expiryDate;
                    return {
                        documentId: d.documentid || d.documentId,
                        supplierId: d.supplierid || d.supplierId,
                        documentType: d.documenttype || d.documentType,
                        documentName: d.documentname || d.documentName,
                        expiryDate: expiryDate,
                        complianceStatus: DocumentService.getComplianceStatus(expiryDate),
                        verificationStatus: d.verificationstatus || d.verificationStatus,
                        supplierName: d.supplierName || d.legalname
                    };
                }));
            });
        });
    }

    static async getDocumentById(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM documents WHERE documentid = ?", [id], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                const expiryDate = row.expirydate || row.expiryDate;
                resolve({
                    documentId: row.documentid || row.documentId,
                    supplierId: row.supplierid || row.supplierId,
                    documentType: row.documenttype || row.documentType,
                    documentName: row.documentname || row.documentName,
                    filePath: row.filepath || row.filePath,
                    fileSize: row.filesize || row.fileSize,
                    fileType: row.filetype || row.fileType,
                    verificationStatus: row.verificationstatus || row.verificationStatus,
                    expiryDate: expiryDate,
                    complianceStatus: DocumentService.getComplianceStatus(expiryDate),
                    notes: row.notes,
                    uploadedByUserId: row.uploadedbyuserid || row.uploadedByUserId
                });
            });
        });
    }

    static async updateExpiryDate(documentId, expiryDate) {
        return new Promise((resolve, reject) => {
            db.run("UPDATE documents SET expirydate = ? WHERE documentid = ?", [expiryDate, documentId], function (err) {
                if (err) return reject(err);
                db.get("SELECT * FROM documents WHERE documentid = ?", [documentId], (err, row) => {
                    let result = row || {};
                    if (row) {
                        result.documentId = row.documentid || row.documentId;
                        result.expiryDate = row.expirydate || row.expiryDate;
                    }
                    resolve(result);
                });
            });
        });
    }
}

module.exports = DocumentService;

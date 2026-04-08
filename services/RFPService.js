const db = require('../config/database');
const { randomUUID } = require('crypto');
const NotificationService = require('./NotificationService');

const VALID_RFP_TRANSITIONS = {
    DRAFT: ['OPEN'],
    OPEN: ['CLOSED'],
    CLOSED: ['AWARDED', 'ARCHIVED'],
    AWARDED: [],
    ARCHIVED: []
};

class RFPService {

    // ─────────────────────────────────────────────────────────
    // RFP CRUD
    // ─────────────────────────────────────────────────────────

    static async createRFP(data, user) {
        const { name, category, currency, deadline, description, sourceRfiId } = data;
        if (!name) throw new Error('name is required');
        if (!currency) throw new Error('currency is required');
        if (!deadline) throw new Error('deadline is required');
        if (new Date(deadline) <= new Date()) throw new Error('deadline must be a future date');

        const rfpId = randomUUID();
        const buyerId = user.buyerId || null;

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfp (rfp_id, name, category, currency, deadline, description, status, buyer_id, source_rfi_id, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [rfpId, name, category || null, currency, deadline, description || null,
                 buyerId, sourceRfiId || null, user.userId],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFPService._normalize(row));
                    });
                }
            );
        });
    }

    static async listRFPs(user, filters = {}) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT r.*,
                    COALESCE(inv.supplier_count, 0)::int AS supplier_count,
                    COALESCE(sub.submitted_count, 0)::int AS submitted_count
                FROM rfp r
                LEFT JOIN (
                    SELECT rfp_id, COUNT(*)::int AS supplier_count
                    FROM rfp_supplier
                    GROUP BY rfp_id
                ) inv ON inv.rfp_id = r.rfp_id
                LEFT JOIN (
                    SELECT rfp_id, COUNT(*)::int AS submitted_count
                    FROM supplier_rfp_response
                    WHERE status = 'SUBMITTED'
                    GROUP BY rfp_id
                ) sub ON sub.rfp_id = r.rfp_id
                WHERE 1=1`;
            const params = [];

            if (user.buyerId) {
                query += ` AND r.buyer_id = ?`;
                params.push(user.buyerId);
            }
            if (filters.status) {
                query += ` AND r.status = ?`;
                params.push(filters.status);
            }

            query += ` ORDER BY r.created_at DESC`;

            db.all(query, params, (err, rows) => {
                if (err) {
                    // If join tables don't exist yet, fall back to simple rfp-only query
                    console.warn('[RFPService] listRFPs join failed, retrying simple query:', err.message);
                    const simpleQuery = `SELECT *, 0 AS supplier_count, 0 AS submitted_count FROM rfp WHERE 1=1${user.buyerId ? ' AND buyer_id = ?' : ''}${filters.status ? ' AND status = ?' : ''} ORDER BY created_at DESC`;
                    const simpleParams = [...(user.buyerId ? [user.buyerId] : []), ...(filters.status ? [filters.status] : [])];
                    db.all(simpleQuery, simpleParams, (err2, rows2) => {
                        if (err2) return reject(err2);
                        resolve((rows2 || []).map(RFPService._normalize));
                    });
                    return;
                }
                resolve((rows || []).map(RFPService._normalize));
            });
        });
    }

    static async getRFPById(rfpId) {
        const rfp = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err, row) => {
                if (err) return reject(err);
                resolve(row ? RFPService._normalize(row) : null);
            });
        });
        if (!rfp) return null;

        // Attach line items — gracefully fall back to [] if table missing
        rfp.items = await new Promise((resolve) => {
            db.all(`SELECT * FROM rfp_item WHERE rfp_id = ? ORDER BY created_at ASC`, [rfpId], (err, rows) => {
                if (err) { console.error('[RFPService] rfp_item query error:', err.message); return resolve([]); }
                resolve((rows || []).map(RFPService._normalizeItem));
            });
        });

        // Attach suppliers — gracefully fall back to [] if table missing
        // Note: suppliers table has no email column; email is stored directly in rfp_supplier.email
        const loadSuppliers = () => new Promise((resolve) => {
            db.all(
                `SELECT rs.*, s.legalname as supplier_name
                 FROM rfp_supplier rs
                 LEFT JOIN suppliers s ON rs.supplier_id = s.supplierid
                 WHERE rs.rfp_id = ?
                 ORDER BY rs.created_at ASC`,
                [rfpId],
                (err, rows) => {
                    if (err) { console.error('[RFPService] rfp_supplier query error:', err.message); return resolve([]); }
                    resolve((rows || []).map(row => ({
                        id: row.id,
                        rfpId: row.rfp_id,
                        supplierId: row.supplier_id,
                        supplierName: row.supplier_name || null,
                        email: row.email || null,
                        status: row.status,
                        createdAt: row.created_at,
                    })));
                }
            );
        });

        rfp.suppliers = await loadSuppliers();

        // Auto-sync: if this RFP was promoted from an RFI but has no suppliers yet, back-fill them now
        if (rfp.suppliers.length === 0 && rfp.sourceRfiId) {
            try {
                const RFIToRFPService = require('./RFIToRFPService');
                const synced = await RFIToRFPService.syncShortlistedSuppliers(rfp.sourceRfiId, rfpId);
                if (synced > 0) {
                    // Reload suppliers after sync
                    rfp.suppliers = await loadSuppliers();
                    console.log(`[RFPService] Auto-synced ${synced} suppliers from RFI ${rfp.sourceRfiId} into RFP ${rfpId}`);
                }
            } catch (syncErr) {
                console.warn('[RFPService] Auto-sync suppliers failed (non-fatal):', syncErr.message);
            }
        }

        return rfp;
    }

    static async updateRFP(rfpId, data, user) {
        const current = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (!current) throw new Error('RFP not found');
        if (current.status !== 'DRAFT') throw new Error('Only DRAFT RFPs can be updated');

        const { name, category, currency, deadline, description } = data;
        if (deadline && new Date(deadline) <= new Date()) throw new Error('deadline must be a future date');

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfp SET
                    name = COALESCE(?, name),
                    category = COALESCE(?, category),
                    currency = COALESCE(?, currency),
                    deadline = COALESCE(?, deadline),
                    description = COALESCE(?, description),
                    updated_at = CURRENT_TIMESTAMP
                 WHERE rfp_id = ?`,
                [name || null, category || null, currency || null, deadline || null, description || null, rfpId],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFPService._normalize(row));
                    });
                }
            );
        });
    }

    static async publishRFP(rfpId, user) {
        const rfp = await RFPService.getRFPById(rfpId);
        if (!rfp) throw new Error('RFP not found');
        if (rfp.status !== 'DRAFT') throw new Error('Cannot publish: RFP is not in DRAFT status');
        if (!rfp.items || rfp.items.length === 0) throw new Error('Cannot publish: at least 1 line item is required');

        // Update status to OPEN
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfp SET status = 'OPEN', updated_at = CURRENT_TIMESTAMP WHERE rfp_id = ?`,
                [rfpId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Notify invited suppliers (non-blocking — don't fail publish if notifications fail)
        const suppliers = rfp.suppliers || [];
        for (const s of suppliers) {
            if (s.supplierId) {
                NotificationService.createNotification({
                    type: 'RFP_PUBLISHED',
                    message: `New RFP: ${rfp.name} is now open for responses`,
                    entityId: rfpId,
                    recipientRole: 'SUPPLIER',
                    supplierId: s.supplierId,
                    buyerId: rfp.buyerId,
                }).catch(err => console.error('[RFPService] Publish notification error:', err.message));
            }
        }

        // Return updated RFP
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err, row) => {
                if (err) return reject(err);
                resolve(RFPService._normalize(row));
            });
        });
    }

    static async closeRFP(rfpId, user) {
        const current = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (!current) throw new Error('RFP not found');
        if (current.status !== 'OPEN') throw new Error('Cannot close: RFP is not OPEN');

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfp SET status = 'CLOSED', updated_at = CURRENT_TIMESTAMP WHERE rfp_id = ?`,
                [rfpId],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFPService._normalize(row));
                    });
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // LINE ITEMS
    // ─────────────────────────────────────────────────────────

    static async addItem(rfpId, data) {
        const { name, description, quantity, unit, specifications } = data;
        if (!name) throw new Error('item name is required');
        if (!quantity || quantity <= 0) throw new Error('quantity must be greater than 0');

        const itemId = randomUUID();
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfp_item (item_id, rfp_id, name, description, quantity, unit, specifications, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [itemId, rfpId, name, description || null, quantity, unit || null, specifications || null],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfp_item WHERE item_id = ?`, [itemId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFPService._normalizeItem(row));
                    });
                }
            );
        });
    }

    static async updateItem(rfpId, itemId, data) {
        const { name, description, quantity, unit, specifications } = data;
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfp_item SET
                    name = COALESCE(?, name),
                    description = COALESCE(?, description),
                    quantity = COALESCE(?, quantity),
                    unit = COALESCE(?, unit),
                    specifications = COALESCE(?, specifications)
                 WHERE item_id = ? AND rfp_id = ?`,
                [name || null, description || null, quantity || null, unit || null, specifications || null, itemId, rfpId],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfp_item WHERE item_id = ?`, [itemId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFPService._normalizeItem(row));
                    });
                }
            );
        });
    }

    static async deleteItem(rfpId, itemId) {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM rfp_item WHERE item_id = ? AND rfp_id = ?`, [itemId, rfpId], function(err) {
                if (err) return reject(err);
                resolve({ deleted: this.changes > 0 });
            });
        });
    }

    static async listItems(rfpId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM rfp_item WHERE rfp_id = ? ORDER BY created_at ASC`, [rfpId], (err, rows) => {
                if (err) return reject(err);
                resolve((rows || []).map(RFPService._normalizeItem));
            });
        });
    }

    // ─────────────────────────────────────────────────────────
    // SUPPLIER INVITATIONS
    // ─────────────────────────────────────────────────────────

    static async addSuppliers(rfpId, supplierIds, emailInvites, user) {
        const rfp = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (!rfp) throw new Error('RFP not found');

        const results = { added: [], errors: [] };

        // Add by supplierId
        for (const supplierId of (supplierIds || [])) {
            try {
                const sid = parseInt(supplierId, 10);
                if (isNaN(sid)) throw new Error(`Invalid supplierId: ${supplierId}`);

                // suppliers table has no email — get it from users table
                const userRow = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT u.email, s.legalname FROM users u
                         JOIN suppliers s ON s.supplierid = u.supplierid
                         WHERE u.supplierid = ? AND u.role = 'SUPPLIER'
                         LIMIT 1`,
                        [sid], (err, row) => {
                            if (err) return reject(err);
                            resolve(row);
                        }
                    );
                });
                const email = userRow?.email || null;
                const id = randomUUID();

                const inserted = await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO rfp_supplier (id, rfp_id, supplier_id, email, status, created_at)
                         VALUES (?, ?, ?, ?, 'INVITED', CURRENT_TIMESTAMP)
                         ON CONFLICT (rfp_id, supplier_id) DO NOTHING`,
                        [id, rfpId, sid, email],
                        function(err) {
                            if (err) return reject(err);
                            resolve(this.changes > 0);
                        }
                    );
                });

                if (inserted) {
                    results.added.push({ supplierId: sid, email });
                } else {
                    results.added.push({ supplierId: sid, email, alreadyInvited: true });
                }
            } catch (err) {
                console.error('[RFPService] addSuppliers by ID error:', err.message);
                results.errors.push({ supplierId, error: err.message });
            }
        }

        // Add by email
        for (const inv of (emailInvites || [])) {
            try {
                const id = randomUUID();
                const inserted = await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO rfp_supplier (id, rfp_id, supplier_id, email, status, created_at)
                         VALUES (?, ?, NULL, ?, 'INVITED', CURRENT_TIMESTAMP)
                         ON CONFLICT (rfp_id, email) DO NOTHING`,
                        [id, rfpId, inv.email],
                        function(err) {
                            if (err) return reject(err);
                            resolve(this.changes > 0);
                        }
                    );
                });
                if (inserted) {
                    results.added.push({ email: inv.email });
                } else {
                    results.added.push({ email: inv.email, alreadyInvited: true });
                }
            } catch (err) {
                console.error('[RFPService] addSuppliers by email error:', err.message);
                results.errors.push({ email: inv.email, error: err.message });
            }
        }

        return results;
    }

    static async listSuppliers(rfpId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT rs.*, s.legalname as supplier_name,
                        u.email as user_email
                 FROM rfp_supplier rs
                 LEFT JOIN suppliers s ON rs.supplier_id = s.supplierid
                 LEFT JOIN users u ON u.supplierid = rs.supplier_id AND u.role = 'SUPPLIER'
                 WHERE rs.rfp_id = ?
                 ORDER BY rs.created_at ASC`,
                [rfpId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map(row => ({
                        id: row.id,
                        rfpId: row.rfp_id,
                        supplierId: row.supplier_id,
                        supplierName: row.supplier_name || null,
                        email: row.email || row.user_email || null,
                        status: row.status,
                        createdAt: row.created_at,
                    })));
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // SUPPLIER RESPONSES
    // ─────────────────────────────────────────────────────────

    static async getSupplierAwards(supplierId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT
                    a.award_id,
                    a.rfp_id,
                    a.allocation_pct,
                    a.awarded_value,
                    a.notes      AS award_notes,
                    a.created_at AS awarded_at,
                    r.name       AS rfp_name,
                    r.currency,
                    r.status     AS rfp_status,
                    r.deadline,
                    r.description AS rfp_description,
                    r.category,
                    b.buyername  AS buyer_name,
                    resp.submitted_at,
                    (SELECT COUNT(*) FROM rfp_item ri WHERE ri.rfp_id = r.rfp_id) AS item_count,
                    (SELECT COUNT(*) FROM negotiation_round nr WHERE nr.rfp_id = r.rfp_id) AS negotiation_rounds
                 FROM rfp_award a
                 JOIN rfp r       ON r.rfp_id   = a.rfp_id
                 LEFT JOIN buyers b ON b.buyerid = r.buyer_id
                 LEFT JOIN supplier_rfp_response resp
                       ON resp.rfp_id = a.rfp_id AND resp.supplier_id = a.supplier_id
                 WHERE a.supplier_id = ?
                 ORDER BY a.created_at DESC`,
                [supplierId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map(row => ({
                        awardId:          row.award_id,
                        rfpId:            row.rfp_id,
                        rfpName:          row.rfp_name,
                        rfpStatus:        row.rfp_status,
                        rfpDescription:   row.rfp_description || null,
                        category:         row.category || null,
                        currency:         row.currency,
                        deadline:         row.deadline,
                        buyerName:        row.buyer_name || null,
                        allocationPct:    row.allocation_pct != null ? Number(row.allocation_pct) : null,
                        awardedValue:     row.awarded_value != null ? Number(row.awarded_value) : null,
                        awardNotes:       row.award_notes || null,
                        awardedAt:        row.awarded_at,
                        submittedAt:      row.submitted_at || null,
                        itemCount:        Number(row.item_count) || 0,
                        negotiationRounds: Number(row.negotiation_rounds) || 0,
                    })));
                }
            );
        });
    }

    static async getSupplierRFPCount(supplierId) {
        // Count distinct open RFPs where the supplier has a pending action:
        // — invited + hasn't submitted a quote yet, OR
        // — has an open negotiation round with no bid submitted
        return new Promise((resolve) => {
            db.get(
                `SELECT COUNT(DISTINCT r.rfp_id)::int AS count
                 FROM rfp r
                 JOIN rfp_supplier rs ON rs.rfp_id = r.rfp_id AND rs.supplier_id = ?
                 LEFT JOIN supplier_rfp_response resp ON resp.rfp_id = r.rfp_id AND resp.supplier_id = ?
                 LEFT JOIN (
                     SELECT nr.rfp_id
                     FROM negotiation_round nr
                     WHERE nr.status = 'OPEN'
                       AND NOT EXISTS (
                           SELECT 1 FROM negotiation_change nc
                           WHERE nc.round_id = nr.round_id AND nc.supplier_id = ?
                       )
                 ) open_neg ON open_neg.rfp_id = r.rfp_id
                 WHERE r.status = 'OPEN'
                   AND rs.status != 'DECLINED'
                   AND (
                       resp.supplier_id IS NULL
                       OR resp.status != 'SUBMITTED'
                       OR open_neg.rfp_id IS NOT NULL
                   )`,
                [supplierId, supplierId, supplierId],
                (err, row) => resolve(err ? 0 : (Number(row?.count) || 0))
            );
        });
    }

    static async getSupplierRFPs(supplierId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT rs.*, r.name as rfp_name, r.deadline, r.status as rfp_status, r.currency,
                        b.buyername as buyer_name,
                        resp.status as response_status, resp.response_id
                 FROM rfp_supplier rs
                 JOIN rfp r ON rs.rfp_id = r.rfp_id
                 LEFT JOIN buyers b ON r.buyer_id = b.buyerid
                 LEFT JOIN supplier_rfp_response resp ON resp.rfp_id = rs.rfp_id AND resp.supplier_id = ?
                 WHERE rs.supplier_id = ?
                 ORDER BY rs.created_at DESC`,
                [supplierId, supplierId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map(row => ({
                        rfpId: row.rfp_id,
                        rfpName: row.rfp_name,
                        rfpStatus: row.rfp_status,
                        currency: row.currency,
                        buyerName: row.buyer_name,
                        deadline: row.deadline,
                        inviteStatus: row.status,
                        responseStatus: row.response_status || null,
                        responseId: row.response_id || null,
                    })));
                }
            );
        });
    }

    static async getMyRFPForSupplier(rfpId, supplierId) {
        const rfp = await RFPService.getRFPById(rfpId);
        if (!rfp) throw new Error('RFP not found');

        // Get invite status for this supplier
        const invite = await new Promise((resolve) => {
            db.get(
                `SELECT status FROM rfp_supplier WHERE rfp_id = ? AND supplier_id = ?`,
                [rfpId, supplierId],
                (err, row) => resolve(row || null)
            );
        });

        // Get existing response
        const response = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM supplier_rfp_response WHERE rfp_id = ? AND supplier_id = ?`,
                [rfpId, supplierId],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });

        let responseItems = [];
        if (response) {
            responseItems = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT * FROM rfp_response_item WHERE response_id = ?`,
                    [response.response_id],
                    (err, rows) => {
                        if (err) return reject(err);
                        resolve(rows || []);
                    }
                );
            });
        }

        // Get open negotiation rounds and this supplier's changes
        const negotiationRounds = await new Promise((resolve) => {
            db.all(
                `SELECT nr.*,
                        (SELECT COUNT(*) FROM negotiation_change nc WHERE nc.round_id = nr.round_id AND nc.supplier_id = ?) as has_bid
                 FROM negotiation_round nr
                 WHERE nr.rfp_id = ?
                 ORDER BY nr.round_number ASC`,
                [supplierId, rfpId],
                (err, rows) => resolve(rows || [])
            );
        });

        // Get award status for this supplier
        const award = await new Promise((resolve) => {
            db.get(
                `SELECT * FROM rfp_award WHERE rfp_id = ? AND supplier_id = ?`,
                [rfpId, supplierId],
                (err, row) => resolve(row || null)
            );
        });

        return {
            rfp,
            inviteStatus: invite?.status || null,
            response: response ? {
                responseId: response.response_id,
                status: response.status,
                submittedAt: response.submitted_at,
                notes: response.notes,
                items: responseItems.map(ri => ({
                    id: ri.id,
                    itemId: ri.item_id,
                    price: ri.price,
                    leadTime: ri.lead_time,
                    moq: ri.moq,
                    notes: ri.notes,
                })),
            } : null,
            negotiationRounds: negotiationRounds.map(nr => ({
                roundId: nr.round_id,
                roundNumber: nr.round_number,
                status: nr.status,
                notes: nr.notes,
                createdAt: nr.created_at,
                closedAt: nr.closed_at,
                hasBid: Number(nr.has_bid) > 0,
            })),
            award: award ? {
                awardId: award.award_id,
                allocationPct: award.allocation_pct,
                awardedValue: award.awarded_value,
                createdAt: award.created_at,
            } : null,
        };
    }

    static async respondToInvitation(rfpId, supplierId, action) {
        const newStatus = action === 'accept' ? 'ACCEPTED' : 'DECLINED';

        const existing = await new Promise((resolve) => {
            db.get(
                `SELECT id FROM rfp_supplier WHERE rfp_id = ? AND supplier_id = ?`,
                [rfpId, supplierId],
                (err, row) => resolve(row || null)
            );
        });
        if (!existing) throw new Error('Invitation not found');

        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfp_supplier SET status = ? WHERE rfp_id = ? AND supplier_id = ?`,
                [newStatus, rfpId, supplierId],
                (err) => err ? reject(err) : resolve()
            );
        });

        return { status: newStatus };
    }

    static async saveResponseDraft(rfpId, supplierId, data) {
        const { notes, items } = data;

        // Upsert response header
        let responseId = await new Promise((resolve, reject) => {
            db.get(
                `SELECT response_id FROM supplier_rfp_response WHERE rfp_id = ? AND supplier_id = ?`,
                [rfpId, supplierId],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row ? row.response_id : null);
                }
            );
        });

        if (!responseId) {
            responseId = randomUUID();
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO supplier_rfp_response (response_id, rfp_id, supplier_id, status, notes, created_at, updated_at)
                     VALUES (?, ?, ?, 'DRAFT', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                    [responseId, rfpId, supplierId, notes || null],
                    (err) => err ? reject(err) : resolve()
                );
            });
        } else {
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE supplier_rfp_response SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE response_id = ?`,
                    [notes || null, responseId],
                    (err) => err ? reject(err) : resolve()
                );
            });
        }

        // Upsert response items
        for (const item of (items || [])) {
            const existing = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT id FROM rfp_response_item WHERE response_id = ? AND item_id = ?`,
                    [responseId, item.itemId],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            if (existing) {
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE rfp_response_item SET price = ?, lead_time = ?, moq = ?, notes = ? WHERE id = ?`,
                        [item.price || null, item.leadTime || null, item.moq || null, item.notes || null, existing.id],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            } else {
                const id = randomUUID();
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO rfp_response_item (id, response_id, item_id, price, lead_time, moq, notes)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [id, responseId, item.itemId, item.price || null, item.leadTime || null, item.moq || null, item.notes || null],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            }
        }

        return { responseId, status: 'DRAFT' };
    }

    static async submitResponse(rfpId, supplierId, data) {
        const draft = await RFPService.saveResponseDraft(rfpId, supplierId, data);

        // Validate at least one item has a price
        const items = await new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM rfp_response_item WHERE response_id = ?`,
                [draft.responseId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });

        const hasPrice = items.some(i => i.price !== null && i.price !== undefined);
        if (!hasPrice) throw new Error('At least one item must have a price before submission');

        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE supplier_rfp_response SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE response_id = ?`,
                [draft.responseId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Update rfp_supplier status
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfp_supplier SET status = 'SUBMITTED' WHERE rfp_id = ? AND supplier_id = ?`,
                [rfpId, supplierId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Generate insights
        await RFPService._generateInsights(rfpId).catch(err => {
            console.error('[RFPService] Insight generation error:', err.message);
        });

        return { responseId: draft.responseId, status: 'SUBMITTED' };
    }

    // ─────────────────────────────────────────────────────────
    // COMPARISON & INSIGHTS
    // ─────────────────────────────────────────────────────────

    static async getComparisonData(rfpId) {
        const rfp = await RFPService.getRFPById(rfpId);
        if (!rfp) throw new Error('RFP not found');

        // Get all submitted responses
        const responses = await new Promise((resolve, reject) => {
            db.all(
                `SELECT r.*, s.legalname as supplier_name
                 FROM supplier_rfp_response r
                 LEFT JOIN suppliers s ON r.supplier_id = s.supplierid
                 WHERE r.rfp_id = ? AND r.status = 'SUBMITTED'`,
                [rfpId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });

        // Get all response items for submitted responses
        const comparisonMatrix = [];
        for (const item of rfp.items) {
            const row = {
                itemId: item.itemId,
                itemName: item.name,
                quantity: item.quantity,
                unit: item.unit,
                suppliers: [],
            };

            let lowestPrice = null;
            for (const resp of responses) {
                const ri = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT * FROM rfp_response_item WHERE response_id = ? AND item_id = ?`,
                        [resp.response_id, item.itemId],
                        (err, r) => {
                            if (err) return reject(err);
                            resolve(r);
                        }
                    );
                });

                const price = ri ? parseFloat(ri.price) : null;
                const totalCost = price !== null ? price * item.quantity : null;

                if (price !== null && (lowestPrice === null || price < lowestPrice)) {
                    lowestPrice = price;
                }

                row.suppliers.push({
                    supplierId: resp.supplier_id,
                    supplierName: resp.supplier_name || `Supplier ${resp.supplier_id}`,
                    price,
                    leadTime: ri ? ri.lead_time : null,
                    moq: ri ? ri.moq : null,
                    notes: ri ? ri.notes : null,
                    totalCost,
                });
            }

            // Mark lowest price
            row.suppliers = row.suppliers.map(s => ({
                ...s,
                isLowest: s.price !== null && s.price === lowestPrice,
            }));
            row.lowestPrice = lowestPrice;
            comparisonMatrix.push(row);
        }

        // Get insights
        const insights = await new Promise((resolve, reject) => {
            db.all(
                `SELECT ins.*, s.legalname as supplier_name FROM rfp_insight ins
                 LEFT JOIN suppliers s ON ins.supplier_id = s.supplierid
                 WHERE ins.rfp_id = ? ORDER BY ins.created_at DESC`,
                [rfpId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map(row => ({
                        insightId: row.insight_id,
                        type: row.type,
                        message: row.message,
                        severity: row.severity,
                        supplierId: row.supplier_id,
                        supplierName: row.supplier_name,
                    })));
                }
            );
        });

        return {
            rfp,
            comparisonMatrix,
            insights,
            totalSuppliers: responses.length,
        };
    }

    static async _generateInsights(rfpId) {
        // Delete existing auto-generated insights
        await new Promise((resolve, reject) => {
            db.run(`DELETE FROM rfp_insight WHERE rfp_id = ? AND auto_generated = 1`, [rfpId], (err) => {
                err ? reject(err) : resolve();
            });
        });

        const data = await RFPService.getComparisonData(rfpId);

        for (const row of data.comparisonMatrix) {
            const prices = row.suppliers.filter(s => s.price !== null).map(s => s.price);
            if (prices.length < 2) continue;

            const sortedPrices = [...prices].sort((a, b) => a - b);
            const lowestPrice = sortedPrices[0];
            const median = prices.reduce((a, b) => a + b, 0) / prices.length;

            for (const s of row.suppliers) {
                if (s.price === null) continue;

                const pctAboveLowest = ((s.price - lowestPrice) / lowestPrice) * 100;

                if (!s.isLowest && pctAboveLowest > 10) {
                    const insightId = randomUUID();
                    await new Promise((resolve, reject) => {
                        db.run(
                            `INSERT INTO rfp_insight (insight_id, rfp_id, supplier_id, type, message, severity, auto_generated, created_at)
                             VALUES (?, ?, ?, 'PRICE_GAP', ?, ?, 1, CURRENT_TIMESTAMP)
                             ON CONFLICT (insight_id) DO NOTHING`,
                            [
                                insightId, rfpId, s.supplierId,
                                `${s.supplierName} quoted ${pctAboveLowest.toFixed(1)}% above the lowest price for "${row.itemName}"`,
                                pctAboveLowest > 25 ? 'HIGH' : 'MEDIUM'
                            ],
                            (err) => err ? reject(err) : resolve()
                        );
                    });
                }

                // Lead time insight
                const leadTimes = row.suppliers.filter(s => s.leadTime).map(s => parseInt(s.leadTime));
                if (leadTimes.length >= 2 && s.leadTime) {
                    const minLeadTime = Math.min(...leadTimes);
                    if (parseInt(s.leadTime) === minLeadTime) {
                        const insightId = randomUUID();
                        await new Promise((resolve, reject) => {
                            db.run(
                                `INSERT INTO rfp_insight (insight_id, rfp_id, supplier_id, type, message, severity, auto_generated, created_at)
                                 VALUES (?, ?, ?, 'LEAD_TIME', ?, 'LOW', 1, CURRENT_TIMESTAMP)
                                 ON CONFLICT (insight_id) DO NOTHING`,
                                [insightId, rfpId, s.supplierId,
                                 `${s.supplierName} has the fastest delivery at ${s.leadTime} days for "${row.itemName}"`],
                                (err) => err ? reject(err) : resolve()
                            );
                        });
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // NEGOTIATION
    // ─────────────────────────────────────────────────────────

    static async createNegotiationRound(rfpId, user) {
        const rfp = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (!rfp) throw new Error('RFP not found');
        if (!['OPEN', 'CLOSED'].includes(rfp.status)) throw new Error('RFP must be OPEN or CLOSED for negotiation');

        // Check previous round is complete
        const lastRound = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM negotiation_round WHERE rfp_id = ? ORDER BY round_number DESC LIMIT 1`,
                [rfpId],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });

        if (lastRound && lastRound.status === 'OPEN') {
            throw new Error('Previous negotiation round must be closed before starting a new one');
        }

        const roundNumber = lastRound ? lastRound.round_number + 1 : 1;
        const roundId = randomUUID();

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO negotiation_round (round_id, rfp_id, round_number, status, created_by, created_at)
                 VALUES (?, ?, ?, 'OPEN', ?, CURRENT_TIMESTAMP)`,
                [roundId, rfpId, roundNumber, user.userId],
                function(err) {
                    if (err) return reject(err);
                    resolve({ roundId, rfpId, roundNumber, status: 'OPEN' });
                }
            );
        });
    }

    static async listNegotiationRounds(rfpId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT nr.*, COUNT(nc.id) as change_count
                 FROM negotiation_round nr
                 LEFT JOIN negotiation_change nc ON nc.round_id = nr.round_id
                 WHERE nr.rfp_id = ?
                 GROUP BY nr.round_id
                 ORDER BY nr.round_number ASC`,
                [rfpId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map(row => ({
                        roundId: row.round_id,
                        rfpId: row.rfp_id,
                        roundNumber: row.round_number,
                        status: row.status,
                        changeCount: row.change_count,
                        createdAt: row.created_at,
                    })));
                }
            );
        });
    }

    static async closeNegotiationRound(rfpId, roundId, user) {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE negotiation_round SET status = 'CLOSED' WHERE round_id = ? AND rfp_id = ?`,
                [roundId, rfpId],
                function(err) {
                    if (err) return reject(err);
                    if (this.changes === 0) return reject(new Error('Round not found'));
                    resolve({ roundId, status: 'CLOSED' });
                }
            );
        });
    }

    static async submitNegotiationBid(rfpId, supplierId, data) {
        const { roundId, items } = data;

        // Validate round is open
        const round = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM negotiation_round WHERE round_id = ? AND rfp_id = ? AND status = 'OPEN'`,
                [roundId, rfpId],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });
        if (!round) throw new Error('Negotiation round not found or not open');

        const changes = [];
        for (const item of (items || [])) {
            // Get previous price
            const prevResponse = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT ri.price FROM rfp_response_item ri
                     JOIN supplier_rfp_response r ON ri.response_id = r.response_id
                     WHERE r.rfp_id = ? AND r.supplier_id = ? AND ri.item_id = ?
                     ORDER BY r.updated_at DESC LIMIT 1`,
                    [rfpId, supplierId, item.itemId],
                    (err, row) => {
                        if (err) return reject(err);
                        resolve(row);
                    }
                );
            });

            const prevPrice = prevResponse ? parseFloat(prevResponse.price) : null;
            const newPrice = parseFloat(item.newPrice);
            const deltaPct = prevPrice ? ((newPrice - prevPrice) / prevPrice) * 100 : null;

            const id = randomUUID();
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO negotiation_change (id, round_id, rfp_id, supplier_id, item_id, prev_price, new_price, delta_pct, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                    [id, roundId, rfpId, supplierId, item.itemId, prevPrice, newPrice, deltaPct],
                    (err) => err ? reject(err) : resolve()
                );
            });

            // Update response item with new price
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE rfp_response_item SET price = ?
                     WHERE response_id = (SELECT response_id FROM supplier_rfp_response WHERE rfp_id = ? AND supplier_id = ? LIMIT 1)
                     AND item_id = ?`,
                    [newPrice, rfpId, supplierId, item.itemId],
                    (err) => err ? reject(err) : resolve()
                );
            });

            changes.push({ itemId: item.itemId, prevPrice, newPrice, deltaPct });
        }

        return { roundId, changes };
    }

    static async getNegotiationChanges(rfpId, roundId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT nc.*, s.legalname as supplier_name, ri.name as item_name
                 FROM negotiation_change nc
                 LEFT JOIN suppliers s ON nc.supplier_id = s.supplierid
                 LEFT JOIN rfp_item ri ON nc.item_id = ri.item_id
                 WHERE nc.round_id = ?
                 ORDER BY nc.created_at ASC`,
                [roundId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map(row => ({
                        id: row.id,
                        supplierId: row.supplier_id,
                        supplierName: row.supplier_name,
                        itemId: row.item_id,
                        itemName: row.item_name,
                        prevPrice: row.prev_price,
                        newPrice: row.new_price,
                        deltaPct: row.delta_pct,
                    })));
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // AWARD
    // ─────────────────────────────────────────────────────────

    static async awardRFP(rfpId, awards, user) {
        const rfp = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfp WHERE rfp_id = ?`, [rfpId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
        if (!rfp) throw new Error('RFP not found');
        if (!['CLOSED', 'OPEN'].includes(rfp.status)) throw new Error('RFP must be OPEN or CLOSED to award');
        if (!awards || awards.length === 0) throw new Error('At least one award is required');

        const savedAwards = [];
        for (const award of awards) {
            const awardId = randomUUID();
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO rfp_award (award_id, rfp_id, supplier_id, allocation_pct, awarded_value, notes, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                    [awardId, rfpId, award.supplierId,
                     award.allocationPct != null ? Number(award.allocationPct) : null,
                     award.awardedValue != null ? Number(award.awardedValue) : null,
                     award.notes || null],
                    (err) => err ? reject(err) : resolve()
                );
            });

            // Update supplier status
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE rfp_supplier SET status = 'AWARDED' WHERE rfp_id = ? AND supplier_id = ?`,
                    [rfpId, award.supplierId],
                    (err) => err ? reject(err) : resolve()
                );
            });

            savedAwards.push({ awardId, supplierId: award.supplierId });
        }

        // Mark non-awarded submitted suppliers as DECLINED
        await new Promise((resolve, reject) => {
            const awardedIds = awards.map(a => a.supplierId);
            const placeholders = awardedIds.map(() => '?').join(',');
            db.run(
                `UPDATE rfp_supplier SET status = 'DECLINED'
                 WHERE rfp_id = ? AND status = 'SUBMITTED' AND supplier_id NOT IN (${placeholders})`,
                [rfpId, ...awardedIds],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Update RFP status to AWARDED
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfp SET status = 'AWARDED', updated_at = CURRENT_TIMESTAMP WHERE rfp_id = ?`,
                [rfpId],
                (err) => err ? reject(err) : resolve()
            );
        });

        // Notify awarded suppliers
        for (const a of savedAwards) {
            await NotificationService.createNotification({
                type: 'RFP_AWARDED',
                message: `Congratulations! You have been awarded the RFP: ${rfp.name}`,
                entityId: rfpId,
                recipientRole: 'SUPPLIER',
                supplierId: a.supplierId,
                buyerId: rfp.buyer_id,
            }).catch(err => console.error('[RFPService] Award notification error:', err.message));
        }

        return { rfpId, status: 'AWARDED', awards: savedAwards };
    }

    static async getAwards(rfpId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT a.*, s.legalname as supplier_name
                 FROM rfp_award a
                 LEFT JOIN suppliers s ON a.supplier_id = s.supplierid
                 WHERE a.rfp_id = ?
                 ORDER BY a.created_at ASC`,
                [rfpId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map(row => ({
                        awardId: row.award_id,
                        rfpId: row.rfp_id,
                        supplierId: row.supplier_id,
                        supplierName: row.supplier_name,
                        allocationPct: row.allocation_pct,
                        awardedValue: row.awarded_value,
                        notes: row.notes,
                        createdAt: row.created_at,
                    })));
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────

    static _normalize(row) {
        if (!row) return null;
        return {
            rfpId: row.rfp_id,
            name: row.name,
            category: row.category,
            currency: row.currency,
            deadline: row.deadline,
            description: row.description,
            status: row.status,
            buyerId: row.buyer_id,
            sourceRfiId: row.source_rfi_id,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            supplierCount: Number(row.supplier_count ?? 0),
            submittedCount: Number(row.submitted_count ?? 0),
        };
    }

    static _normalizeItem(row) {
        if (!row) return null;
        return {
            itemId: row.item_id,
            rfpId: row.rfp_id,
            name: row.name,
            description: row.description,
            quantity: row.quantity,
            unit: row.unit,
            specifications: row.specifications,
            createdAt: row.created_at,
        };
    }
}

module.exports = RFPService;

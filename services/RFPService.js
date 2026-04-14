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
        const { name, category, currency, deadline, description, sourceRfiId,
                buRegion, incoterms, contactPerson, instructions, requireComplianceAck,
                requireIso, requireGmp, requireFsc, minRevenueM,
                weightCommercial, weightTechnical, weightQuality, weightLogistics, weightEsg } = data;
        if (!name) throw new Error('name is required');
        if (!currency) throw new Error('currency is required');
        if (!deadline) throw new Error('deadline is required');
        if (new Date(deadline) <= new Date()) throw new Error('deadline must be a future date');

        const rfpId = randomUUID();
        const buyerId = user.buyerId || null;

        // Normalise scoring weights — must sum to 100, fall back to defaults
        const wC = parseFloat(weightCommercial) || 40;
        const wT = parseFloat(weightTechnical)  || 25;
        const wQ = parseFloat(weightQuality)    || 15;
        const wL = parseFloat(weightLogistics)  || 10;
        const wE = parseFloat(weightEsg)        || 10;

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfp (rfp_id, name, category, currency, deadline, description, status, buyer_id, source_rfi_id,
                                  bu_region, incoterms, contact_person, instructions, require_compliance_ack,
                                  require_iso, require_gmp, require_fsc, min_revenue_m,
                                  weight_commercial, weight_technical, weight_quality, weight_logistics, weight_esg,
                                  created_by, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
                [rfpId, name, category || null, currency, deadline, description || null,
                 buyerId, sourceRfiId || null,
                 buRegion || null, incoterms || null, contactPerson || null, instructions || null,
                 requireComplianceAck || false,
                 requireIso || false, requireGmp || false, requireFsc || false, minRevenueM || 0,
                 wC, wT, wQ, wL, wE,
                 user.userId],
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

        const { name, category, currency, deadline, description,
                buRegion, incoterms, contactPerson, instructions, requireComplianceAck,
                requireIso, requireGmp, requireFsc, minRevenueM,
                weightCommercial, weightTechnical, weightQuality, weightLogistics, weightEsg } = data;
        if (deadline && new Date(deadline) <= new Date()) throw new Error('deadline must be a future date');

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfp SET
                    name = COALESCE($1, name),
                    category = COALESCE($2, category),
                    currency = COALESCE($3, currency),
                    deadline = COALESCE($4, deadline),
                    description = COALESCE($5, description),
                    bu_region = COALESCE($6, bu_region),
                    incoterms = COALESCE($7, incoterms),
                    contact_person = COALESCE($8, contact_person),
                    instructions = COALESCE($9, instructions),
                    require_compliance_ack = COALESCE($10, require_compliance_ack),
                    require_iso = COALESCE($11, require_iso),
                    require_gmp = COALESCE($12, require_gmp),
                    require_fsc = COALESCE($13, require_fsc),
                    min_revenue_m = COALESCE($14, min_revenue_m),
                    weight_commercial = COALESCE($15, weight_commercial),
                    weight_technical = COALESCE($16, weight_technical),
                    weight_quality = COALESCE($17, weight_quality),
                    weight_logistics = COALESCE($18, weight_logistics),
                    weight_esg = COALESCE($19, weight_esg),
                    updated_at = CURRENT_TIMESTAMP
                 WHERE rfp_id = $20`,
                [name || null, category || null, currency || null, deadline || null, description || null,
                 buRegion || null, incoterms || null, contactPerson || null, instructions || null,
                 requireComplianceAck != null ? requireComplianceAck : null,
                 requireIso != null ? requireIso : null,
                 requireGmp != null ? requireGmp : null,
                 requireFsc != null ? requireFsc : null,
                 minRevenueM != null ? minRevenueM : null,
                 weightCommercial != null ? parseFloat(weightCommercial) : null,
                 weightTechnical != null ? parseFloat(weightTechnical) : null,
                 weightQuality != null ? parseFloat(weightQuality) : null,
                 weightLogistics != null ? parseFloat(weightLogistics) : null,
                 weightEsg != null ? parseFloat(weightEsg) : null,
                 rfpId],
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
        const { name, description, quantity, unit, specifications, targetPrice, targetPriceNote } = data;
        if (!name) throw new Error('item name is required');
        if (!quantity || quantity <= 0) throw new Error('quantity must be greater than 0');

        const itemId = randomUUID();
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfp_item (item_id, rfp_id, name, description, quantity, unit, specifications, target_price, target_price_note, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)`,
                [itemId, rfpId, name, description || null, quantity, unit || null, specifications || null,
                 targetPrice || null, targetPriceNote || null],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfp_item WHERE item_id = $1`, [itemId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFPService._normalizeItem(row));
                    });
                }
            );
        });
    }

    static async updateItem(rfpId, itemId, data) {
        const { name, description, quantity, unit, specifications, targetPrice, targetPriceNote } = data;
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfp_item SET
                    name = COALESCE($1, name),
                    description = COALESCE($2, description),
                    quantity = COALESCE($3, quantity),
                    unit = COALESCE($4, unit),
                    specifications = COALESCE($5, specifications),
                    target_price = COALESCE($6, target_price),
                    target_price_note = COALESCE($7, target_price_note)
                 WHERE item_id = $8 AND rfp_id = $9`,
                [name || null, description || null, quantity || null, unit || null, specifications || null,
                 targetPrice || null, targetPriceNote || null, itemId, rfpId],
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
        const { notes, items, complianceAckAccepted } = data;

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
                    `INSERT INTO supplier_rfp_response (response_id, rfp_id, supplier_id, status, notes, compliance_ack_accepted, created_at, updated_at)
                     VALUES (?, ?, ?, 'DRAFT', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                    [responseId, rfpId, supplierId, notes || null, complianceAckAccepted ? true : false],
                    (err) => err ? reject(err) : resolve()
                );
            });
        } else {
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE supplier_rfp_response SET notes = ?, compliance_ack_accepted = ?, updated_at = CURRENT_TIMESTAMP WHERE response_id = ?`,
                    [notes || null, complianceAckAccepted ? true : false, responseId],
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
                        `UPDATE rfp_response_item
                         SET price=$1, lead_time=$2, moq=$3, notes=$4,
                             raw_material_cost=$5, conversion_cost=$6, labor_cost=$7,
                             logistics_cost=$8, overhead_cost=$9, supplier_margin=$10
                         WHERE id=$11`,
                        [item.price || null, item.leadTime || null, item.moq || null, item.notes || null,
                         item.rawMaterialCost || null, item.conversionCost || null, item.laborCost || null,
                         item.logisticsCost || null, item.overheadCost || null, item.supplierMargin || null,
                         existing.id],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            } else {
                const id = randomUUID();
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO rfp_response_item
                             (id, response_id, item_id, price, lead_time, moq, notes,
                              raw_material_cost, conversion_cost, labor_cost, logistics_cost, overhead_cost, supplier_margin)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                        [id, responseId, item.itemId, item.price || null, item.leadTime || null, item.moq || null, item.notes || null,
                         item.rawMaterialCost || null, item.conversionCost || null, item.laborCost || null,
                         item.logisticsCost || null, item.overheadCost || null, item.supplierMargin || null],
                        (err) => err ? reject(err) : resolve()
                    );
                });
            }
        }

        return { responseId, status: 'DRAFT' };
    }

    static async submitResponse(rfpId, supplierId, data) {
        // Compliance ack gate — enforce if buyer requires it
        const rfpRow = await new Promise((resolve) => {
            db.get(`SELECT require_compliance_ack FROM rfp WHERE rfp_id = $1`, [rfpId], (err, row) => resolve(row));
        });
        if (rfpRow?.require_compliance_ack) {
            const ackAccepted = data.complianceAckAccepted === true || data.complianceAckAccepted === 'true';
            if (!ackAccepted) {
                throw new Error('You must accept the compliance acknowledgement before submitting this response');
            }
        }

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
            // Section 1 enhancements
            buRegion: row.bu_region || null,
            incoterms: row.incoterms || null,
            contactPerson: row.contact_person || null,
            instructions: row.instructions || null,
            requireComplianceAck: row.require_compliance_ack || false,
            // Section 2/6 — buyer certification gates
            requireIso: row.require_iso || false,
            requireGmp: row.require_gmp || false,
            requireFsc: row.require_fsc || false,
            minRevenueM: row.min_revenue_m != null ? Number(row.min_revenue_m) : 0,
            // Configurable scoring weights
            weightCommercial: row.weight_commercial != null ? Number(row.weight_commercial) : 40,
            weightTechnical:  row.weight_technical  != null ? Number(row.weight_technical)  : 25,
            weightQuality:    row.weight_quality    != null ? Number(row.weight_quality)    : 15,
            weightLogistics:  row.weight_logistics  != null ? Number(row.weight_logistics)  : 10,
            weightEsg:        row.weight_esg        != null ? Number(row.weight_esg)        : 10,
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
            targetPrice: row.target_price != null ? Number(row.target_price) : null,
            targetPriceNote: row.target_price_note || null,
            createdAt: row.created_at,
        };
    }

    // ─────────────────────────────────────────────────────────
    // SECTION 2 — Supplier Qualification
    // ─────────────────────────────────────────────────────────

    static async saveQualificationResponse(rfpId, supplierId, data) {
        const {
            legalEntity, headquarters, annualRevenue, employees,
            monthlyCapacity, certifications, majorClients, financialNotes
        } = data;

        // Auto-score: Financial (20%), Capability (40%), Experience (25%), Compliance (15%)
        const revenue = parseFloat(annualRevenue) || 0;
        const financialScore = revenue > 50000000 ? 100 : revenue > 10000000 ? 70 : revenue > 1000000 ? 40 : 10;

        const capScore = employees > 500 ? 100 : employees > 100 ? 70 : employees > 20 ? 40 : 10;

        const certs = Array.isArray(certifications) ? certifications : [];
        const complianceScore = Math.min(100, certs.length * 25);

        const expScore = majorClients ? Math.min(100, majorClients.split(',').length * 20) : 20;

        const totalQualScore = (
            financialScore * 0.20 +
            capScore * 0.40 +
            expScore * 0.25 +
            complianceScore * 0.15
        );

        // Risk / auto-disqualification — uses buyer's min_revenue_m field from RFP
        const rfpRow = await new Promise((r) =>
            db.get(`SELECT min_revenue_m FROM rfp WHERE rfp_id=$1`, [rfpId], (e, row) => r(row))
        );
        const minRevM = rfpRow?.min_revenue_m != null ? Number(rfpRow.min_revenue_m) : 0;
        // Convert min_revenue_m (millions) to actual value for comparison; fallback 100K absolute minimum
        const hardMinRevenue = Math.max(100000, minRevM * 1_000_000);

        let isDisqualified = false;
        const disqualReasons = [];
        if (revenue > 0 && revenue < hardMinRevenue) {
            isDisqualified = true;
            disqualReasons.push(
                minRevM > 0
                    ? `Annual revenue below required minimum ($${minRevM}M)`
                    : `Annual revenue below minimum threshold ($100K)`
            );
        }
        const disqualificationReason = disqualReasons.length > 0 ? disqualReasons.join('; ') : null;

        const certsJson = JSON.stringify(certs);

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfp_qualification_response
                    (rfp_id, supplier_id, legal_entity, headquarters, annual_revenue, employees,
                     monthly_capacity, certifications, major_clients, financial_notes,
                     financial_score, capability_score, experience_score, compliance_score,
                     total_qual_score, is_disqualified, disqualification_reason,
                     created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
                 ON CONFLICT (rfp_id, supplier_id) DO UPDATE SET
                    legal_entity=$3, headquarters=$4, annual_revenue=$5, employees=$6,
                    monthly_capacity=$7, certifications=$8, major_clients=$9, financial_notes=$10,
                    financial_score=$11, capability_score=$12, experience_score=$13, compliance_score=$14,
                    total_qual_score=$15, is_disqualified=$16, disqualification_reason=$17,
                    updated_at=NOW()`,
                [rfpId, supplierId, legalEntity||null, headquarters||null, annualRevenue||null,
                 employees||null, monthlyCapacity||null, certsJson, majorClients||null, financialNotes||null,
                 financialScore, capScore, expScore, complianceScore, totalQualScore,
                 isDisqualified, disqualificationReason],
                (err) => err ? reject(err) : resolve()
            );
        });

        return { totalQualScore: Math.round(totalQualScore), isDisqualified, disqualificationReason };
    }

    static async getQualificationResponses(rfpId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT q.*, s.legalname AS supplier_name
                 FROM rfp_qualification_response q
                 LEFT JOIN suppliers s ON q.supplier_id = s.supplierid
                 WHERE q.rfp_id = $1 ORDER BY q.total_qual_score DESC`,
                [rfpId],
                (err, rows) => {
                    if (err) return resolve([]);
                    resolve((rows || []).map(r => ({
                        supplierId: r.supplier_id,
                        supplierName: r.supplier_name,
                        legalEntity: r.legal_entity,
                        headquarters: r.headquarters,
                        annualRevenue: r.annual_revenue,
                        employees: r.employees,
                        monthlyCapacity: r.monthly_capacity,
                        certifications: (() => { try { return JSON.parse(r.certifications || '[]'); } catch { return []; } })(),
                        majorClients: r.major_clients,
                        financialScore: Number(r.financial_score || 0),
                        capabilityScore: Number(r.capability_score || 0),
                        experienceScore: Number(r.experience_score || 0),
                        complianceScore: Number(r.compliance_score || 0),
                        totalQualScore: Number(r.total_qual_score || 0),
                        isDisqualified: r.is_disqualified,
                        disqualificationReason: r.disqualification_reason,
                    })));
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // SECTION 5 — Logistics & Supply Capability
    // ─────────────────────────────────────────────────────────

    static async saveLogisticsResponse(rfpId, supplierId, data) {
        const {
            deliveryTerms, warehouseLocations, transportMethod,
            supplyCapacityMonthly, hasBackupSupplier
        } = data;

        // Risk detection
        const riskReasons = [];
        if (!hasBackupSupplier) riskReasons.push('No backup supplier / single source risk');
        if (!warehouseLocations || warehouseLocations.split(',').length < 2)
            riskReasons.push('Single warehouse location — geographic concentration risk');

        // Capacity risk: compare supply capacity vs total RFP demand
        if (supplyCapacityMonthly) {
            const itemRows = await new Promise((r) =>
                db.all(`SELECT quantity FROM rfp_item WHERE rfp_id=$1`, [rfpId], (e, rows) => r(rows || []))
            );
            const totalDemand = itemRows.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
            const capacity = Number(supplyCapacityMonthly);
            if (totalDemand > 0 && capacity > 0 && capacity < totalDemand) {
                const shortfallPct = Math.round(((totalDemand - capacity) / totalDemand) * 100);
                riskReasons.push(
                    `Monthly capacity (${capacity.toLocaleString()} units) is ${shortfallPct}% below total RFP demand (${totalDemand.toLocaleString()} units)`
                );
            }
        }

        const riskLevel = riskReasons.length >= 2 ? 'HIGH' : riskReasons.length === 1 ? 'MEDIUM' : 'LOW';
        const riskJson = JSON.stringify(riskReasons);

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfp_logistics_response
                    (rfp_id, supplier_id, delivery_terms, warehouse_locations, transport_method,
                     supply_capacity_monthly, has_backup_supplier, risk_level, risk_reasons, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
                 ON CONFLICT (rfp_id, supplier_id) DO UPDATE SET
                    delivery_terms=$3, warehouse_locations=$4, transport_method=$5,
                    supply_capacity_monthly=$6, has_backup_supplier=$7, risk_level=$8,
                    risk_reasons=$9, updated_at=NOW()`,
                [rfpId, supplierId, deliveryTerms||null, warehouseLocations||null,
                 transportMethod||null, supplyCapacityMonthly||null,
                 hasBackupSupplier ? true : false, riskLevel, riskJson],
                (err) => err ? reject(err) : resolve()
            );
        });

        return { riskLevel, riskReasons };
    }

    static async getLogisticsResponses(rfpId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT l.*, s.legalname AS supplier_name
                 FROM rfp_logistics_response l
                 LEFT JOIN suppliers s ON l.supplier_id = s.supplierid
                 WHERE l.rfp_id = $1`,
                [rfpId],
                (err, rows) => {
                    if (err) return resolve([]);
                    resolve((rows || []).map(r => ({
                        supplierId: r.supplier_id,
                        supplierName: r.supplier_name,
                        deliveryTerms: r.delivery_terms,
                        warehouseLocations: r.warehouse_locations,
                        transportMethod: r.transport_method,
                        supplyCapacityMonthly: r.supply_capacity_monthly,
                        hasBackupSupplier: r.has_backup_supplier,
                        riskLevel: r.risk_level,
                        riskReasons: (() => { try { return JSON.parse(r.risk_reasons || '[]'); } catch { return []; } })(),
                    })));
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // SECTION 6 — Quality & Compliance
    // ─────────────────────────────────────────────────────────

    static async saveQualityResponse(rfpId, supplierId, data) {
        const {
            isoCertified, gmpCertified, fscCertified, otherCertifications,
            inspectionProcess, traceabilitySystem, defectRatePct,
            auditReportUrl, qualityManualUrl
        } = data;

        // Compliance score
        let score = 0;
        if (isoCertified) score += 35;
        if (gmpCertified) score += 30;
        if (fscCertified) score += 15;
        if (otherCertifications) score += 10;
        if (inspectionProcess) score += 5;
        if (traceabilitySystem) score += 5;
        score = Math.min(100, score);

        // Auto-compliance check — uses buyer's stated requirements from RFP columns
        const rfp = await new Promise((r) => db.get(
            `SELECT category, require_iso, require_gmp, require_fsc FROM rfp WHERE rfp_id=$1`,
            [rfpId], (e, row) => r(row)
        ));
        let isCompliant = true;
        const disqualReasons = [];
        const category = (rfp?.category || '').toLowerCase();

        // Category-based auto-check for GMP (Pharma/Food)
        if ((category.includes('pharma') || category.includes('food')) && !gmpCertified) {
            isCompliant = false;
            disqualReasons.push('GMP certification required for Pharma/Food category');
        }
        // Buyer's explicit certification requirements
        if (rfp?.require_iso && !isoCertified) {
            isCompliant = false;
            disqualReasons.push('ISO 9001 certification required by buyer');
        }
        if (rfp?.require_gmp && !gmpCertified) {
            isCompliant = false;
            disqualReasons.push('GMP certification required by buyer');
        }
        if (rfp?.require_fsc && !fscCertified) {
            isCompliant = false;
            disqualReasons.push('FSC certification required by buyer');
        }
        const defectRate = parseFloat(defectRatePct) || 0;
        if (defectRate > 5) {
            isCompliant = false;
            disqualReasons.push('Defect rate exceeds 5% threshold');
        }
        const disqualificationReason = disqualReasons.length > 0 ? disqualReasons.join('; ') : null;

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfp_quality_response
                    (rfp_id, supplier_id, iso_certified, gmp_certified, fsc_certified,
                     other_certifications, inspection_process, traceability_system,
                     defect_rate_pct, audit_report_url, quality_manual_url,
                     compliance_score, is_compliant, disqualification_reason, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
                 ON CONFLICT (rfp_id, supplier_id) DO UPDATE SET
                    iso_certified=$3, gmp_certified=$4, fsc_certified=$5,
                    other_certifications=$6, inspection_process=$7, traceability_system=$8,
                    defect_rate_pct=$9, audit_report_url=$10, quality_manual_url=$11,
                    compliance_score=$12, is_compliant=$13, disqualification_reason=$14, updated_at=NOW()`,
                [rfpId, supplierId,
                 isoCertified ? true : false, gmpCertified ? true : false, fscCertified ? true : false,
                 otherCertifications||null, inspectionProcess||null, traceabilitySystem||null,
                 defectRatePct||null, auditReportUrl||null, qualityManualUrl||null,
                 score, isCompliant, disqualificationReason],
                (err) => err ? reject(err) : resolve()
            );
        });

        return { complianceScore: score, isCompliant, disqualificationReason };
    }

    static async getQualityResponses(rfpId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT q.*, s.legalname AS supplier_name
                 FROM rfp_quality_response q
                 LEFT JOIN suppliers s ON q.supplier_id = s.supplierid
                 WHERE q.rfp_id = $1`,
                [rfpId],
                (err, rows) => {
                    if (err) return resolve([]);
                    resolve((rows || []).map(r => ({
                        supplierId: r.supplier_id,
                        supplierName: r.supplier_name,
                        isoCertified: r.iso_certified,
                        gmpCertified: r.gmp_certified,
                        fscCertified: r.fsc_certified,
                        otherCertifications: r.other_certifications,
                        inspectionProcess: r.inspection_process,
                        traceabilitySystem: r.traceability_system,
                        defectRatePct: r.defect_rate_pct,
                        complianceScore: Number(r.compliance_score || 0),
                        isCompliant: r.is_compliant,
                        disqualificationReason: r.disqualification_reason,
                    })));
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // SECTION 7 — Sustainability & ESG
    // ─────────────────────────────────────────────────────────

    static async saveESGResponse(rfpId, supplierId, data) {
        const {
            recycledContentPct, carbonFootprintKg, renewableEnergyPct,
            packagingReductionInitiative, esgPolicies
        } = data;

        // ESG Score: Carbon (40%) + Recycled Content (30%) + Renewable Energy (30%)
        const carbonScore  = Math.max(0, 100 - Math.min(100, (parseFloat(carbonFootprintKg) || 0) / 10));
        const recycledScore = Math.min(100, (parseFloat(recycledContentPct) || 0));
        const renewableScore = Math.min(100, (parseFloat(renewableEnergyPct) || 0));
        const esgScore = carbonScore * 0.40 + recycledScore * 0.30 + renewableScore * 0.30;

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfp_esg_response
                    (rfp_id, supplier_id, recycled_content_pct, carbon_footprint_kg,
                     renewable_energy_pct, packaging_reduction_initiative, esg_policies, esg_score, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
                 ON CONFLICT (rfp_id, supplier_id) DO UPDATE SET
                    recycled_content_pct=$3, carbon_footprint_kg=$4, renewable_energy_pct=$5,
                    packaging_reduction_initiative=$6, esg_policies=$7, esg_score=$8, updated_at=NOW()`,
                [rfpId, supplierId, recycledContentPct||null, carbonFootprintKg||null,
                 renewableEnergyPct||null, packagingReductionInitiative||null, esgPolicies||null,
                 Math.round(esgScore)],
                (err) => err ? reject(err) : resolve()
            );
        });

        return { esgScore: Math.round(esgScore) };
    }

    static async getESGResponses(rfpId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT e.*, s.legalname AS supplier_name
                 FROM rfp_esg_response e
                 LEFT JOIN suppliers s ON e.supplier_id = s.supplierid
                 WHERE e.rfp_id = $1`,
                [rfpId],
                (err, rows) => {
                    if (err) return resolve([]);
                    resolve((rows || []).map(r => ({
                        supplierId: r.supplier_id,
                        supplierName: r.supplier_name,
                        recycledContentPct: r.recycled_content_pct,
                        carbonFootprintKg: r.carbon_footprint_kg,
                        renewableEnergyPct: r.renewable_energy_pct,
                        packagingReductionInitiative: r.packaging_reduction_initiative,
                        esgPolicies: r.esg_policies,
                        esgScore: Number(r.esg_score || 0),
                    })));
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // SECTION 8 — Commercial Terms & Conditions
    // ─────────────────────────────────────────────────────────

    static async saveTermsResponse(rfpId, supplierId, data) {
        const {
            paymentTerms, priceValidityDays, acceptsPenaltyClauses,
            commodityIndexLinkage, generalTermsAccepted, termsNotes
        } = data;

        // Smart contract flags
        const flagReasons = [];
        if (!generalTermsAccepted) flagReasons.push('General terms & conditions not accepted');
        if (!acceptsPenaltyClauses) flagReasons.push('Penalty clauses not accepted');
        if (!commodityIndexLinkage) flagReasons.push('No commodity index linkage specified');
        const priceVal = parseInt(priceValidityDays) || 0;
        if (priceVal < 30) flagReasons.push('Price validity below 30 days — too short');

        const hasFlags = flagReasons.length > 0;

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfp_terms_response
                    (rfp_id, supplier_id, payment_terms, price_validity_days, accepts_penalty_clauses,
                     commodity_index_linkage, general_terms_accepted, terms_notes, has_flags, flag_reasons, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
                 ON CONFLICT (rfp_id, supplier_id) DO UPDATE SET
                    payment_terms=$3, price_validity_days=$4, accepts_penalty_clauses=$5,
                    commodity_index_linkage=$6, general_terms_accepted=$7, terms_notes=$8,
                    has_flags=$9, flag_reasons=$10, updated_at=NOW()`,
                [rfpId, supplierId, paymentTerms||null, priceValidityDays||null,
                 acceptsPenaltyClauses ? true : false, commodityIndexLinkage||null,
                 generalTermsAccepted ? true : false, termsNotes||null,
                 hasFlags, JSON.stringify(flagReasons)],
                (err) => err ? reject(err) : resolve()
            );
        });

        return { hasFlags, flagReasons };
    }

    static async getTermsResponses(rfpId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT t.*, s.legalname AS supplier_name
                 FROM rfp_terms_response t
                 LEFT JOIN suppliers s ON t.supplier_id = s.supplierid
                 WHERE t.rfp_id = $1`,
                [rfpId],
                (err, rows) => {
                    if (err) return resolve([]);
                    resolve((rows || []).map(r => ({
                        supplierId: r.supplier_id,
                        supplierName: r.supplier_name,
                        paymentTerms: r.payment_terms,
                        priceValidityDays: r.price_validity_days,
                        acceptsPenaltyClauses: r.accepts_penalty_clauses,
                        commodityIndexLinkage: r.commodity_index_linkage,
                        generalTermsAccepted: r.general_terms_accepted,
                        termsNotes: r.terms_notes,
                        hasFlags: r.has_flags,
                        flagReasons: (() => { try { return JSON.parse(r.flag_reasons || '[]'); } catch { return []; } })(),
                    })));
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // WEIGHTED EVALUATION SCORING
    // ─────────────────────────────────────────────────────────

    /**
     * Compute weighted evaluation score for all suppliers on an RFP.
     * Weights: Commercial 40%, Technical/Qual 25%, Quality 15%, Logistics 10%, Sustainability 10%
     */
    static async calculateWeightedScores(rfpId) {
        // Load rfp's configured scoring weights
        const rfpWeights = await new Promise((r) =>
            db.get(
                `SELECT weight_commercial, weight_technical, weight_quality, weight_logistics, weight_esg FROM rfp WHERE rfp_id=$1`,
                [rfpId], (e, row) => r(row)
            )
        );
        // Use configured weights (as decimal fractions), fall back to 40/25/15/10/10
        const wC = (rfpWeights?.weight_commercial != null ? Number(rfpWeights.weight_commercial) : 40) / 100;
        const wT = (rfpWeights?.weight_technical  != null ? Number(rfpWeights.weight_technical)  : 25) / 100;
        const wQ = (rfpWeights?.weight_quality    != null ? Number(rfpWeights.weight_quality)    : 15) / 100;
        const wL = (rfpWeights?.weight_logistics  != null ? Number(rfpWeights.weight_logistics)  : 10) / 100;
        const wE = (rfpWeights?.weight_esg        != null ? Number(rfpWeights.weight_esg)        : 10) / 100;

        // Load all submitted responses
        const responses = await new Promise((resolve) => {
            db.all(
                `SELECT r.*, s.legalname AS supplier_name
                 FROM supplier_rfp_response r
                 LEFT JOIN suppliers s ON r.supplier_id = s.supplierid
                 WHERE r.rfp_id = $1 AND r.status = 'SUBMITTED'`,
                [rfpId],
                (err, rows) => resolve(rows || [])
            );
        });
        if (!responses.length) return [];

        // Load rfp items for should-cost comparison
        const items = await new Promise((resolve) => {
            db.all(`SELECT * FROM rfp_item WHERE rfp_id = $1`, [rfpId], (err, rows) => resolve(rows || []));
        });

        // Helper: load response items for a supplier response
        const getResponseItems = (responseId) => new Promise((resolve) => {
            db.all(`SELECT * FROM rfp_response_item WHERE response_id = $1`, [responseId], (err, rows) => resolve(rows || []));
        });

        // Calculate commercial score (price vs lowest)
        const supplierPriceTotals = {};
        for (const resp of responses) {
            const ritems = await getResponseItems(resp.response_id);
            let total = 0;
            for (const ri of ritems) {
                if (ri.price) {
                    const item = items.find(i => i.item_id === ri.item_id);
                    total += parseFloat(ri.price) * (item ? parseFloat(item.quantity) : 1);
                }
            }
            supplierPriceTotals[resp.supplier_id] = total;
        }
        const prices = Object.values(supplierPriceTotals).filter(p => p > 0);
        const lowestTotal = prices.length ? Math.min(...prices) : 1;

        // Load section scores
        const [qualRows, logisticsRows, qualityRows, esgRows] = await Promise.all([
            new Promise(r => db.all(`SELECT supplier_id, total_qual_score FROM rfp_qualification_response WHERE rfp_id=$1`, [rfpId], (e, rows) => r(rows || []))),
            new Promise(r => db.all(`SELECT supplier_id, risk_level FROM rfp_logistics_response WHERE rfp_id=$1`, [rfpId], (e, rows) => r(rows || []))),
            new Promise(r => db.all(`SELECT supplier_id, compliance_score FROM rfp_quality_response WHERE rfp_id=$1`, [rfpId], (e, rows) => r(rows || []))),
            new Promise(r => db.all(`SELECT supplier_id, esg_score FROM rfp_esg_response WHERE rfp_id=$1`, [rfpId], (e, rows) => r(rows || []))),
        ]);

        const qualMap = Object.fromEntries(qualRows.map(r => [r.supplier_id, Number(r.total_qual_score || 0)]));
        const logisticsMap = Object.fromEntries(logisticsRows.map(r => [r.supplier_id, r.risk_level === 'LOW' ? 100 : r.risk_level === 'MEDIUM' ? 60 : 20]));
        const qualityMap = Object.fromEntries(qualityRows.map(r => [r.supplier_id, Number(r.compliance_score || 0)]));
        const esgMap = Object.fromEntries(esgRows.map(r => [r.supplier_id, Number(r.esg_score || 0)]));

        const scores = [];
        for (const resp of responses) {
            const sid = resp.supplier_id;
            const totalPrice = supplierPriceTotals[sid] || 0;

            // Commercial: lowest price = 100, others scaled proportionally
            const commercialScore = totalPrice > 0 && lowestTotal > 0
                ? Math.round((lowestTotal / totalPrice) * 100)
                : 50;

            const technicalScore = qualMap[sid] || 50;    // fallback 50 if not filled
            const qualityScore   = qualityMap[sid] || 50;
            const logisticsScore = logisticsMap[sid] || 50;
            const sustainScore   = esgMap[sid] || 50;

            const totalWeighted = (
                commercialScore   * wC +
                technicalScore    * wT +
                qualityScore      * wQ +
                logisticsScore    * wL +
                sustainScore      * wE
            );

            scores.push({
                supplierId: sid,
                supplierName: resp.supplier_name,
                commercialScore,
                technicalScore,
                qualityScore,
                logisticsScore,
                sustainabilityScore: sustainScore,
                totalWeightedScore: Math.round(totalWeighted),
            });
        }

        // Rank by total score descending
        scores.sort((a, b) => b.totalWeightedScore - a.totalWeightedScore);
        scores.forEach((s, i) => { s.rank = i + 1; });

        // Upsert to rfp_eval_score
        for (const s of scores) {
            await new Promise((resolve) => {
                db.run(
                    `INSERT INTO rfp_eval_score
                        (rfp_id, supplier_id, commercial_score, technical_score, quality_score,
                         logistics_score, sustainability_score, total_weighted_score, rank, updated_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
                     ON CONFLICT (rfp_id, supplier_id) DO UPDATE SET
                        commercial_score=$3, technical_score=$4, quality_score=$5,
                        logistics_score=$6, sustainability_score=$7, total_weighted_score=$8,
                        rank=$9, updated_at=NOW()`,
                    [rfpId, s.supplierId, s.commercialScore, s.technicalScore, s.qualityScore,
                     s.logisticsScore, s.sustainabilityScore, s.totalWeightedScore, s.rank],
                    () => resolve()
                );
            });
        }

        return scores;
    }

    static async getEvalScores(rfpId) {
        return new Promise((resolve) => {
            db.all(
                `SELECT e.*, s.legalname AS supplier_name
                 FROM rfp_eval_score e
                 LEFT JOIN suppliers s ON e.supplier_id = s.supplierid
                 WHERE e.rfp_id = $1 ORDER BY e.rank ASC`,
                [rfpId],
                (err, rows) => {
                    if (err) return resolve([]);
                    resolve((rows || []).map(r => ({
                        supplierId: r.supplier_id,
                        supplierName: r.supplier_name || `Supplier ${r.supplier_id}`,
                        commercialScore: Number(r.commercial_score || 0),
                        technicalScore: Number(r.technical_score || 0),
                        qualityScore: Number(r.quality_score || 0),
                        logisticsScore: Number(r.logistics_score || 0),
                        sustainabilityScore: Number(r.sustainability_score || 0),
                        totalWeightedScore: Number(r.total_weighted_score || 0),
                        rank: r.rank,
                    })));
                }
            );
        });
    }

    // ─────────────────────────────────────────────────────────
    // SECTION 4 — Cost Breakdown + Should-Cost for a supplier
    // ─────────────────────────────────────────────────────────

    static async getShouldCostAnalysis(rfpId) {
        // Load rfp items with target prices
        const items = await new Promise((resolve) => {
            db.all(`SELECT * FROM rfp_item WHERE rfp_id = $1`, [rfpId], (err, rows) => resolve(rows || []));
        });

        // Load all submitted responses with their items
        const responses = await new Promise((resolve) => {
            db.all(
                `SELECT r.*, s.legalname AS supplier_name
                 FROM supplier_rfp_response r
                 LEFT JOIN suppliers s ON r.supplier_id = s.supplierid
                 WHERE r.rfp_id = $1 AND r.status = 'SUBMITTED'`,
                [rfpId], (err, rows) => resolve(rows || [])
            );
        });

        const analysis = [];
        for (const item of items) {
            const row = {
                itemId: item.item_id,
                itemName: item.name,
                targetPrice: item.target_price ? Number(item.target_price) : null,
                suppliers: [],
            };

            for (const resp of responses) {
                const ri = await new Promise((resolve) => {
                    db.get(
                        `SELECT * FROM rfp_response_item WHERE response_id = $1 AND item_id = $2`,
                        [resp.response_id, item.item_id],
                        (err, r) => resolve(r)
                    );
                });
                if (!ri) continue;

                const price = ri.price ? Number(ri.price) : null;
                const variance = (price !== null && item.target_price)
                    ? Math.round(((price - Number(item.target_price)) / Number(item.target_price)) * 100)
                    : null;

                const rawMat = ri.raw_material_cost ? Number(ri.raw_material_cost) : null;
                const conv   = ri.conversion_cost   ? Number(ri.conversion_cost)   : null;
                const labor  = ri.labor_cost        ? Number(ri.labor_cost)        : null;
                const logist = ri.logistics_cost    ? Number(ri.logistics_cost)    : null;
                const ovhd   = ri.overhead_cost     ? Number(ri.overhead_cost)     : null;
                const margin = ri.supplier_margin   ? Number(ri.supplier_margin)   : null;

                row.suppliers.push({
                    supplierId: resp.supplier_id,
                    supplierName: resp.supplier_name,
                    price,
                    rawMaterialCost: rawMat,
                    conversionCost: conv,
                    laborCost: labor,
                    logisticsCost: logist,
                    overheadCost: ovhd,
                    supplierMargin: margin,
                    variancePct: variance,
                    isBelowTarget: variance !== null && variance < 0,
                    isAboveTarget: variance !== null && variance > 0,
                });
            }

            // Cost-component auto-flagging — compare each component across suppliers for this item
            const flags = [];
            const suppliersWithBreakdown = row.suppliers.filter(s => s.rawMaterialCost !== null);
            if (suppliersWithBreakdown.length >= 2) {
                const avgRaw    = suppliersWithBreakdown.reduce((s, x) => s + x.rawMaterialCost, 0) / suppliersWithBreakdown.length;
                const avgConv   = suppliersWithBreakdown.filter(s => s.conversionCost !== null).reduce((s, x) => s + x.conversionCost, 0) / (suppliersWithBreakdown.filter(s => s.conversionCost !== null).length || 1);
                const avgMargin = suppliersWithBreakdown.filter(s => s.supplierMargin !== null).reduce((s, x) => s + x.supplierMargin, 0) / (suppliersWithBreakdown.filter(s => s.supplierMargin !== null).length || 1);

                for (const s of suppliersWithBreakdown) {
                    const sFlags = [];
                    if (avgRaw > 0 && s.rawMaterialCost > avgRaw * 1.2)
                        sFlags.push(`High raw material cost (${Math.round(((s.rawMaterialCost - avgRaw) / avgRaw) * 100)}% above average)`);
                    if (s.conversionCost !== null && avgConv > 0 && s.conversionCost > avgConv * 1.25)
                        sFlags.push(`Inflated conversion cost (${Math.round(((s.conversionCost - avgConv) / avgConv) * 100)}% above average)`);
                    if (s.supplierMargin !== null && s.supplierMargin > 30)
                        sFlags.push(`High supplier margin (${s.supplierMargin}%)`);
                    if (s.supplierMargin !== null && avgMargin > 0 && s.supplierMargin > avgMargin * 1.5)
                        sFlags.push('Margin significantly above peer average — possible hidden cost');
                    if (sFlags.length > 0) flags.push({ supplierId: s.supplierId, supplierName: s.supplierName, flags: sFlags });
                }
            }
            row.costFlags = flags;

            analysis.push(row);
        }

        return analysis;
    }
}

module.exports = RFPService;

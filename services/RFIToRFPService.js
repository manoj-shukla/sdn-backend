const db = require('../config/database');
const { randomUUID } = require('crypto');

/**
 * RFIToRFPService
 * Converts a closed/converted RFI into a real saved RFP DRAFT.
 * - Creates an rfp row (status=DRAFT, deadline=30 days out by default)
 * - Pre-invites all SHORTLISTED suppliers into rfp_supplier
 * - Records source_rfi_id so the link is traceable
 */
class RFIToRFPService {

    static async convertRFIToRFP(rfiId, user) {
        // 1. Load the RFI event
        const event = await new Promise((res, rej) => {
            db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, row) => {
                if (err) return rej(err);
                if (!row) return rej(new Error('RFI event not found'));
                res(row);
            });
        });

        if (!['CLOSED', 'CONVERTED'].includes(event.status)) {
            throw new Error('RFI must be CLOSED or CONVERTED before creating an RFP');
        }

        // 2. Get shortlisted suppliers — with self-heal for missing evaluation_status column
        const fetchShortlisted = () => new Promise((res) => {
            db.all(
                `SELECT r.supplier_id, s.legalname AS supplier_name, s.email AS supplier_email
                 FROM supplier_rfi_response r
                 JOIN suppliers s ON r.supplier_id = s.supplierid
                 WHERE r.rfi_id = ? AND r.evaluation_status = 'SHORTLISTED'`,
                [rfiId],
                (err, rows) => res({ err, rows: rows || [] })
            );
        });

        let { err: shortlistErr, rows: shortlisted } = await fetchShortlisted();
        if (shortlistErr) {
            if (shortlistErr.message && shortlistErr.message.includes('evaluation_status')) {
                // Column missing — add it and retry
                console.warn('[RFIToRFPService] evaluation_status column missing — adding it and retrying shortlist query');
                await new Promise((res) => {
                    db.run(`ALTER TABLE supplier_rfi_response ADD COLUMN IF NOT EXISTS evaluation_status TEXT DEFAULT 'UNDER_REVIEW'`, [], () => res());
                });
                const retry = await fetchShortlisted();
                shortlisted = retry.rows;
            } else {
                console.warn(`[RFIToRFPService] Could not fetch shortlisted suppliers: ${shortlistErr.message}`);
                shortlisted = [];
            }
        }

        // 3. Create the RFP in the database as DRAFT
        const rfpId = randomUUID();
        const rfpName = `RFP - ${event.title}`;
        // Default deadline: 30 days from now (buyer will adjust before publishing)
        const defaultDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const buyerId = event.buyer_id || (user.buyerId || null);

        // Helper: insert rfp row, with self-healing for missing source_rfi_id column
        const insertRfp = async (includeSourceRfiId = true) => {
            const cols = includeSourceRfiId
                ? `rfp_id, name, category, currency, deadline, description, status, buyer_id, source_rfi_id, created_by, created_at, updated_at`
                : `rfp_id, name, category, currency, deadline, description, status, buyer_id, created_by, created_at, updated_at`;
            const placeholders = includeSourceRfiId
                ? `?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP`
                : `?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP`;
            const params = includeSourceRfiId
                ? [rfpId, rfpName, null, 'INR', defaultDeadline, event.description || `Converted from RFI: ${event.title}`, buyerId, rfiId, user.userId]
                : [rfpId, rfpName, null, 'INR', defaultDeadline, event.description || `Converted from RFI: ${event.title}`, buyerId, user.userId];

            return new Promise((res, rej) => {
                db.run(
                    `INSERT INTO rfp (${cols}) VALUES (${placeholders})`,
                    params,
                    (err) => err ? rej(err) : res()
                );
            });
        };

        try {
            await insertRfp(true);
        } catch (err) {
            // If the error is about the missing source_rfi_id column, add it and retry
            if (err && err.message && err.message.includes('source_rfi_id')) {
                console.warn('[RFIToRFPService] source_rfi_id column missing — adding it now and retrying INSERT');
                await new Promise((res) => {
                    db.run(`ALTER TABLE rfp ADD COLUMN IF NOT EXISTS source_rfi_id UUID`, [], () => res());
                });
                // Retry with the column
                await insertRfp(true);
            } else {
                throw err;
            }
        }

        // Backfill source_rfi_id if needed (covers fallback without column case)
        await new Promise((res) => {
            db.run(`UPDATE rfp SET source_rfi_id = ? WHERE rfp_id = ? AND source_rfi_id IS NULL`, [rfiId, rfpId], () => res());
        });

        // 4. Pre-invite all shortlisted suppliers
        for (const s of shortlisted) {
            await new Promise((res) => {
                db.run(
                    `INSERT INTO rfp_supplier (id, rfp_id, supplier_id, email, status, created_at)
                     SELECT ?, ?, ?, ?, 'INVITED', CURRENT_TIMESTAMP
                     WHERE NOT EXISTS (
                         SELECT 1 FROM rfp_supplier WHERE rfp_id = ? AND supplier_id = ?
                     )`,
                    [randomUUID(), rfpId, s.supplier_id, s.supplier_email || null, rfpId, s.supplier_id],
                    (err) => {
                        if (err) console.error(`[RFIToRFPService] Failed to invite supplier ${s.supplier_id}: ${err.message}`);
                        res();
                    }
                );
            });
        }

        console.log(`[RFIToRFPService] RFP "${rfpName}" (${rfpId}) created from RFI ${rfiId} with ${shortlisted.length} pre-invited suppliers`);

        return {
            rfpId,
            rfpName,
            sourceRfiId: rfiId,
            status: 'DRAFT',
            invitedSuppliers: shortlisted.map(s => ({
                supplierId: s.supplier_id,
                supplierName: s.supplier_name
            })),
            totalShortlisted: shortlisted.length,
        };
    }

    /**
     * Back-fills rfp_supplier rows for an existing RFP that was created without suppliers.
     * Called when recovery detects an RFP with 0 suppliers.
     */
    static async syncShortlistedSuppliers(rfiId, rfpId) {
        const shortlisted = await new Promise((res) => {
            db.all(
                `SELECT r.supplier_id, s.legalname AS supplier_name, s.email AS supplier_email
                 FROM supplier_rfi_response r
                 JOIN suppliers s ON r.supplier_id = s.supplierid
                 WHERE r.rfi_id = ? AND r.evaluation_status = 'SHORTLISTED'`,
                [rfiId],
                (err, rows) => {
                    if (err) {
                        console.error(`[RFIToRFPService] syncShortlistedSuppliers shortlist query FAILED: ${err.message}`);
                        return res([]);
                    }
                    console.log(`[RFIToRFPService] Found ${(rows||[]).length} shortlisted suppliers for RFI ${rfiId}`);
                    res(rows || []);
                }
            );
        });

        let inserted = 0;
        for (const s of shortlisted) {
            await new Promise((res) => {
                // Use WHERE NOT EXISTS instead of ON CONFLICT — works even without UNIQUE constraint on table
                db.run(
                    `INSERT INTO rfp_supplier (id, rfp_id, supplier_id, email, status, created_at)
                     SELECT ?, ?, ?, ?, 'INVITED', CURRENT_TIMESTAMP
                     WHERE NOT EXISTS (
                         SELECT 1 FROM rfp_supplier WHERE rfp_id = ? AND supplier_id = ?
                     )`,
                    [randomUUID(), rfpId, s.supplier_id, s.supplier_email || null, rfpId, s.supplier_id],
                    (err) => {
                        if (err) console.error(`[RFIToRFPService] Failed to insert supplier ${s.supplier_id}: ${err.message}`);
                        else inserted++;
                        res();
                    }
                );
            });
        }
        console.log(`[RFIToRFPService] syncShortlistedSuppliers: inserted ${inserted}/${shortlisted.length} suppliers into RFP ${rfpId}`);
        return inserted;
    }

    static async getShortlistedSuppliers(rfiId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT r.supplier_id, s.legalname as supplier_name, r.evaluation_status, r.submission_date
                 FROM supplier_rfi_response r
                 JOIN suppliers s ON r.supplier_id = s.supplierid
                 WHERE r.rfi_id = ? AND r.evaluation_status = 'SHORTLISTED'`,
                [rfiId],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map(r => ({
                        supplierId: r.supplier_id,
                        supplierName: r.supplier_name,
                        evaluationStatus: r.evaluation_status,
                        submissionDate: r.submission_date
                    })));
                }
            );
        });
    }
}

module.exports = RFIToRFPService;

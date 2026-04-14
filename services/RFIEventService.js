const db = require('../config/database');
const { randomUUID } = require('crypto');
const NotificationService = require('./NotificationService');
const InvitationService = require('./InvitationService');

const VALID_EVENT_TRANSITIONS = {
    DRAFT: ['OPEN', 'SCHEDULED'],
    SCHEDULED: ['OPEN', 'DRAFT'],   // can be published early or reverted to draft
    OPEN: ['CLOSED'],
    CLOSED: ['CONVERTED', 'ARCHIVED'],
    CONVERTED: [],
    ARCHIVED: []
};

const VALID_INVITATION_TRANSITIONS = {
    CREATED: ['SENT'],
    SENT: ['VIEWED'],
    VIEWED: ['IN_PROGRESS'],
    IN_PROGRESS: ['SUBMITTED'],
    SUBMITTED: [],
    EXPIRED: []
};

class RFIEventService {

    static async createEvent(data, user) {
        const { title, description, templateId, publishDate, deadline, startDate } = data;
        if (!title) throw new Error('title is required');

        const rfiId = randomUUID();
        const buyerId = user.buyerId || null;

        // Determine initial status: if a future start date is provided, mark as SCHEDULED
        const hasSchedule = startDate && new Date(startDate) > new Date();
        const initialStatus = hasSchedule ? 'SCHEDULED' : 'DRAFT';

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfi_event (rfi_id, template_id, title, description, buyer_id, publish_date, deadline, start_date, status, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [rfiId, templateId || null, title, description || null, buyerId,
                 publishDate || null, deadline || null, startDate || null, initialStatus, user.userId],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFIEventService._normalize(row));
                    });
                }
            );
        });
    }

    static async listEvents(user, filters) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT e.*,
                    COALESCE(inv.supplier_count, 0) AS supplier_count,
                    COALESCE(inv.submitted_count, 0) AS submitted_count
                FROM rfi_event e
                LEFT JOIN (
                    SELECT rfi_id,
                           COUNT(*) AS supplier_count,
                           COUNT(*) FILTER (WHERE invitation_status = 'SUBMITTED') AS submitted_count
                    FROM rfi_invitation
                    GROUP BY rfi_id
                ) inv ON inv.rfi_id = e.rfi_id
                WHERE 1=1`;
            const params = [];

            if (user.buyerId) {
                query += ` AND e.buyer_id = ?`;
                params.push(user.buyerId);
            }
            if (filters && filters.status) {
                query += ` AND e.status = ?`;
                params.push(filters.status);
            }

            query += ` ORDER BY e.created_at DESC`;

            db.all(query, params, (err, rows) => {
                if (err) return reject(err);
                resolve((rows || []).map(RFIEventService._normalize));
            });
        });
    }

    static async getEventById(rfiId) {
        let row = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        if (!row) return null;

        // ── Lazy activation: if SCHEDULED and start_date has passed, auto-open ──
        if (row.status === 'SCHEDULED' && row.start_date && new Date(row.start_date) <= new Date()) {
            try {
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE rfi_event SET status = 'OPEN', publish_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE rfi_id = ?`,
                        [rfiId],
                        (err) => err ? reject(err) : resolve()
                    );
                });
                // Dispatch invitations that were queued (CREATED status)
                await RFIEventService._dispatchInvitations(rfiId);
                // Re-fetch the updated row
                row = await new Promise((resolve, reject) => {
                    db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, r) => {
                        if (err) return reject(err);
                        resolve(r);
                    });
                });
                console.log(`[RFIEventService] Auto-activated scheduled event ${rfiId}`);
            } catch (e) {
                console.error(`[RFIEventService] Failed to auto-activate event ${rfiId}:`, e.message);
            }
        }

        const event = RFIEventService._normalize(row);

        // Enrich with template (sections + questions) for supplier response page
        if (row.template_id) {
            try {
                const RFITemplateService = require('./RFITemplateService');
                const template = await RFITemplateService.getTemplateById(row.template_id);
                if (template) {
                    event.template = {
                        ...template,
                        sections: (template.sections || []).map(section => ({
                            ...section,
                            questions: (section.questions || []).map(q => ({
                                isMandatory: q.isMandatory,
                                promoteToRfp: q.promoteToRfp,
                                orderIndex: q.orderIndex,
                                question: {
                                    questionId: q.questionId,
                                    questionText: q.questionText || q.text,
                                    text: q.text || q.questionText,
                                    questionType: q.questionType,
                                    isMandatory: q.isMandatory,
                                    options: q.options,
                                    helpText: q.helpText || null,
                                    promoteToRfp: q.promoteToRfp,
                                }
                            }))
                        }))
                    };
                }
            } catch (e) {
                console.error('[RFIEventService] Failed to load template for event:', e.message);
            }
        }

        return event;
    }

    static async getSupplierInvitationCount(supplierId) {
        // Returns count of open RFI events where supplier is invited and hasn't submitted yet
        // Note: published events have status 'OPEN' (set by publishEvent)
        return new Promise((resolve) => {
            db.get(
                `SELECT COUNT(*)::int AS count
                 FROM rfi_invitation i
                 JOIN rfi_event e ON i.rfi_id = e.rfi_id
                 LEFT JOIN supplier_rfi_response r ON r.rfi_id = i.rfi_id AND r.supplier_id = i.supplier_id
                 WHERE i.supplier_id = ?
                   AND e.status = 'OPEN'
                   AND (r.supplier_id IS NULL OR r.status != 'SUBMITTED')`,
                [supplierId],
                (err, row) => resolve(err ? 0 : (Number(row?.count) || 0))
            );
        });
    }

    static async getSupplierInvitations(supplierId, userEmail) {
        // Fetch invitations matched by supplierId (directory invite)
        // OR by guest_email (email invite) so that email-invited suppliers see their RFIs.
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT i.invitation_id, i.rfi_id, i.supplier_id, i.guest_email,
                        i.invitation_status, i.sent_timestamp,
                        e.title as rfi_title, e.deadline,
                        b.buyername as buyer_name,
                        r.status as response_status
                 FROM rfi_invitation i
                 JOIN rfi_event e ON i.rfi_id = e.rfi_id
                 LEFT JOIN buyers b ON e.buyer_id = b.buyerid
                 LEFT JOIN supplier_rfi_response r
                        ON r.rfi_id = i.rfi_id
                       AND (r.supplier_id = i.supplier_id OR r.supplier_id = $1)
                 WHERE i.supplier_id = $1
                    OR (i.guest_email IS NOT NULL AND LOWER(i.guest_email) = LOWER($2))
                 ORDER BY i.sent_timestamp DESC NULLS LAST, i.invitation_id DESC`,
                [supplierId, userEmail || ''],
                async (err, rows) => {
                    if (err) return reject(err);

                    // Back-fill supplier_id on any email-matched rows that don't have it yet.
                    // This makes future queries (by supplier_id) work correctly.
                    if (supplierId && userEmail) {
                        const emailMatches = (rows || []).filter(
                            r => !r.supplier_id && r.guest_email &&
                                 r.guest_email.toLowerCase() === userEmail.toLowerCase()
                        );
                        for (const row of emailMatches) {
                            db.run(
                                `UPDATE rfi_invitation SET supplier_id = $1 WHERE invitation_id = $2 AND supplier_id IS NULL`,
                                [supplierId, row.invitation_id],
                                () => {} // non-blocking back-fill
                            );
                        }
                    }

                    resolve((rows || []).map(row => ({
                        invitationId: row.invitation_id,
                        rfiId: row.rfi_id,
                        rfiTitle: row.rfi_title,
                        buyerName: row.buyer_name || null,
                        deadline: row.deadline,
                        status: row.invitation_status,
                        completionPercent: undefined,
                    })));
                }
            );
        });
    }

    static async updateEvent(rfiId, data, user) {
        const current = await RFIEventService.getEventById(rfiId);
        if (!current) throw new Error('RFI event not found');
        if (current.status !== 'DRAFT') throw new Error('Only DRAFT events can be updated');

        const { title, description, templateId, deadline } = data;

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_event SET title = ?, description = ?, template_id = ?, deadline = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE rfi_id = ?`,
                [title || current.title, description || current.description,
                 templateId || current.templateId, deadline || current.deadline, rfiId],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFIEventService._normalize(row));
                    });
                }
            );
        });
    }

    static async publishEvent(rfiId, user) {
        const current = await RFIEventService.getEventById(rfiId);
        if (!current) throw new Error('RFI event not found');
        // Allow publishing from DRAFT or SCHEDULED (manual early publish)
        if (!['DRAFT', 'SCHEDULED'].includes(current.status)) {
            throw new Error(`Cannot publish event in status ${current.status}`);
        }

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_event SET status = 'OPEN', publish_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE rfi_id = ?`,
                [rfiId],
                async function(err) {
                    if (err) return reject(err);

                    // Send invitations to all CREATED invitations
                    try {
                        await RFIEventService._dispatchInvitations(rfiId);
                        db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err2, row) => {
                            if (err2) return reject(err2);
                            resolve(RFIEventService._normalize(row));
                        });
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    static async closeEvent(rfiId, user) {
        const current = await RFIEventService.getEventById(rfiId);
        if (!current) throw new Error('RFI event not found');
        if (!VALID_EVENT_TRANSITIONS[current.status] || !VALID_EVENT_TRANSITIONS[current.status].includes('CLOSED')) {
            throw new Error(`Cannot close event in status ${current.status}`);
        }

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_event SET status = 'CLOSED', updated_at = CURRENT_TIMESTAMP WHERE rfi_id = ?`,
                [rfiId],
                async function(err) {
                    if (err) return reject(err);

                    // Expire all pending invitations
                    db.run(
                        `UPDATE rfi_invitation SET invitation_status = 'EXPIRED' WHERE rfi_id = ? AND invitation_status NOT IN ('SUBMITTED')`,
                        [rfiId],
                        () => {
                            db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err2, row) => {
                                if (err2) return reject(err2);
                                resolve(RFIEventService._normalize(row));
                            });
                        }
                    );
                }
            );
        });
    }

    static async convertToRFP(rfiId, user) {
        const current = await RFIEventService.getEventById(rfiId);
        if (!current) throw new Error('RFI event not found');

        const RFIToRFPService = require('./RFIToRFPService');

        // Recovery path: already CONVERTED but RFP row may be missing (e.g. promoted before migration)
        if (current.status === 'CONVERTED') {
            const existingRfp = await new Promise((res) => {
                db.get(`SELECT rfp_id, name FROM rfp WHERE source_rfi_id = ?`, [rfiId], (err, row) => {
                    res(err ? null : row);
                });
            });
            if (existingRfp) {
                // RFP exists — check if it has any suppliers yet. If not, sync them now.
                const rfpId = existingRfp.rfp_id;
                const supplierCount = await new Promise((res) => {
                    db.get(`SELECT COUNT(*)::int as cnt FROM rfp_supplier WHERE rfp_id = ?`, [rfpId], (err, row) => {
                        if (err) return res(0);
                        // PostgreSQL may return 'cnt' or 'count' depending on wrapper
                        const val = row?.cnt ?? row?.count ?? 0;
                        res(Number(val) || 0);
                    });
                });
                if (Number(supplierCount) === 0) {
                    // No suppliers yet — back-fill shortlisted suppliers from the RFI
                    console.log(`[RFIEventService] Back-filling suppliers for RFP ${rfpId} from RFI ${rfiId}`);
                    await RFIToRFPService.syncShortlistedSuppliers(rfiId, rfpId);
                }
                return { event: current, rfpDraft: { rfpId, rfpName: existingRfp.name, sourceRfiId: rfiId, status: 'DRAFT' } };
            }
            // No RFP row found — create one now (late recovery)
            console.log(`[RFIEventService] Recovery: creating missing RFP for already-CONVERTED RFI ${rfiId}`);
            const rfpDraft = await RFIToRFPService.convertRFIToRFP(rfiId, user);
            return { event: current, rfpDraft };
        }

        if (!VALID_EVENT_TRANSITIONS[current.status] || !VALID_EVENT_TRANSITIONS[current.status].includes('CONVERTED')) {
            throw new Error(`Cannot convert event in status ${current.status}`);
        }

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_event SET status = 'CONVERTED', updated_at = CURRENT_TIMESTAMP WHERE rfi_id = ?`,
                [rfiId],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err2, row) => {
                        if (err2) return reject(err2);
                        RFIToRFPService.convertRFIToRFP(rfiId, user)
                            .then(rfpDraft => resolve({ event: RFIEventService._normalize(row), rfpDraft }))
                            .catch(reject);
                    });
                }
            );
        });
    }

    // ---- Invitations ----

    static async addInvitations(rfiId, supplierIds, emailInvites, user) {
        const event = await RFIEventService.getEventById(rfiId);
        if (!event) throw new Error('RFI event not found');

        const results = [];
        const errors = [];

        // 1. Process Directory Supplier IDs
        if (Array.isArray(supplierIds)) {
            for (const supplierId of supplierIds) {
                try {
                    // Check for duplicate
                    const existing = await new Promise((res, rej) => {
                        db.get(`SELECT * FROM rfi_invitation WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                            if (err) rej(err); else res(row);
                        });
                    });

                    if (existing) {
                        errors.push({ supplierId, error: 'Supplier already invited to this RFI' });
                        continue;
                    }

                    // Check if supplier exists and is active
                    const supplier = await new Promise((res, rej) => {
                        db.get(`SELECT * FROM suppliers WHERE supplierId = ?`, [supplierId], (err, row) => {
                            if (err) rej(err); else res(row);
                        });
                    });

                    if (!supplier) {
                        errors.push({ supplierId, error: 'Supplier not found' });
                        continue;
                    }

                    if (supplier.isactive === false || supplier.isActive === false) {
                        errors.push({ supplierId, error: 'Supplier is blocked/inactive and cannot be invited' });
                        continue;
                    }

                    const invitationId = randomUUID();
                    const token = randomUUID();
                    const initialStatus = event.status === 'OPEN' ? 'SENT' : 'CREATED';

                    await new Promise((res, rej) => {
                        db.run(
                            `INSERT INTO rfi_invitation (invitation_id, rfi_id, supplier_id, invitation_status, sent_timestamp, token) VALUES (?, ?, ?, ?, ${event.status === 'OPEN' ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?)`,
                            [invitationId, rfiId, supplierId, initialStatus, token],
                            function(err) { if (err) rej(err); else res(); }
                        );
                    });

                    if (event.status === 'OPEN') {
                        await NotificationService.createNotification({
                            type: 'RFI_INVITATION',
                            message: `You have been invited to respond to RFI: ${event.title}. Please log in to submit your response.`,
                            entityId: rfiId,
                            recipientRole: 'SUPPLIER',
                            supplierId,
                        });
                    }

                    results.push({ invitationId, supplierId, status: initialStatus });
                } catch (e) {
                    errors.push({ supplierId, error: e.message });
                }
            }
        }

        // 2. Process Email (Guest) Invites
        if (Array.isArray(emailInvites)) {
            for (const invite of emailInvites) {
                try {
                    const { email, legalName } = invite;
                    if (!email || !legalName) continue;

                    // Check for duplicate by email
                    const existing = await new Promise((res, rej) => {
                        db.get(`SELECT * FROM rfi_invitation WHERE rfi_id = ? AND guest_email = ?`, [rfiId, email], (err, row) => {
                            if (err) rej(err); else res(row);
                        });
                    });

                    if (existing) {
                        errors.push({ email, error: 'Email already invited to this RFI' });
                        continue;
                    }

                    const invitationId = randomUUID();
                    const token = randomUUID();
                    const initialStatus = event.status === 'OPEN' ? 'SENT' : 'CREATED';

                    await new Promise((res, rej) => {
                        db.run(
                            `INSERT INTO rfi_invitation (invitation_id, rfi_id, guest_email, guest_name, invitation_status, sent_timestamp, token) 
                             VALUES (?, ?, ?, ?, ?, ${event.status === 'OPEN' ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?)`,
                            [invitationId, rfiId, email, legalName, initialStatus, token],
                            function(err) { if (err) rej(err); else res(); }
                        );
                    });

                    // 2a. Sync with main Invitation Directory for onboarding
                    try {
                        await InvitationService.createInvitation({
                            email,
                            legalName,
                            role: 'SUPPLIER',
                            buyerId: user.buyerId || user.buyerid
                        }, user);
                        console.log(`[RFI Service] Linked RFI guest ${email} to main invitation directory.`);
                    } catch (syncErr) {
                        // If "Supplier already exists", it usually means they are already in the onboarding list or users table.
                        // We swallow this as it's not a fatal error for RFI.
                        console.log(`[RFI Service] Guest ${email} already in main directory/users table. Skipping main invite creation.`);
                    }

                    if (event.status === 'OPEN') {
                        // For guest, we can't create an internal notification yet since they don't have a supplierId
                        // But we simulation an email send
                        console.log(`[EMAIL SIMULATION] RFI Guest invitation email sent to ${email} for RFI "${event.title}"`);
                    }

                    results.push({ invitationId, email, status: initialStatus });
                } catch (e) {
                    errors.push({ email: invite.email, error: e.message });
                }
            }
        }

        return { added: results, errors };
    }

    static async listInvitations(rfiId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT i.*, COALESCE(s.legalname, i.guest_name) as supplier_name
                    FROM rfi_invitation i
                    LEFT JOIN suppliers s ON i.supplier_id = s.supplierid
                    WHERE i.rfi_id = ?
                    ORDER BY i.sent_timestamp DESC`, [rfiId], (err, rows) => {
                if (err) return reject(err);
                resolve((rows || []).map(RFIEventService._normalizeInvitation));
            });
        });
    }

    static async validateSupplierEligibility(rfiId, supplierIds) {
        const results = [];

        for (const supplierId of supplierIds) {
            const supplier = await new Promise((res, rej) => {
                db.get(`SELECT * FROM suppliers WHERE supplierId = ?`, [supplierId], (err, row) => {
                    if (err) rej(err); else res(row);
                });
            });

            if (!supplier) {
                results.push({ supplierId, eligible: false, reason: 'Supplier not found' });
                continue;
            }

            if (supplier.isactive === false || supplier.isActive === false) {
                results.push({ supplierId, eligible: false, reason: 'Supplier is blocked/inactive' });
                continue;
            }

            const existing = await new Promise((res, rej) => {
                db.get(`SELECT * FROM rfi_invitation WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                    if (err) rej(err); else res(row);
                });
            });

            if (existing) {
                results.push({ supplierId, eligible: false, reason: 'Already invited' });
                continue;
            }

            results.push({ supplierId, eligible: true, reason: null });
        }

        return results;
    }

    static async _dispatchInvitations(rfiId) {
        // Fetch event title and invited suppliers before dispatching
        const event = await new Promise((resolve, reject) => {
            db.get(`SELECT title FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });

        const pendingInvitations = await new Promise((resolve, reject) => {
            db.all(
                `SELECT supplier_id FROM rfi_invitation WHERE rfi_id = ? AND invitation_status = 'CREATED'`,
                [rfiId],
                (err, rows) => { if (err) return reject(err); resolve(rows || []); }
            );
        });

        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_invitation SET invitation_status = 'SENT', sent_timestamp = CURRENT_TIMESTAMP
                 WHERE rfi_id = ? AND invitation_status = 'CREATED'`,
                [rfiId],
                function(err) {
                    if (err) return reject(err);
                    console.log(`[RFIEventService] Dispatched invitations for RFI ${rfiId}`);
                    resolve();
                }
            );
        });

        // Notify each supplier (best-effort)
        const rfiTitle = event ? event.title : rfiId;
        for (const inv of pendingInvitations) {
            try {
                await NotificationService.createNotification({
                    type: 'RFI_INVITATION',
                    message: `You have been invited to respond to RFI: ${rfiTitle}`,
                    entityId: rfiId,
                    recipientRole: 'SUPPLIER',
                    supplierId: inv.supplier_id,
                });
                console.log(`[EMAIL SIMULATION] RFI invitation email sent to supplier ${inv.supplier_id} for RFI "${rfiTitle}"`);
            } catch (e) {
                console.error(`[RFIEventService] Failed to notify supplier ${inv.supplier_id}:`, e.message);
            }
        }
    }

    /**
     * Bulk-import RFI events from a JSON array.
     * Each item may reference a template by name (templateName) or ID (templateId).
     * Returns { created: [...], errors: [...] }
     */
    static async importEvents(items, user) {
        const RFITemplateService = require('./RFITemplateService');

        // Build a name → id map from all published templates once
        const allTemplates = await new Promise((resolve, reject) => {
            db.all(`SELECT template_id, template_name FROM rfi_template WHERE status = 'PUBLISHED'`, [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
        const templateByName = new Map(allTemplates.map(t => [t.template_name.toLowerCase().trim(), t.template_id]));
        const templateById   = new Map(allTemplates.map(t => [String(t.template_id), t.template_id]));

        const created = [];
        const errors  = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const rowLabel = `Row ${i + 1}${item.title ? ` ("${item.title}")` : ''}`;

            try {
                // Resolve template
                let resolvedTemplateId = null;
                if (item.templateId) {
                    resolvedTemplateId = templateById.get(String(item.templateId)) || null;
                } else if (item.templateName) {
                    resolvedTemplateId = templateByName.get(item.templateName.toLowerCase().trim()) || null;
                }
                if (!resolvedTemplateId) {
                    errors.push({
                        row: i + 1,
                        title: item.title || null,
                        error: item.templateName
                            ? `Template "${item.templateName}" not found or not published`
                            : 'templateName or templateId is required'
                    });
                    continue;
                }

                // Validate required fields
                if (!item.title || !item.title.trim()) {
                    errors.push({ row: i + 1, title: null, error: 'title is required' });
                    continue;
                }
                if (!item.deadline) {
                    errors.push({ row: i + 1, title: item.title, error: 'deadline is required' });
                    continue;
                }
                if (new Date(item.deadline) <= new Date()) {
                    errors.push({ row: i + 1, title: item.title, error: 'deadline must be in the future' });
                    continue;
                }

                const event = await RFIEventService.createEvent({
                    title: item.title.trim(),
                    description: item.description || null,
                    templateId: resolvedTemplateId,
                    deadline: item.deadline,
                    startDate: item.startDate || null,
                }, user);

                created.push({ row: i + 1, title: event.title, rfiId: event.rfiId });
            } catch (err) {
                errors.push({ row: i + 1, title: item.title || null, error: err.message });
            }
        }

        return { created, errors };
    }

    static _normalize(row) {
        if (!row) return null;
        return {
            rfiId: row.rfi_id,
            templateId: row.template_id,
            title: row.title,
            description: row.description,
            buyerId: row.buyer_id,
            publishDate: row.publish_date,
            startDate: row.start_date || null,
            deadline: row.deadline,
            status: row.status,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            supplierCount: Number(row.supplier_count ?? 0),
            submittedCount: Number(row.submitted_count ?? 0),
        };
    }

    static _normalizeInvitation(row) {
        if (!row) return null;
        return {
            invitationId: row.invitation_id,
            rfiId: row.rfi_id,
            supplierId: row.supplier_id,
            supplierName: row.supplier_name,
            supplierEmail: row.guest_email || row.supplierEmail || null,
            status: row.invitation_status,
            sentAt: row.sent_timestamp,
            viewedAt: row.viewed_at || null,
            submittedAt: row.submitted_at || null,
            expiresAt: row.expires_at || null,
            token: row.token
        };
    }
}

module.exports = RFIEventService;

const db = require('../config/database');

class RFIAnalyticsService {

    /**
     * Returns metrics for a single RFI event.
     */
    static async getEventMetrics(rfiId) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, event) => {
                if (err) return reject(err);
                if (!event) return reject(new Error('RFI event not found'));

                db.get(
                    `SELECT COUNT(*) as total_invited FROM rfi_invitation WHERE rfi_id = ?`,
                    [rfiId],
                    (err2, inviteRow) => {
                        if (err2) return reject(err2);

                        db.get(
                            `SELECT COUNT(*) as total_submitted FROM supplier_rfi_response WHERE rfi_id = ? AND status = 'SUBMITTED'`,
                            [rfiId],
                            (err3, submittedRow) => {
                                if (err3) return reject(err3);

                                db.get(
                                    `SELECT COUNT(*) as total_in_progress FROM supplier_rfi_response WHERE rfi_id = ? AND status = 'DRAFT'`,
                                    [rfiId],
                                    (err4, inProgressRow) => {
                                        if (err4) return reject(err4);

                                        // Average time to submit (seconds)
                                        db.get(
                                            `SELECT AVG(EXTRACT(EPOCH FROM (submission_date - created_at))) as avg_time_secs
                                             FROM supplier_rfi_response
                                             WHERE rfi_id = ? AND status = 'SUBMITTED' AND submission_date IS NOT NULL`,
                                            [rfiId],
                                            (err5, avgRow) => {
                                                if (err5) return reject(err5);

                                                const totalInvited = inviteRow ? (inviteRow.total_invited || 0) : 0;
                                                const totalSubmitted = submittedRow ? (submittedRow.total_submitted || 0) : 0;
                                                const totalInProgress = inProgressRow ? (inProgressRow.total_in_progress || 0) : 0;
                                                const completionRate = totalInvited > 0
                                                    ? Math.round((totalSubmitted / totalInvited) * 100)
                                                    : 0;

                                                resolve({
                                                    rfiId,
                                                    title: event.title,
                                                    status: event.status,
                                                    deadline: event.deadline,
                                                    publishDate: event.publish_date,
                                                    totalInvited,
                                                    totalSubmitted,
                                                    totalInProgress,
                                                    completionRate,
                                                    avgTimeToSubmitSecs: avgRow ? (avgRow.avg_time_secs || null) : null,
                                                    participationRate: completionRate
                                                });
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            });
        });
    }

    /**
     * Returns capability dashboard for a buyer:
     * - Total suppliers who responded to any RFI
     * - Certification coverage (how many have submitted docs)
     * - Supplier maturity (avg completion rate across all RFIs)
     */
    static async getBuyerCapabilityDashboard(buyerId) {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT e.rfi_id, e.title, e.status, e.deadline FROM rfi_event e WHERE e.buyer_id = ?`,
                [buyerId],
                (err, events) => {
                    if (err) return reject(err);
                    if (!events || events.length === 0) {
                        return resolve({
                            buyerId,
                            totalRFIs: 0,
                            totalSuppliersParticipated: 0,
                            avgCompletionRate: 0,
                            certificationCoverage: 0,
                            events: []
                        });
                    }

                    const rfiIds = events.map(e => e.rfi_id);
                    const placeholders = rfiIds.map(() => '?').join(',');

                    db.get(
                        `SELECT COUNT(DISTINCT supplier_id) as total_suppliers
                         FROM supplier_rfi_response
                         WHERE rfi_id IN (${placeholders}) AND status = 'SUBMITTED'`,
                        rfiIds,
                        (err2, suppRow) => {
                            if (err2) return reject(err2);

                            db.get(
                                `SELECT COUNT(DISTINCT r.supplier_id) as suppliers_with_docs
                                 FROM supplier_rfi_response r
                                 JOIN rfi_document_reference d ON r.response_id = d.response_id
                                 WHERE r.rfi_id IN (${placeholders})`,
                                rfiIds,
                                (err3, docRow) => {
                                    if (err3) return reject(err3);

                                    const totalSuppliers = suppRow ? (suppRow.total_suppliers || 0) : 0;
                                    const suppliersWithDocs = docRow ? (docRow.suppliers_with_docs || 0) : 0;
                                    const certCoverage = totalSuppliers > 0
                                        ? Math.round((suppliersWithDocs / totalSuppliers) * 100)
                                        : 0;

                                    // Compute per-event metrics for maturity score
                                    db.all(
                                        `SELECT r.rfi_id,
                                                COUNT(DISTINCT i.supplier_id) as invited,
                                                COUNT(DISTINCT CASE WHEN r.status = 'SUBMITTED' THEN r.supplier_id END) as submitted
                                         FROM rfi_invitation i
                                         LEFT JOIN supplier_rfi_response r ON i.rfi_id = r.rfi_id AND i.supplier_id = r.supplier_id
                                         WHERE i.rfi_id IN (${placeholders})
                                         GROUP BY r.rfi_id`,
                                        rfiIds,
                                        (err4, perEvent) => {
                                            if (err4) return reject(err4);

                                            let totalRate = 0;
                                            let counted = 0;
                                            for (const pe of (perEvent || [])) {
                                                const inv = Number(pe.invited || 0);
                                                const sub = Number(pe.submitted || 0);
                                                if (inv > 0) {
                                                    totalRate += (sub / inv) * 100;
                                                    counted++;
                                                }
                                            }
                                            const avgCompletionRate = counted > 0 ? Math.round(totalRate / counted) : 0;

                                            // Sum invited and submitted across all events
                                            const totalInvited = (perEvent || []).reduce((sum, pe) => sum + Number(pe.invited || 0), 0);
                                            const totalSubmitted = (perEvent || []).reduce((sum, pe) => sum + Number(pe.submitted || 0), 0);
                                            const totalAwaiting = Math.max(0, totalInvited - totalSubmitted);
                                            const convertedEvents = events.filter(e => e.status === 'CONVERTED').length;

                                            resolve({
                                                buyerId,
                                                totalRFIs: events.length,
                                                totalSuppliersParticipated: totalSuppliers,
                                                totalInvited,
                                                totalSubmitted,
                                                totalAwaiting,
                                                convertedEvents,
                                                avgCompletionRate,
                                                certificationCoverage: certCoverage,
                                                events: events.map(e => ({
                                                    rfiId: e.rfi_id,
                                                    title: e.title,
                                                    status: e.status,
                                                    deadline: e.deadline
                                                }))
                                            });
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        });
    }
}

module.exports = RFIAnalyticsService;

const db = require('../config/database');

/**
 * RFIToRFPService
 * Converts a closed/converted RFI into an RFP draft structure.
 * Promotes questions marked promote_to_rfp = TRUE into the RFP payload.
 */
class RFIToRFPService {

    static async convertRFIToRFP(rfiId, user) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, event) => {
                if (err) return reject(err);
                if (!event) return reject(new Error('RFI event not found'));

                if (!['CLOSED', 'CONVERTED'].includes(event.status)) {
                    return reject(new Error('RFI must be CLOSED or CONVERTED before creating an RFP'));
                }

                // Get shortlisted suppliers
                db.all(
                    `SELECT r.*, s.legalname as supplier_name
                     FROM supplier_rfi_response r
                     JOIN suppliers s ON r.supplier_id = s.supplierid
                     WHERE r.rfi_id = ? AND r.evaluation_status = 'SHORTLISTED'`,
                    [rfiId],
                    (err2, shortlisted) => {
                        if (err2) return reject(err2);

                        // Get questions promoted to RFP
                        db.all(
                            `SELECT * FROM template_question WHERE template_id = ? AND promote_to_rfp = TRUE ORDER BY display_order ASC`,
                            [event.template_id],
                            (err3, promotedQuestions) => {
                                if (err3) return reject(err3);

                                // Build RFP draft structure
                                const rfpDraft = {
                                    sourceRfiId: rfiId,
                                    sourceRfiTitle: event.title,
                                    rfpTitle: `RFP - ${event.title}`,
                                    buyerId: event.buyer_id,
                                    createdBy: user.userId,
                                    status: 'DRAFT',
                                    invitedSuppliers: (shortlisted || []).map(s => ({
                                        supplierId: s.supplier_id,
                                        supplierName: s.supplier_name
                                    })),
                                    promotedQuestions: (promotedQuestions || []).map(q => ({
                                        questionId: q.question_id,
                                        questionText: q.question_text,
                                        questionType: q.question_type,
                                        mandatory: q.mandatory
                                    })),
                                    totalShortlisted: (shortlisted || []).length,
                                    totalPromotedQuestions: (promotedQuestions || []).length,
                                    generatedAt: new Date().toISOString(),
                                    note: 'RFP draft created from RFI conversion. Review and finalize before publishing.'
                                };

                                console.log(`[RFIToRFPService] RFP draft created from RFI ${rfiId} with ${rfpDraft.totalShortlisted} shortlisted suppliers`);
                                resolve(rfpDraft);
                            }
                        );
                    }
                );
            });
        });
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

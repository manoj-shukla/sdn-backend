const db = require('../config/database');

const VALID_EVALUATION_STATUSES = ['PENDING', 'UNDER_REVIEW', 'SHORTLISTED', 'REJECTED', 'CLARIFICATION_PENDING'];

class RFIEvaluationService {

    /**
     * Returns a comparison matrix: all suppliers × all questions with their answers.
     */
    static async getComparisonMatrix(rfiId) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], async (err, event) => {
                if (err) return reject(err);
                if (!event) return reject(new Error('RFI event not found'));

                try {
                    const RFITemplateService = require('./RFITemplateService');
                    const template = await RFITemplateService.getTemplateById(event.template_id);
                    // Normalize sections to the same nested format as getEventById
                    // so frontend can consistently access q.question.questionId, q.question.text, etc.
                    const rawSections = template?.sections || [];
                    const sections = rawSections.map(section => ({
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
                    }));

                    // Process responses rows into the final shape
                    const processResponses = (responses) => {
                        if (!responses || responses.length === 0) {
                            return resolve({ rfiId, rfiTitle: event.title, sections, suppliers: [] });
                        }
                        const responseIds = responses.map(r => r.response_id);
                        const placeholders = responseIds.map(() => '?').join(',');
                        db.all(
                            `SELECT * FROM supplier_rfi_response_detail WHERE response_id IN (${placeholders})`,
                            responseIds,
                            (errD, details) => {
                                if (errD) return reject(errD);
                                const answerMap = {};
                                for (const detail of (details || [])) {
                                    if (!answerMap[detail.response_id]) answerMap[detail.response_id] = {};
                                    let val = detail.answer_value;
                                    try {
                                        if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
                                            val = JSON.parse(val);
                                        }
                                    } catch(e) {}
                                    answerMap[detail.response_id][detail.question_id] = val;
                                }
                                const suppliers = responses.map(r => {
                                    let notes = [];
                                    if (r.internal_notes) {
                                        try { notes = JSON.parse(r.internal_notes); } catch(e) {}
                                        if (!Array.isArray(notes)) notes = [];
                                    }
                                    const answers = [];
                                    for (const s of sections) {
                                        for (const q of (s.questions || [])) {
                                            const qd = q.question || q;
                                            const val = (answerMap[r.response_id] || {})[qd.questionId];
                                            if (val !== undefined && val !== null) {
                                                answers.push({ questionId: qd.questionId, value: val });
                                            }
                                        }
                                    }
                                    return {
                                        supplierId: r.supplier_id,
                                        supplierName: r.supplier_name,
                                        invitationStatus: r.invitation_status || 'SUBMITTED',
                                        evaluationStatus: r.evaluation_status || 'PENDING',
                                        completionPercent: r.completion_percent || 100,
                                        submittedAt: r.submission_date,
                                        notes,
                                        answers
                                    };
                                });
                                resolve({ rfiId, rfiTitle: event.title, sections, suppliers });
                            }
                        );
                    };

                    // Fetch responses — with self-healing for missing evaluation columns
                    db.all(
                        `SELECT r.*, s.legalname as supplier_name, i.invitation_status
                         FROM supplier_rfi_response r
                         JOIN suppliers s ON r.supplier_id = s.supplierid
                         LEFT JOIN rfi_invitation i ON i.rfi_id = r.rfi_id AND i.supplier_id = r.supplier_id
                         WHERE r.rfi_id = ? AND r.status = 'SUBMITTED'
                         ORDER BY r.submission_date ASC`,
                        [rfiId],
                        (err3, responses) => {
                            if (err3) return reject(err3);
                            processResponses(responses || []);
                        }
                    );
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Get the full response for a single supplier.
     */
    static async getSupplierResponse(rfiId, supplierId) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT r.*, s.legalname as supplier_name, e.title, e.template_id
                 FROM supplier_rfi_response r
                 JOIN suppliers s ON r.supplier_id = s.supplierid
                 JOIN rfi_event e ON r.rfi_id = e.rfi_id
                 WHERE r.rfi_id = ? AND r.supplier_id = ?`,
                [rfiId, supplierId],
                async (err, response) => {
                    if (err) return reject(err);
                    if (!response) return resolve(null);

                    try {
                        const details = await new Promise((res, rej) => {
                            db.all(
                                `SELECT d.*, q.question_text, q.question_type
                                 FROM supplier_rfi_response_detail d
                                 JOIN template_question q ON d.question_id = q.question_id
                                 WHERE d.response_id = ?`,
                                [response.response_id],
                                (err2, rows) => { if (err2) rej(err2); else res(rows || []); }
                            );
                        });

                        const docs = await new Promise((res, rej) => {
                            db.all(
                                `SELECT * FROM rfi_document_reference WHERE response_id = ?`,
                                [response.response_id],
                                (err3, rows) => { if (err3) rej(err3); else res(rows || []); }
                            );
                        });

                        // Enrich with template sections so frontend can display answers grouped by section
                        let template = null;
                        if (response.template_id) {
                            try {
                                const RFITemplateService = require('./RFITemplateService');
                                const tmpl = await RFITemplateService.getTemplateById(response.template_id);
                                if (tmpl) {
                                    template = {
                                        ...tmpl,
                                        sections: (tmpl.sections || []).map(section => ({
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
                                console.error('[RFIEvaluationService] Failed to load template:', e.message);
                            }
                        }

                        resolve({
                            responseId: response.response_id,
                            rfiId: response.rfi_id,
                            supplierId: response.supplier_id,
                            supplierName: response.supplier_name,
                            title: response.title,
                            status: response.status,
                            evaluationStatus: response.evaluation_status,
                            internalNotes: response.internal_notes,
                            submissionDate: response.submission_date,
                            template,
                            answers: details.map(d => {
                                let answerValue = d.answer_value;
                                try {
                                    if (typeof answerValue === 'string' && (answerValue.startsWith('{') || answerValue.startsWith('['))) {
                                        answerValue = JSON.parse(answerValue);
                                    }
                                } catch(e) {}
                                return {
                                    questionId: d.question_id,
                                    questionText: d.question_text,
                                    questionType: d.question_type,
                                    answerValue
                                };
                            }),
                            documents: docs.map(doc => ({
                                docRefId: doc.doc_ref_id,
                                fileName: doc.file_name,
                                fileType: doc.file_type,
                                fileUrl: doc.file_url,
                                uploadDate: doc.upload_date
                            }))
                        });
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    static async addInternalNotes(rfiId, supplierId, textValue, user) {
        const response = await new Promise((res, rej) => {
            db.get(`SELECT * FROM supplier_rfi_response WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });
        if (!response) throw new Error('Response not found');

        const newNote = { text: textValue, createdAt: new Date().toISOString() };
        let notes = [];
        if (response.internal_notes) {
            try { notes = JSON.parse(response.internal_notes); } catch(e) {}
            if (!Array.isArray(notes)) notes = [];
        }
        notes.push(newNote);

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE supplier_rfi_response SET internal_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE response_id = ?`,
                [JSON.stringify(notes), response.response_id],
                function(err) {
                    if (err) return reject(err);
                    resolve({ responseId: response.response_id, internalNotes: notes });
                }
            );
        });
    }

    static async updateEvaluationStatus(rfiId, supplierId, status, user) {
        if (!VALID_EVALUATION_STATUSES.includes(status)) {
            throw new Error(`Invalid evaluation status: ${status}. Must be one of: ${VALID_EVALUATION_STATUSES.join(', ')}`);
        }

        const response = await new Promise((res, rej) => {
            db.get(`SELECT * FROM supplier_rfi_response WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });
        if (!response) throw new Error('Response not found');

        const doUpdate = () => new Promise((resolve, reject) => {
            db.run(
                `UPDATE supplier_rfi_response SET evaluation_status = ?, updated_at = CURRENT_TIMESTAMP WHERE response_id = ?`,
                [status, response.response_id],
                function(err) {
                    if (err) return reject(err);
                    resolve({ responseId: response.response_id, evaluationStatus: status });
                }
            );
        });

        try {
            return await doUpdate();
        } catch (err) {
            // Self-heal: if evaluation_status column is missing, add it and retry
            if (err && err.message && err.message.includes('evaluation_status')) {
                console.warn('[RFIEvaluationService] evaluation_status column missing — adding it now');
                await new Promise((res) => {
                    db.run(`ALTER TABLE supplier_rfi_response ADD COLUMN IF NOT EXISTS evaluation_status TEXT DEFAULT 'UNDER_REVIEW'`, [], () => res());
                });
                return await doUpdate();
            }
            throw err;
        }
    }

    static async requestClarification(rfiId, supplierId, message, user) {
        const response = await new Promise((res, rej) => {
            db.get(`SELECT * FROM supplier_rfi_response WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });
        if (!response) throw new Error('Response not found');
        if (response.status !== 'SUBMITTED') throw new Error('Can only request clarification on SUBMITTED responses');

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE supplier_rfi_response SET status = 'CLARIFICATION_REQUESTED', evaluation_status = 'CLARIFICATION_PENDING', updated_at = CURRENT_TIMESTAMP WHERE response_id = ?`,
                [response.response_id],
                function(err) {
                    if (err) return reject(err);
                    // Update invitation status back to IN_PROGRESS for clarification
                    db.run(
                        `UPDATE rfi_invitation SET invitation_status = 'IN_PROGRESS' WHERE rfi_id = ? AND supplier_id = ?`,
                        [rfiId, supplierId],
                        () => {}
                    );
                    resolve({ responseId: response.response_id, status: 'CLARIFICATION_REQUESTED', message });
                }
            );
        });
    }
}

module.exports = RFIEvaluationService;

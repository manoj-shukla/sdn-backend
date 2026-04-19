const db = require('../config/database');
const { randomUUID } = require('crypto');
const NotificationService = require('./NotificationService');

const VALID_RESPONSE_TRANSITIONS = {
    NOT_STARTED: ['DRAFT'],
    DRAFT: ['SUBMITTED'],
    SUBMITTED: ['CLARIFICATION_REQUESTED'],
    CLARIFICATION_REQUESTED: ['DRAFT']
};

class RFIResponseService {

    static async getMyRFI(rfiId, supplierId) {
        const row = await new Promise((resolve, reject) => {
            db.get(
                `SELECT r.*, e.title, e.deadline, e.status as event_status, e.template_id
                 FROM supplier_rfi_response r
                 JOIN rfi_event e ON r.rfi_id = e.rfi_id
                 WHERE r.rfi_id = ? AND r.supplier_id = ?`,
                [rfiId, supplierId],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });

        let result;

        if (!row) {
            // Return minimal info if no response record yet
            const event = await new Promise((res, rej) => {
                db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, ev) => {
                    if (err) rej(err); else res(ev);
                });
            });
            if (!event) return null;
            result = {
                rfiId,
                supplierId,
                status: 'NOT_STARTED',
                title: event.title,
                deadline: event.deadline,
                eventStatus: event.status,
                templateId: event.template_id
            };
        } else {
            const details = await new Promise((res, rej) => {
                db.all(
                    `SELECT * FROM supplier_rfi_response_detail WHERE response_id = ?`,
                    [row.response_id],
                    (err, rows) => { if (err) rej(err); else res(rows); }
                );
            });
            result = RFIResponseService._normalize(row);
            result.templateId = row.template_id;
            result.answers = (details || []).map(RFIResponseService._normalizeDetail);
        }

        // Enrich with template sections and questions so the frontend can render them
        const templateId = result.templateId;
        if (templateId) {
            try {
                const RFITemplateService = require('./RFITemplateService');
                const template = await RFITemplateService.getTemplateById(templateId);
                if (template) {
                    result.template = {
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
                console.error('[RFIResponseService] Failed to load template for response:', e.message);
            }
        }

        return result;
    }

    static async saveDraft(rfiId, supplierId, answers) {
        // Validate event is still OPEN
        const event = await new Promise((res, rej) => {
            db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });
        if (!event) throw new Error('RFI event not found');
        if (event.status !== 'OPEN') throw new Error('RFI is not accepting responses');

        // Check deadline
        if (event.deadline && new Date() > new Date(event.deadline)) {
            throw new Error('RFI deadline has passed. Cannot save draft.');
        }

        // Upsert response record
        const existing = await new Promise((res, rej) => {
            db.get(`SELECT * FROM supplier_rfi_response WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });

        let responseId;

        if (existing) {
            responseId = existing.response_id;
            // Allow DRAFT → DRAFT or CLARIFICATION_REQUESTED → DRAFT
            if (!['NOT_STARTED', 'DRAFT', 'CLARIFICATION_REQUESTED'].includes(existing.status)) {
                throw new Error(`Cannot save draft when response status is ${existing.status}`);
            }
            await new Promise((res, rej) => {
                db.run(
                    `UPDATE supplier_rfi_response SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE response_id = ?`,
                    [responseId],
                    function(err) { if (err) rej(err); else res(); }
                );
            });
        } else {
            responseId = randomUUID();
            await new Promise((res, rej) => {
                db.run(
                    `INSERT INTO supplier_rfi_response (response_id, rfi_id, supplier_id, status, created_at, updated_at) VALUES (?, ?, ?, 'DRAFT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                    [responseId, rfiId, supplierId],
                    function(err) { if (err) rej(err); else res(); }
                );
            });
        }

        // Save/update answers — accept both `value` (object) and `answerValue` (string) fields
        if (answers && answers.length > 0) {
            for (const answer of answers) {
                if (!answer.questionId) continue;

                // Serialize value to JSON string for storage
                let rawValue = answer.value !== undefined ? answer.value : answer.answerValue;
                if (rawValue !== null && rawValue !== undefined && typeof rawValue === 'object') {
                    rawValue = JSON.stringify(rawValue);
                }
                const storedValue = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';

                const existingDetail = await new Promise((res, rej) => {
                    db.get(`SELECT * FROM supplier_rfi_response_detail WHERE response_id = ? AND question_id = ?`,
                        [responseId, answer.questionId],
                        (err, row) => { if (err) rej(err); else res(row); }
                    );
                });

                if (existingDetail) {
                    await new Promise((res, rej) => {
                        db.run(
                            `UPDATE supplier_rfi_response_detail SET answer_value = ? WHERE response_detail_id = ?`,
                            [storedValue, existingDetail.response_detail_id],
                            function(err) { if (err) rej(err); else res(); }
                        );
                    });
                } else {
                    await new Promise((res, rej) => {
                        db.run(
                            `INSERT INTO supplier_rfi_response_detail (response_detail_id, response_id, question_id, answer_value) VALUES (?, ?, ?, ?)`,
                            [randomUUID(), responseId, answer.questionId, storedValue],
                            function(err) { if (err) rej(err); else res(); }
                        );
                    });
                }
            }
        }

        return RFIResponseService.getMyRFI(rfiId, supplierId);
    }

    static async submitResponse(rfiId, supplierId, answers) {
        // Validate event is OPEN
        const event = await new Promise((res, rej) => {
            db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });
        if (!event) throw new Error('RFI event not found');
        if (event.status !== 'OPEN') throw new Error('RFI is not accepting responses');

        // Enforce deadline
        if (event.deadline && new Date() > new Date(event.deadline)) {
            throw new Error('Submission rejected: RFI deadline has passed');
        }

        // Save answers as draft first
        await RFIResponseService.saveDraft(rfiId, supplierId, answers);

        // Validate mandatory questions are answered
        const validationErrors = await RFIResponseService._validateMandatoryFields(rfiId, supplierId);
        if (validationErrors.length > 0) {
            throw Object.assign(new Error('Mandatory fields missing'), { fieldErrors: validationErrors });
        }

        // Get response
        const response = await new Promise((res, rej) => {
            db.get(`SELECT * FROM supplier_rfi_response WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });

        // Compute completion percentage for this submission (same logic as getProgress)
        let completionPercent = 100;
        try {
            const totalRow = await new Promise((res, rej) => {
                db.get(
                    `SELECT COUNT(*) as cnt FROM template_question WHERE template_id = ?`,
                    [event.template_id],
                    (err, row) => { if (err) rej(err); else res(row); }
                );
            });
            const total = Number(totalRow?.cnt || 0);
            if (total > 0) {
                const answeredRow = await new Promise((res, rej) => {
                    db.get(
                        `SELECT COUNT(*) as cnt FROM supplier_rfi_response_detail
                         WHERE response_id = ? AND answer_value IS NOT NULL AND answer_value != ''`,
                        [response.response_id],
                        (err, row) => { if (err) rej(err); else res(row); }
                    );
                });
                const answered = Number(answeredRow?.cnt || 0);
                completionPercent = Math.round((answered / total) * 100);
            }
        } catch (compErr) {
            console.warn('[RFIResponseService] Failed to compute completion_percent:', compErr.message);
            completionPercent = 100;
        }

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE supplier_rfi_response SET status = 'SUBMITTED', completion_percent = ?, submission_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE response_id = ?`,
                [completionPercent, response.response_id],
                async function(err) {
                    if (err) return reject(err);

                    // Update invitation status
                    db.run(
                        `UPDATE rfi_invitation SET invitation_status = 'SUBMITTED' WHERE rfi_id = ? AND supplier_id = ? AND invitation_status != 'EXPIRED'`,
                        [rfiId, supplierId],
                        () => {}
                    );

                    // Notify the buyer that a supplier has submitted their RFI response
                    try {
                        const supplierRow = await new Promise((res2, rej2) => {
                            db.get(`SELECT legalname FROM suppliers WHERE supplierId = ?`, [supplierId], (e, r) => {
                                if (e) rej2(e); else res2(r);
                            });
                        });
                        const supplierName = supplierRow ? supplierRow.legalname : 'A supplier';
                        await NotificationService.createNotification({
                            type: 'RFI_RESPONSE_SUBMITTED',
                            message: `${supplierName} has submitted their response to RFI: ${event.title}. You can now review their answers.`,
                            entityId: rfiId,
                            recipientRole: 'BUYER',
                            buyerId: event.buyer_id,
                        });
                    } catch (notifErr) {
                        console.error('[RFIResponseService] Failed to notify buyer on submission:', notifErr.message);
                    }

                    const result = await RFIResponseService.getMyRFI(rfiId, supplierId);
                    resolve(result);
                }
            );
        });
    }

    static async uploadDocument(rfiId, supplierId, fileData) {
        const response = await new Promise((res, rej) => {
            db.get(`SELECT * FROM supplier_rfi_response WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });
        if (!response) throw new Error('Response record not found. Save a draft first.');

        const { fileName, fileType, fileUrl } = fileData;
        if (!fileName) throw new Error('fileName is required');

        const docRefId = randomUUID();

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfi_document_reference (doc_ref_id, response_id, file_name, file_type, file_url, upload_date) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [docRefId, response.response_id, fileName, fileType || null, fileUrl || null],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfi_document_reference WHERE doc_ref_id = ?`, [docRefId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFIResponseService._normalizeDoc(row));
                    });
                }
            );
        });
    }

    static async getProgress(rfiId, supplierId) {
        const event = await new Promise((res, rej) => {
            db.get(`SELECT e.*, t.template_id FROM rfi_event e LEFT JOIN rfi_template t ON e.template_id = t.template_id WHERE e.rfi_id = ?`, [rfiId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });
        if (!event) throw new Error('RFI event not found');

        const totalQuestions = await new Promise((res, rej) => {
            db.get(`SELECT COUNT(*) as cnt FROM template_question WHERE template_id = ?`, [event.template_id || event.template_id], (err, row) => {
                if (err) rej(err); else res(row ? (row.cnt || 0) : 0);
            });
        });

        const response = await new Promise((res, rej) => {
            db.get(`SELECT * FROM supplier_rfi_response WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });

        if (!response) {
            return { rfiId, supplierId, status: 'NOT_STARTED', answered: 0, totalRequired: totalQuestions, percentComplete: 0 };
        }

        const answeredCount = await new Promise((res, rej) => {
            db.get(`SELECT COUNT(*) as cnt FROM supplier_rfi_response_detail WHERE response_id = ? AND answer_value IS NOT NULL AND answer_value != ''`,
                [response.response_id],
                (err, row) => { if (err) rej(err); else res(row ? (row.cnt || 0) : 0); }
            );
        });

        const percentComplete = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

        return {
            rfiId,
            supplierId,
            responseId: response.response_id,
            status: response.status,
            answered: answeredCount,
            totalRequired: totalQuestions,
            percentComplete,
            submissionDate: response.submission_date
        };
    }

    static async _validateMandatoryFields(rfiId, supplierId) {
        const errors = [];

        const event = await new Promise((res, rej) => {
            db.get(`SELECT * FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });
        if (!event || !event.template_id) return errors;

        const mandatoryQuestions = await new Promise((res, rej) => {
            db.all(`SELECT * FROM template_question WHERE template_id = ? AND mandatory = TRUE`, [event.template_id], (err, rows) => {
                if (err) rej(err); else res(rows || []);
            });
        });

        if (mandatoryQuestions.length === 0) return errors;

        const response = await new Promise((res, rej) => {
            db.get(`SELECT * FROM supplier_rfi_response WHERE rfi_id = ? AND supplier_id = ?`, [rfiId, supplierId], (err, row) => {
                if (err) rej(err); else res(row);
            });
        });
        if (!response) return mandatoryQuestions.map(q => ({ questionId: q.question_id, error: 'Answer required' }));

        const answers = await new Promise((res, rej) => {
            db.all(`SELECT * FROM supplier_rfi_response_detail WHERE response_id = ?`, [response.response_id], (err, rows) => {
                if (err) rej(err); else res(rows || []);
            });
        });

        // Build supplier context for rule engine overlay
        const supplier = await new Promise((res, rej) => {
            db.get(`SELECT * FROM suppliers WHERE supplierId = ?`, [supplierId], (err, row) => {
                 if (err) rej(err); else res(row);
            });
        });
        
        const supplierContext = {
            country: supplier ? supplier.country : null,
            crossBorder: supplier ? (supplier.country && supplier.country.toLowerCase() !== 'india') : false,
            supplierId
        };

        for (const a of answers) {
            let val = a.answer_value;
            try { val = JSON.parse(val); } catch(e) {}
            if (val && typeof val === 'object') {
                if (val.selected !== undefined) supplierContext[a.question_id] = val.selected;
                else if (val.bool !== undefined) supplierContext[a.question_id] = val.bool ? 'yes' : 'no';
                else if (val.text !== undefined) supplierContext[a.question_id] = val.text;
                else supplierContext[a.question_id] = val;
            } else {
                supplierContext[a.question_id] = val;
            }
        }

        const RFIRuleEngineService = require('./RFIRuleEngineService');
        const evalResult = await RFIRuleEngineService.evaluateRules(rfiId, supplierContext);
        const visibleIds = new Set(evalResult.visibleQuestionIds);

        const answeredSet = new Set(answers.filter(a => {
            if (!a.answer_value) return false;
            let str = String(a.answer_value).trim();
            if (str === '' || str === '{}' || str === '[]') return false;
            try {
                const p = JSON.parse(str);
                if (typeof p === 'object') {
                    if (p.text === "" && p.selected === undefined && p.bool === undefined && !p.attachments?.length && !p.tableRows?.length) return false;
                }
            } catch(e) {}
            return true;
        }).map(a => a.question_id));

        for (const q of mandatoryQuestions) {
            if (visibleIds.has(q.question_id)) {
                if (!answeredSet.has(q.question_id)) {
                    errors.push({ questionId: q.question_id, questionText: q.question_text, error: 'This field is required' });
                }
            }
        }

        return errors;
    }

    static _normalize(row) {
        if (!row) return null;
        return {
            responseId: row.response_id,
            rfiId: row.rfi_id,
            supplierId: row.supplier_id,
            submissionDate: row.submission_date,
            status: row.status,
            internalNotes: row.internal_notes,
            evaluationStatus: row.evaluation_status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            title: row.title,
            deadline: row.deadline,
            eventStatus: row.event_status
        };
    }

    static _normalizeDetail(row) {
        if (!row) return null;
        let answerValue = row.answer_value;
        if (answerValue && typeof answerValue === 'string') {
            try { answerValue = JSON.parse(answerValue); } catch { /* not JSON, keep as string */ }
        }
        return {
            responseDetailId: row.response_detail_id,
            responseId: row.response_id,
            questionId: row.question_id,
            answerValue,
            attachmentId: row.attachment_id
        };
    }

    static _normalizeDoc(row) {
        if (!row) return null;
        return {
            docRefId: row.doc_ref_id,
            responseId: row.response_id,
            fileName: row.file_name,
            fileType: row.file_type,
            fileUrl: row.file_url,
            uploadDate: row.upload_date
        };
    }
}

module.exports = RFIResponseService;

const db = require('../config/database');
const { randomUUID } = require('crypto');

const VALID_TRANSITIONS = {
    DRAFT: ['PUBLISHED', 'ARCHIVED'],   // DRAFT can be discarded (→ ARCHIVED) or published
    PUBLISHED: ['ARCHIVED'],
    ARCHIVED: []
};

class RFITemplateService {

    /**
     * Enterprise helper: resolve or create a library question for a template question.
     *
     * Enterprise pattern:
     *   - If the frontend provides a library questionId (from the picker), link to it directly.
     *   - If the question is new (inline), auto-register it in rfi_question_library so the
     *     library stays the single source of truth, then link the template question to it.
     *
     * Returns { libraryQuestionId, questionText, questionType, options }
     */
    static async _resolveLibraryQuestion(q, user) {
        const questionData = q.question || q;
        const text = (questionData.questionText || questionData.text || '').trim();
        const type = questionData.questionType || 'SHORT_TEXT';
        const options = questionData.options ? JSON.stringify(questionData.options) : null;
        const validationRules = questionData.validationRules ? JSON.stringify(questionData.validationRules) : null;
        const mandatory = q.mandatory || q.isMandatory || false;
        const promoteToRfp = q.promoteToRfp || false;

        // Case 1: question came from the library — the frontend passes questionId
        // Verify the library question actually exists before trusting the id
        if (q.questionId && String(q.questionId) !== '0') {
            const exists = await new Promise((resolve) => {
                db.get(
                    `SELECT question_id FROM rfi_question_library WHERE question_id = ? AND is_deleted = FALSE`,
                    [q.questionId],
                    (err, row) => resolve(row || null)
                );
            });
            if (exists) {
                return { libraryQuestionId: q.questionId, questionText: text, questionType: type, options, validationRules, mandatory, promoteToRfp };
            }
        }

        // Case 2: inline question — register it in the library so the library is always complete
        if (!text) {
            // Blank questions are allowed during drafting; skip library registration
            return { libraryQuestionId: null, questionText: text, questionType: type, options, validationRules, mandatory, promoteToRfp };
        }
        const newLibId = randomUUID();
        await new Promise((resolve) => {
            db.run(
                `INSERT INTO rfi_question_library
                    (question_id, question_text, question_type, created_by, is_deleted, created_at, mandatory, promote_to_rfp, options)
                 VALUES (?, ?, ?, ?, FALSE, CURRENT_TIMESTAMP, ?, ?, ?)`,
                [newLibId, text, type, user ? (user.userId || null) : null, mandatory, promoteToRfp, options],
                (err) => {
                    if (err) console.warn('[RFITemplateService] auto-library question insert warning:', err.message);
                    resolve();
                }
            );
        });
        return { libraryQuestionId: newLibId, questionText: text, questionType: type, options, validationRules, mandatory, promoteToRfp };
    }

    /**
     * Persist sections + questions for a template.
     * Used by both createTemplate and updateTemplate.
     * Deletes existing sections/questions for the template before inserting.
     */
    static async _replaceSections(templateId, sections, user) {
        // Delete existing (questions first, then sections — no CASCADE in SQLite)
        await new Promise((res, rej) => db.run(`DELETE FROM template_question WHERE template_id = ?`, [templateId], (e) => e ? rej(e) : res()));
        await new Promise((res, rej) => db.run(`DELETE FROM template_section WHERE template_id = ?`, [templateId], (e) => e ? rej(e) : res()));

        for (const s of sections) {
            const sectionId = randomUUID();
            await new Promise((res, rej) => {
                db.run(
                    `INSERT INTO template_section (section_id, template_id, section_name, section_description, display_order, is_mandatory)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [sectionId, templateId, s.sectionName || s.title, s.sectionDescription || s.description || null,
                     s.displayOrder || s.orderIndex || 0, s.isMandatory !== false],
                    (e) => e ? rej(e) : res()
                );
            });

            if (s.questions && Array.isArray(s.questions)) {
                for (let qi = 0; qi < s.questions.length; qi++) {
                    const q = s.questions[qi];
                    const resolved = await RFITemplateService._resolveLibraryQuestion(q, user);
                    await new Promise((res, rej) => {
                        db.run(
                            `INSERT INTO template_question
                                (question_id, section_id, template_id, library_question_id,
                                 question_text, question_type, mandatory, promote_to_rfp,
                                 options, validation_rules, display_order)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [randomUUID(), sectionId, templateId, resolved.libraryQuestionId,
                             resolved.questionText, resolved.questionType,
                             resolved.mandatory, resolved.promoteToRfp,
                             resolved.options, resolved.validationRules,
                             q.displayOrder || q.orderIndex || qi],
                            (e) => e ? rej(e) : res()
                        );
                    });
                }
            }
        }
    }

    static async createTemplate(data, user) {
        const { templateName, name, category, subcategory, applicableRegions, regions, regulatoryOverlays, sections } = data;
        const finalName = templateName || name;
        if (!finalName) throw new Error('templateName is required');
        const finalRegions = applicableRegions || regions;

        const templateId = randomUUID();
        const buyerId = user.buyerId || null;
        const createdBy = user.userId;

        // Uniqueness check: prevent duplicate names for the same buyer (excluding ARCHIVED)
        const existing = await new Promise((resolve) => {
            const sql = buyerId
                ? `SELECT template_id FROM rfi_template WHERE template_name = ? AND buyer_id = ? AND status != 'ARCHIVED'`
                : `SELECT template_id FROM rfi_template WHERE template_name = ? AND buyer_id IS NULL AND status != 'ARCHIVED'`;
            const params = buyerId ? [finalName, buyerId] : [finalName];
            db.get(sql, params, (err, row) => resolve(row || null));
        });
        if (existing) throw new Error(`A template named "${finalName}" already exists.`);

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfi_template (template_id, template_name, category, subcategory, version, status, created_by, buyer_id, applicable_regions, regulatory_overlays, created_date, updated_date)
                 VALUES (?, ?, ?, ?, 1, 'DRAFT', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [templateId, finalName, category || null, subcategory || null, createdBy, buyerId,
                 finalRegions || null,
                 regulatoryOverlays || null],
                function(err) {
                    if (err) return reject(err);
                    
                    // Handle nested sections and questions using the enterprise helper
                    (async () => {
                        try {
                            if (sections && Array.isArray(sections)) {
                                await RFITemplateService._replaceSections(templateId, sections, user);
                            }
                            db.get(`SELECT * FROM rfi_template WHERE template_id = ?`, [templateId], (err2, row) => {
                                if (err2) return reject(err2);
                                resolve(RFITemplateService._normalize(row));
                            });
                        } catch (e) {
                            reject(e);
                        }
                    })();
                }
            );
        });
    }

    static async listTemplates(filters, user) {
        return new Promise((resolve, reject) => {
            let query = `SELECT t.*,
                (SELECT COUNT(*) FROM template_section s WHERE s.template_id = t.template_id) as section_count,
                (SELECT COUNT(*) FROM template_question q WHERE q.template_id = t.template_id) as question_count
                FROM rfi_template t WHERE 1=1`;
            const params = [];

            if (user.buyerId) {
                query += ` AND t.buyer_id = ?`;
                params.push(user.buyerId);
            }
            if (filters && filters.status) {
                query += ` AND status = ?`;
                params.push(filters.status);
            }
            if (filters && filters.category) {
                query += ` AND category = ?`;
                params.push(filters.category);
            }

            query += ` ORDER BY created_date DESC`;

            db.all(query, params, (err, rows) => {
                if (err) return reject(err);
                resolve((rows || []).map(RFITemplateService._normalize));
            });
        });
    }

    static async getTemplateById(templateId) {
        const template = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM rfi_template WHERE template_id = ?`, [templateId], (err, row) => {
                if (err) return reject(err);
                resolve(RFITemplateService._normalize(row));
            });
        });

        if (!template) return null;

        // Fetch sections
        const sections = await new Promise((resolve, reject) => {
            db.all(`SELECT * FROM template_section WHERE template_id = ? ORDER BY display_order ASC`, [templateId], (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map(RFITemplateService._normalizeSection));
            });
        });

        // Fetch questions for each section — JOIN with library for live question text
        for (const section of sections) {
            section.questions = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT tq.*,
                            COALESCE(ql.question_text, tq.question_text) AS resolved_text,
                            COALESCE(ql.question_type, tq.question_type) AS resolved_type,
                            ql.question_id AS lib_question_id
                     FROM template_question tq
                     LEFT JOIN rfi_question_library ql
                            ON tq.library_question_id = ql.question_id AND ql.is_deleted = FALSE
                     WHERE tq.section_id = ?
                     ORDER BY tq.display_order ASC`,
                    [section.sectionId],
                    (err, rows) => {
                        if (err) return reject(err);
                        resolve(rows.map(RFITemplateService._normalizeQuestion));
                    }
                );
            });
        }

        template.sections = sections;
        return template;
    }

    static async updateTemplate(templateId, data, user) {
        const current = await RFITemplateService.getTemplateById(templateId);
        if (!current) throw new Error('Template not found');
        if (current.status !== 'DRAFT') throw new Error('Only DRAFT templates can be edited');
        const { templateName, name, category, subcategory, applicableRegions, regions, regulatoryOverlays, version } = data;
        const finalName = templateName || name || current.templateName;
        const finalRegions = applicableRegions || regions || current.applicableRegions;
        const finalVersion = version ? parseInt(version) : current.version;

        // If the name changed, check uniqueness (excluding this template itself)
        if (finalName !== current.templateName) {
            const buyerId = current.buyerId || null;
            const conflict = await new Promise((resolve) => {
                const sql = buyerId
                    ? `SELECT template_id FROM rfi_template WHERE template_name = ? AND buyer_id = ? AND status != 'ARCHIVED' AND template_id != ?`
                    : `SELECT template_id FROM rfi_template WHERE template_name = ? AND buyer_id IS NULL AND status != 'ARCHIVED' AND template_id != ?`;
                const params = buyerId ? [finalName, buyerId, templateId] : [finalName, templateId];
                db.get(sql, params, (err, row) => resolve(row || null));
            });
            if (conflict) throw new Error(`A template named "${finalName}" already exists.`);
        }

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_template SET template_name = ?, category = ?, subcategory = ?,
                 applicable_regions = ?, regulatory_overlays = ?, version = ?, updated_date = CURRENT_TIMESTAMP
                 WHERE template_id = ?`,
                [finalName, category || current.category,
                 subcategory || current.subcategory,
                 finalRegions || null,
                 regulatoryOverlays || null,
                 finalVersion,
                 templateId],
                function(err) {
                    if (err) return reject(err);

                    // For DRAFT templates, replace sections/questions using the enterprise helper
                    (async () => {
                        try {
                            const { sections } = data;
                            if (sections && Array.isArray(sections)) {
                                await RFITemplateService._replaceSections(templateId, sections, user);
                            }
                            db.get(`SELECT * FROM rfi_template WHERE template_id = ?`, [templateId], (err2, row) => {
                                if (err2) return reject(err2);
                                resolve(RFITemplateService._normalize(row));
                            });
                        } catch (e) {
                            reject(e);
                        }
                    })();
                }
            );
        });
    }

    static async publishTemplate(templateId, user) {
        const current = await RFITemplateService.getTemplateById(templateId);
        if (!current) throw new Error('Template not found');
        if (!VALID_TRANSITIONS[current.status] || !VALID_TRANSITIONS[current.status].includes('PUBLISHED')) {
            throw new Error(`Cannot publish template in status ${current.status}`);
        }

        // Check for circular rules before publishing
        const RFIRuleEngineService = require('./RFIRuleEngineService');
        const hasCircular = await RFIRuleEngineService.detectCircularLogic(templateId);
        if (hasCircular) throw new Error('Template has circular rule logic and cannot be published');

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_template SET status = 'PUBLISHED', updated_date = CURRENT_TIMESTAMP WHERE template_id = ?`,
                [templateId],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfi_template WHERE template_id = ?`, [templateId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFITemplateService._normalize(row));
                    });
                }
            );
        });
    }

    /**
     * Bulk-import templates from a flat row array.
     * Each row: { templateName, category?, sectionName?, questionText?, questionType?, mandatory?, promoteToRfp? }
     * Rows with the same templateName are grouped into one template.
     * Rows with the same templateName + sectionName are grouped into one section.
     * Returns { created: [...], errors: [...] }
     */
    static async importTemplates(rows, user) {
        const VALID_TYPES = ['SHORT_TEXT','LONG_TEXT','YES_NO','SINGLE_SELECT','MULTI_SELECT','NUMERIC','ATTACHMENT','TABLE'];

        // Group rows by templateName
        const templateMap = new Map(); // templateName → { category, sections: Map<sectionName, questions[]> }

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const tplName = (row.templateName || row.template_name || '').trim();
            if (!tplName) continue; // skip blank template names

            if (!templateMap.has(tplName)) {
                templateMap.set(tplName, {
                    category: (row.category || '').trim() || null,
                    sections: new Map()
                });
            }
            const tpl = templateMap.get(tplName);

            const sectionName = (row.sectionName || row.section_name || 'General').trim();
            if (!tpl.sections.has(sectionName)) {
                tpl.sections.set(sectionName, []);
            }

            const qText = (row.questionText || row.question_text || row.question || '').trim();
            if (qText) {
                const qType = (row.questionType || row.question_type || 'SHORT_TEXT').trim().toUpperCase();
                tpl.sections.get(sectionName).push({
                    question: {
                        text: qText,
                        questionType: VALID_TYPES.includes(qType) ? qType : 'SHORT_TEXT',
                        options: [],
                    },
                    isMandatory: String(row.mandatory || row.required || '').toLowerCase() === 'true' || row.mandatory === true || row.mandatory === 1,
                    promoteToRfp: String(row.promoteToRfp || row.promote_to_rfp || '').toLowerCase() === 'true' || row.promoteToRfp === true,
                });
            }
        }

        const created = [];
        const errors = [];

        for (const [templateName, tplData] of templateMap.entries()) {
            try {
                const sections = Array.from(tplData.sections.entries()).map(([sectionTitle, questions], si) => ({
                    title: sectionTitle,
                    orderIndex: si,
                    questions: questions.map((q, qi) => ({ ...q, orderIndex: qi })),
                }));

                const result = await RFITemplateService.createTemplate({
                    name: templateName,
                    category: tplData.category,
                    sections,
                }, user);

                created.push({ templateId: result.templateId, name: templateName, sections: sections.length, questions: sections.reduce((a, s) => a + s.questions.length, 0) });
            } catch (err) {
                errors.push({ name: templateName, error: err.message });
            }
        }

        return { created, errors };
    }

    static async archiveTemplate(templateId, user) {
        const current = await RFITemplateService.getTemplateById(templateId);
        if (!current) throw new Error('Template not found');
        if (!VALID_TRANSITIONS[current.status] || !VALID_TRANSITIONS[current.status].includes('ARCHIVED')) {
            throw new Error(`Cannot archive template in status ${current.status}`);
        }

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_template SET status = 'ARCHIVED', updated_date = CURRENT_TIMESTAMP WHERE template_id = ?`,
                [templateId],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfi_template WHERE template_id = ?`, [templateId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFITemplateService._normalize(row));
                    });
                }
            );
        });
    }

    static async createNewVersion(templateId, user) {
        const original = await RFITemplateService.getTemplateById(templateId);
        if (!original) throw new Error('Template not found');

        const newTemplateId = randomUUID();
        // Find the highest existing version for templates with this name (for this buyer)
        // so that cloning always produces a uniquely-incremented version number.
        const buyerId = original.buyerId || null;
        const maxVersionRow = await new Promise((resolve) => {
            const sql = buyerId
                ? `SELECT MAX(version) as max_v FROM rfi_template WHERE template_name = ? AND buyer_id = ?`
                : `SELECT MAX(version) as max_v FROM rfi_template WHERE template_name = ? AND buyer_id IS NULL`;
            const params = buyerId ? [original.templateName, buyerId] : [original.templateName];
            db.get(sql, params, (err, row) => resolve(row || null));
        });
        const newVersion = ((maxVersionRow && maxVersionRow.max_v) ? parseInt(maxVersionRow.max_v) : (original.version || 1)) + 1;

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfi_template (template_id, template_name, category, subcategory, version, status, created_by, buyer_id, applicable_regions, regulatory_overlays, created_date, updated_date)
                 VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [newTemplateId, original.templateName, original.category, original.subcategory,
                 newVersion, user.userId, user.buyerId || null,
                 original.applicableRegions || null,
                 original.regulatoryOverlays || null],
                async function(err) {
                    if (err) return reject(err);

                    // Clone sections and questions
                    try {
                        for (const section of (original.sections || [])) {
                            const newSectionId = randomUUID();
                            await new Promise((res, rej) => {
                                db.run(
                                    `INSERT INTO template_section (section_id, template_id, section_name, section_description, display_order, is_mandatory) VALUES (?, ?, ?, ?, ?, ?)`,
                                    [newSectionId, newTemplateId, section.sectionName, section.sectionDescription, section.displayOrder, section.isMandatory],
                                    (e) => e ? rej(e) : res()
                                );
                            });
                            for (const question of (section.questions || [])) {
                                await new Promise((res, rej) => {
                                    db.run(
                                        `INSERT INTO template_question (question_id, section_id, template_id, question_text, question_type, mandatory, promote_to_rfp, options, validation_rules, display_order)
                                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                        [randomUUID(), newSectionId, newTemplateId, question.questionText,
                                         question.questionType, question.mandatory, question.promoteToRfp,
                                         question.options ? JSON.stringify(question.options) : null,
                                         question.validationRules ? JSON.stringify(question.validationRules) : null,
                                         question.displayOrder],
                                        (e) => e ? rej(e) : res()
                                    );
                                });
                            }
                        }
                        const newTemplate = await RFITemplateService.getTemplateById(newTemplateId);
                        resolve(newTemplate);
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    static async addSection(templateId, data) {
        const template = await RFITemplateService.getTemplateById(templateId);
        if (!template) throw new Error('Template not found');
        if (template.status !== 'DRAFT') throw new Error('Only DRAFT templates can be modified');

        const sectionId = randomUUID();
        const { sectionName, sectionDescription, displayOrder, isMandatory } = data;
        if (!sectionName) throw new Error('sectionName is required');

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO template_section (section_id, template_id, section_name, section_description, display_order, is_mandatory) VALUES (?, ?, ?, ?, ?, ?)`,
                [sectionId, templateId, sectionName, sectionDescription || null, displayOrder || 0, isMandatory !== false],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM template_section WHERE section_id = ?`, [sectionId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFITemplateService._normalizeSection(row));
                    });
                }
            );
        });
    }

    static async addQuestion(templateId, sectionId, data) {
        const template = await RFITemplateService.getTemplateById(templateId);
        if (!template) throw new Error('Template not found');
        if (template.status !== 'DRAFT') throw new Error('Only DRAFT templates can be modified');

        const validTypes = ['SHORT_TEXT','LONG_TEXT','YES_NO','SINGLE_SELECT','MULTI_SELECT','NUMERIC','ATTACHMENT','TABLE'];
        if (!validTypes.includes(data.questionType)) throw new Error(`Invalid questionType: ${data.questionType}`);

        const questionId = randomUUID();
        const { questionText, text, questionType, mandatory, promoteToRfp, options, validationRules, displayOrder } = data;
        const finalQuestionText = questionText || text || '';

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO template_question (question_id, section_id, template_id, question_text, question_type, mandatory, promote_to_rfp, options, validation_rules, display_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [questionId, sectionId || null, templateId, finalQuestionText, questionType,
                 mandatory || false, promoteToRfp || false,
                 options ? JSON.stringify(options) : null,
                 validationRules ? JSON.stringify(validationRules) : null,
                 displayOrder || 0],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM template_question WHERE question_id = ?`, [questionId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFITemplateService._normalizeQuestion(row));
                    });
                }
            );
        });
    }

    // ---- Normalization helpers ----

    static _normalize(row) {
        if (!row) return null;
        return {
            templateId: row.template_id,
            templateName: row.template_name,
            name: row.template_name, // Frontend alias
            category: row.category,
            subcategory: row.subcategory,
            version: row.version,
            status: row.status,
            createdBy: row.created_by,
            buyerId: row.buyer_id,
            applicableRegions: row.applicable_regions,
            regions: row.applicable_regions, // Frontend alias
            regulatoryOverlays: row.regulatory_overlays,
            createdDate: row.created_date,
            createdAt: row.created_date, // Frontend alias
            updatedDate: row.updated_date,
            updatedAt: row.updated_date, // Frontend alias
            sections: row.section_count ? new Array(parseInt(row.section_count)).fill({}) : [], // Mock array for length checks in lists
            sectionCount: row.section_count !== undefined ? parseInt(row.section_count) : undefined,
            questionCount: row.question_count !== undefined ? parseInt(row.question_count) : undefined
        };
    }

    static _normalizeSection(row) {
        if (!row) return null;
        return {
            sectionId: row.section_id,
            templateId: row.template_id,
            sectionName: row.section_name,
            title: row.section_name, // Frontend alias
            sectionDescription: row.section_description,
            description: row.section_description, // Frontend alias
            displayOrder: row.display_order,
            orderIndex: row.display_order, // Frontend alias
            isMandatory: row.is_mandatory === true || row.is_mandatory === 1
        };
    }

    static _normalizeQuestion(row) {
        if (!row) return null;
        // Use resolved_text / resolved_type from the LEFT JOIN if available,
        // otherwise fall back to the stored snapshot on the template_question row itself.
        const finalText = row.resolved_text || row.question_text || '';
        const finalType = row.resolved_type || row.question_type || 'SHORT_TEXT';
        return {
            questionId: row.question_id,     // PK of this template_question row
            libraryQuestionId: row.library_question_id || row.lib_question_id || null, // FK → rfi_question_library
            fromLibrary: !!(row.library_question_id || row.lib_question_id), // convenience flag
            sectionId: row.section_id,
            templateId: row.template_id,
            questionText: finalText,
            text: finalText,                 // Frontend alias
            questionType: finalType,
            mandatory: row.mandatory === true || row.mandatory === 1,
            isMandatory: row.mandatory === true || row.mandatory === 1, // Frontend alias
            promoteToRfp: row.promote_to_rfp === true || row.promote_to_rfp === 1,
            options: row.options ? (typeof row.options === 'string' ? JSON.parse(row.options) : row.options) : [],
            validationRules: row.validation_rules ? (typeof row.validation_rules === 'string' ? JSON.parse(row.validation_rules) : row.validation_rules) : {},
            displayOrder: row.display_order,
            orderIndex: row.display_order    // Frontend alias
        };
    }
}

module.exports = RFITemplateService;

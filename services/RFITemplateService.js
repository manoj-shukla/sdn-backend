const db = require('../config/database');
const { randomUUID } = require('crypto');

const VALID_TRANSITIONS = {
    DRAFT: ['PUBLISHED'],
    PUBLISHED: ['ARCHIVED'],
    ARCHIVED: []
};

class RFITemplateService {

    static async createTemplate(data, user) {
        const { templateName, name, category, subcategory, applicableRegions, regions, regulatoryOverlays, sections } = data;
        const finalName = templateName || name;
        if (!finalName) throw new Error('templateName is required');
        const finalRegions = applicableRegions || regions;

        const templateId = randomUUID();
        const buyerId = user.buyerId || null;
        const createdBy = user.userId;

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfi_template (template_id, template_name, category, subcategory, version, status, created_by, buyer_id, applicable_regions, regulatory_overlays, created_date, updated_date)
                 VALUES (?, ?, ?, ?, 1, 'DRAFT', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [templateId, finalName, category || null, subcategory || null, createdBy, buyerId,
                 finalRegions || null,
                 regulatoryOverlays || null],
                function(err) {
                    if (err) return reject(err);
                    
                    // Handle nested sections and questions
                    (async () => {
                        try {
                            if (sections && Array.isArray(sections)) {
                                for (const s of sections) {
                                    const sectionId = randomUUID();
                                    await new Promise((res, rej) => {
                                        db.run(
                                            `INSERT INTO template_section (section_id, template_id, section_name, section_description, display_order, is_mandatory) VALUES (?, ?, ?, ?, ?, ?)`,
                                            [sectionId, templateId, s.sectionName || s.title, s.sectionDescription || s.description || null, s.displayOrder || s.orderIndex || 0, s.isMandatory !== false],
                                            (e) => e ? rej(e) : res()
                                        );
                                    });
                                    if (s.questions && Array.isArray(s.questions)) {
                                        for (const q of s.questions) {
                                            const questionData = q.question || q;
                                            await new Promise((res, rej) => {
                                                db.run(
                                                    `INSERT INTO template_question (question_id, section_id, template_id, question_text, question_type, mandatory, promote_to_rfp, options, validation_rules, display_order)
                                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                                    [randomUUID(), sectionId, templateId, questionData.questionText || questionData.text, questionData.questionType,
                                                     q.mandatory || q.isMandatory || false, q.promoteToRfp || false,
                                                     questionData.options ? JSON.stringify(questionData.options) : null,
                                                     questionData.validationRules ? JSON.stringify(questionData.validationRules) : null,
                                                     q.displayOrder || q.orderIndex || 0],
                                                    (e) => e ? rej(e) : res()
                                                );
                                            });
                                        }
                                    }
                                }
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
            let query = `SELECT t.*, (SELECT COUNT(*) FROM template_section s WHERE s.template_id = t.template_id) as section_count FROM rfi_template t WHERE 1=1`;
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

        // Fetch questions for each section
        for (const section of sections) {
            section.questions = await new Promise((resolve, reject) => {
                db.all(`SELECT * FROM template_question WHERE section_id = ? ORDER BY display_order ASC`, [section.sectionId], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows.map(RFITemplateService._normalizeQuestion));
                });
            });
        }

        template.sections = sections;
        return template;
    }

    static async updateTemplate(templateId, data, user) {
        const current = await RFITemplateService.getTemplateById(templateId);
        if (!current) throw new Error('Template not found');
        if (current.status !== 'DRAFT') throw new Error('Only DRAFT templates can be edited');
        const { templateName, name, category, subcategory, applicableRegions, regions, regulatoryOverlays } = data;
        const finalName = templateName || name || current.templateName;
        const finalRegions = applicableRegions || regions || current.applicableRegions;

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_template SET template_name = ?, category = ?, subcategory = ?,
                 applicable_regions = ?, regulatory_overlays = ?, updated_date = CURRENT_TIMESTAMP
                 WHERE template_id = ?`,
                [finalName, category || current.category,
                 subcategory || current.subcategory,
                 finalRegions || null,
                 regulatoryOverlays || null,
                 templateId],
                function(err) {
                    if (err) return reject(err);

                    // For DRAFT templates, we replace sections/questions if provided
                    (async () => {
                        try {
                            const { sections } = data;
                            if (sections && Array.isArray(sections)) {
                                // Delete existing sections (which cascades to questions based on schema, 
                                // though schema in database.js didn't explicitly show CASCADE, 
                                // we should delete them manually to be safe)
                                await new Promise((res, rej) => db.run(`DELETE FROM template_question WHERE template_id = ?`, [templateId], (e) => e ? rej(e) : res()));
                                await new Promise((res, rej) => db.run(`DELETE FROM template_section WHERE template_id = ?`, [templateId], (e) => e ? rej(e) : res()));

                                for (const s of sections) {
                                    const sectionId = randomUUID();
                                    await new Promise((res, rej) => {
                                        db.run(
                                            `INSERT INTO template_section (section_id, template_id, section_name, section_description, display_order, is_mandatory) VALUES (?, ?, ?, ?, ?, ?)`,
                                            [sectionId, templateId, s.sectionName || s.title, s.sectionDescription || s.description || null, s.displayOrder || s.orderIndex || 0, s.isMandatory !== false],
                                            (e) => e ? rej(e) : res()
                                        );
                                    });
                                    if (s.questions && Array.isArray(s.questions)) {
                                        for (const q of s.questions) {
                                            const questionData = q.question || q;
                                            await new Promise((res, rej) => {
                                                db.run(
                                                    `INSERT INTO template_question (question_id, section_id, template_id, question_text, question_type, mandatory, promote_to_rfp, options, validation_rules, display_order)
                                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                                    [randomUUID(), sectionId, templateId, questionData.questionText || questionData.text, questionData.questionType,
                                                     q.mandatory || q.isMandatory || false, q.promoteToRfp || false,
                                                     questionData.options ? JSON.stringify(questionData.options) : null,
                                                     questionData.validationRules ? JSON.stringify(questionData.validationRules) : null,
                                                     q.displayOrder || q.orderIndex || 0],
                                                    (e) => e ? rej(e) : res()
                                                );
                                            });
                                        }
                                    }
                                }
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
        const newVersion = (original.version || 1) + 1;

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
            sectionCount: row.section_count !== undefined ? parseInt(row.section_count) : undefined
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
        return {
            questionId: row.question_id,
            sectionId: row.section_id,
            templateId: row.template_id,
            questionText: row.question_text,
            text: row.question_text, // Frontend alias
            questionType: row.question_type,
            mandatory: row.mandatory === true || row.mandatory === 1,
            isMandatory: row.mandatory === true || row.mandatory === 1, // Frontend alias
            promoteToRfp: row.promote_to_rfp === true || row.promote_to_rfp === 1,
            options: row.options ? (typeof row.options === 'string' ? JSON.parse(row.options) : row.options) : [],
            validationRules: row.validation_rules ? (typeof row.validation_rules === 'string' ? JSON.parse(row.validation_rules) : row.validation_rules) : {},
            displayOrder: row.display_order,
            orderIndex: row.display_order // Frontend alias
        };
    }
}

module.exports = RFITemplateService;

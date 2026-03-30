const db = require('../config/database');
const { randomUUID } = require('crypto');

class RFIQuestionLibraryService {

    static async addQuestion(data, user) {
        // Accept camelCase, snake_case, and short field names from frontend
        const questionText = data.questionText || data.question_text || data.text || data.name || data.title || data.content;
        const questionType = data.questionType || data.question_type || data.type || data.kind;
        const category = data.category || data.category_tags;
        const capabilityTags = data.capabilityTags !== undefined ? data.capabilityTags : data.capability_tags;
        const complianceTags = data.complianceTags !== undefined ? data.complianceTags : data.compliance_tags;
        const mandatory = data.mandatory !== undefined ? data.mandatory : (data.isMandatory !== undefined ? data.isMandatory : false);
        const promoteToRfp = data.promoteToRfp !== undefined ? data.promoteToRfp : (data.promote_to_rfp !== undefined ? data.promote_to_rfp : false);
        const helpText = data.helpText || data.help_text;
        const options = data.options || [];

        if (!questionText) {
            console.error('[RFIQuestionLibrary] Missing questionText. Received data:', JSON.stringify(data));
            throw new Error(`questionText is required (received fields: ${Object.keys(data || {}).join(', ') || 'none'})`);
        }
        if (!questionType) throw new Error(`questionType is required (received fields: ${Object.keys(data || {}).join(', ') || 'none'})`);

        const validTypes = ['SHORT_TEXT','LONG_TEXT','YES_NO','SINGLE_SELECT','MULTI_SELECT','NUMERIC','ATTACHMENT','TABLE'];
        if (!validTypes.includes(questionType)) throw new Error(`Invalid questionType: ${questionType}`);

        const questionId = randomUUID();

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfi_question_library (
                    question_id, question_text, question_type, category_tags, 
                    capability_tags, compliance_tags, created_by, is_deleted, 
                    created_at, mandatory, promote_to_rfp, help_text, options, category
                )
                 VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)`,
                [
                    questionId, questionText, questionType,
                    Array.isArray(category) ? category : (category ? [category] : null),
                    Array.isArray(capabilityTags) ? capabilityTags : (capabilityTags ? [capabilityTags] : null),
                    Array.isArray(complianceTags) ? complianceTags : (complianceTags ? [complianceTags] : null),
                    user ? (user.userId || user.userid) : null,
                    mandatory, promoteToRfp, helpText || null, 
                    options ? JSON.stringify(options) : null,
                    Array.isArray(category) ? category[0] : category
                ],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfi_question_library WHERE question_id = ?`, [questionId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFIQuestionLibraryService._normalize(row));
                    });
                }
            );
        });
    }

    static async listQuestions(filters) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT q.*, u.role as creator_role, u.username as creator_username
                FROM rfi_question_library q
                LEFT JOIN users u ON q.created_by = u.userId
                WHERE q.is_deleted = FALSE
            `;
            const params = [];

            if (filters && filters.category) {
                query += ` AND (q.category ILIKE ? OR q.category_tags::text ILIKE ?)`;
                params.push(`%${filters.category}%`);
                params.push(`%${filters.category}%`);
            }
            if (filters && filters.capability) {
                query += ` AND q.capability_tags::text ILIKE ?`;
                params.push(`%${filters.capability}%`);
            }
            if (filters && filters.compliance) {
                query += ` AND q.compliance_tags::text ILIKE ?`;
                params.push(`%${filters.compliance}%`);
            }
            if (filters && filters.questionType) {
                query += ` AND q.question_type = ?`;
                params.push(filters.questionType);
            }

            query += ` ORDER BY q.created_at DESC`;

            db.all(query, params, (err, rows) => {
                if (err) return reject(err);
                resolve((rows || []).map(RFIQuestionLibraryService._normalize));
            });
        });
    }

    static async getQuestionById(questionId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT q.*, u.role as creator_role, u.username as creator_username
                FROM rfi_question_library q
                LEFT JOIN users u ON q.created_by = u.userId
                WHERE q.question_id = ? AND q.is_deleted = FALSE
            `;
            db.get(query, [questionId], (err, row) => {
                if (err) return reject(err);
                resolve(RFIQuestionLibraryService._normalize(row));
            });
        });
    }

    static async updateQuestion(questionId, data, user) {
        const current = await RFIQuestionLibraryService.getQuestionById(questionId);
        if (!current) throw new Error('Question not found');

        // RBAC: If question was created by ADMIN, only another ADMIN can edit it.
        const isCreatedByAdmin = (current.creatorRole || current.creator_role) === 'ADMIN';
        const isCurrentUserBuyer = (user.role || '').toUpperCase() === 'BUYER';
        if (isCreatedByAdmin && isCurrentUserBuyer) {
            throw new Error('Forbidden: Questions created by Super Admin cannot be edited by Buyers.');
        }

        // Accept camelCase, snake_case, and short field names from frontend
        const questionText = data.questionText || data.question_text || data.text || data.name || data.title || data.content;
        const questionType = data.questionType || data.question_type || data.type || data.kind;
        const category = data.category || data.category_tags;
        const capabilityTags = data.capabilityTags !== undefined ? data.capabilityTags : data.capability_tags;
        const complianceTags = data.complianceTags !== undefined ? data.complianceTags : data.compliance_tags;
        const mandatory = data.mandatory !== undefined ? data.mandatory : (data.isMandatory !== undefined ? data.isMandatory : current.mandatory);
        const promoteToRfp = data.promoteToRfp !== undefined ? data.promoteToRfp : (data.promote_to_rfp !== undefined ? data.promote_to_rfp : current.promoteToRfp);
        const helpText = data.helpText || data.help_text;
        const options = data.options;

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_question_library SET 
                    question_text = ?, question_type = ?, category_tags = ?, 
                    capability_tags = ?, compliance_tags = ?, mandatory = ?, 
                    promote_to_rfp = ?, help_text = ?, options = ?, category = ?
                 WHERE question_id = ? AND is_deleted = FALSE`,
                [
                    questionText || current.questionText, 
                    questionType || current.questionType,
                    category !== undefined ? (Array.isArray(category) ? category : (category ? [category] : null)) : current.categoryTags,
                    capabilityTags !== undefined ? (Array.isArray(capabilityTags) ? capabilityTags : (capabilityTags ? [capabilityTags] : null)) : current.capabilityTags,
                    complianceTags !== undefined ? (Array.isArray(complianceTags) ? complianceTags : (complianceTags ? [complianceTags] : null)) : current.complianceTags,
                    mandatory !== undefined ? mandatory : current.mandatory,
                    promoteToRfp !== undefined ? promoteToRfp : current.promoteToRfp,
                    helpText !== undefined ? helpText : current.helpText,
                    options !== undefined ? JSON.stringify(options) : (current.options ? JSON.stringify(current.options) : null),
                    category !== undefined ? (Array.isArray(category) ? category[0] : category) : current.category,
                    questionId
                ],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfi_question_library WHERE question_id = ?`, [questionId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFIQuestionLibraryService._normalize(row));
                    });
                }
            );
        });
    }

    static async deleteQuestion(questionId, user) {
        const current = await RFIQuestionLibraryService.getQuestionById(questionId);
        if (!current) throw new Error('Question not found');

        // RBAC: If question was created by ADMIN, only another ADMIN can delete it.
        const isCreatedByAdmin = (current.creatorRole || current.creator_role) === 'ADMIN';
        const isCurrentUserBuyer = (user.role || '').toUpperCase() === 'BUYER';
        if (isCreatedByAdmin && isCurrentUserBuyer) {
            throw new Error('Forbidden: Questions created by Super Admin cannot be deleted by Buyers.');
        }

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE rfi_question_library SET is_deleted = TRUE WHERE question_id = ?`,
                [questionId],
                function(err) {
                    if (err) return reject(err);
                    resolve({ deleted: true, questionId });
                }
            );
        });
    }

    static _normalize(row) {
        if (!row) return null;
        return {
            // camelCase (API standard)
            questionId: row.question_id,
            questionText: row.question_text,
            text: row.question_text, // Frontend alias
            questionType: row.question_type,
            categoryTags: row.category_tags,
            category: row.category || (row.category_tags ? row.category_tags[0] : ""), // Alias
            capabilityTags: row.capability_tags,
            complianceTags: row.compliance_tags,
            mandatory: row.mandatory === true || row.mandatory === 1,
            isMandatory: row.mandatory === true || row.mandatory === 1, // Alias
            promoteToRfp: row.promote_to_rfp === true || row.promote_to_rfp === 1,
            helpText: row.help_text,
            options: row.options ? (typeof row.options === 'string' ? JSON.parse(row.options) : row.options) : [],
            createdBy: row.created_by,
            isDeleted: row.is_deleted,
            createdAt: row.created_at,
            creatorRole: row.creator_role,
            creatorUsername: row.creator_username,
            // snake_case aliases (for frontend compatibility)
            question_id: row.question_id,
            question_text: row.question_text,
            question: row.question_text,
            question_type: row.question_type,
            type: row.question_type,
            category_tags: row.category_tags,
            capability_tags: row.capability_tags,
            compliance_tags: row.compliance_tags,
            created_by: row.created_by,
            is_deleted: row.is_deleted,
            created_at: row.created_at,
            creator_role: row.creator_role,
            creator_username: row.creator_username
        };
    }
}

module.exports = RFIQuestionLibraryService;

const db = require('../config/database');
const { randomUUID } = require('crypto');

const OPERATORS = ['EQUALS','NOT_EQUALS','CONTAINS','IN','NOT_IN','GT','LT'];

class RFIRuleEngineService {

    static async createRule(templateId, data) {
        const { conditionField, conditionOperator, conditionValue, actionType, targetQuestionId } = data;

        if (!conditionField) throw new Error('conditionField is required');
        if (!OPERATORS.includes(conditionOperator)) throw new Error(`Invalid conditionOperator: ${conditionOperator}`);
        if (!['SHOW','HIDE'].includes(actionType)) throw new Error('actionType must be SHOW or HIDE');

        const ruleId = randomUUID();

        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO rfi_rule_engine (rule_id, template_id, condition_field, condition_operator, condition_value, action_type, target_question_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [ruleId, templateId, conditionField, conditionOperator, conditionValue, actionType, targetQuestionId || null],
                function(err) {
                    if (err) return reject(err);
                    db.get(`SELECT * FROM rfi_rule_engine WHERE rule_id = ?`, [ruleId], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve(RFIRuleEngineService._normalize(row));
                    });
                }
            );
        });
    }

    static async getRulesForTemplate(templateId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM rfi_rule_engine WHERE template_id = ?`, [templateId], (err, rows) => {
                if (err) return reject(err);
                resolve((rows || []).map(RFIRuleEngineService._normalize));
            });
        });
    }

    /**
     * Evaluate rules for a given supplier context and return the set of visible question IDs.
     * Rules can SHOW or HIDE questions. Default: all questions are visible unless a HIDE rule fires.
     * @param {string} rfiId - The RFI event ID
     * @param {object} supplierContext - { country, crossBorder, supplierId, ...answers }
     */
    static async evaluateRules(rfiId, supplierContext) {
        return new Promise((resolve, reject) => {
            // Get template for this RFI
            db.get(`SELECT template_id FROM rfi_event WHERE rfi_id = ?`, [rfiId], (err, event) => {
                if (err) return reject(err);
                if (!event) return reject(new Error('RFI event not found'));

                const templateId = event.template_id;

                db.all(`SELECT * FROM template_question WHERE template_id = ?`, [templateId], (err2, questions) => {
                    if (err2) return reject(err2);

                    db.all(`SELECT * FROM rfi_rule_engine WHERE template_id = ?`, [templateId], (err3, rules) => {
                        if (err3) return reject(err3);

                        const allQuestionIds = new Set((questions || []).map(q => q.question_id));
                        const hiddenIds = new Set();
                        const shownIds = new Set();

                        for (const rule of (rules || [])) {
                            const conditionMet = RFIRuleEngineService._evaluateCondition(
                                rule.condition_field,
                                rule.condition_operator,
                                rule.condition_value,
                                supplierContext
                            );
                            if (conditionMet) {
                                if (rule.action_type === 'HIDE' && rule.target_question_id) {
                                    hiddenIds.add(rule.target_question_id);
                                } else if (rule.action_type === 'SHOW' && rule.target_question_id) {
                                    shownIds.add(rule.target_question_id);
                                }
                            }
                        }

                        // Determine visible questions: default visible, minus hidden, union explicitly shown
                        const visibleQuestionIds = [];
                        for (const qId of allQuestionIds) {
                            if (!hiddenIds.has(qId) || shownIds.has(qId)) {
                                visibleQuestionIds.push(qId);
                            }
                        }

                        // Also inject regulatory overlay questions
                        const RFIRegulatoryOverlayService = require('./RFIRegulatoryOverlayService');
                        const overlayQuestions = RFIRegulatoryOverlayService.getOverlayQuestions(supplierContext);

                        resolve({
                            visibleQuestionIds,
                            overlayQuestions,
                            totalQuestions: allQuestionIds.size,
                            hiddenCount: hiddenIds.size
                        });
                    });
                });
            });
        });
    }

    /**
     * Detect circular logic in a template's rules.
     * A circular dependency occurs when rules form a cycle: A shows B, B shows A.
     * Returns true if circular logic exists.
     */
    static async detectCircularLogic(templateId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM rfi_rule_engine WHERE template_id = ?`, [templateId], (err, rules) => {
                if (err) return reject(err);
                if (!rules || rules.length === 0) return resolve(false);

                // Build a dependency graph: rule's target question points to other rules
                // For simplicity: check if any rule's condition_field references another rule's target
                // This is a simplified cycle detection using DFS
                const graph = {};
                for (const rule of rules) {
                    if (!graph[rule.condition_field]) graph[rule.condition_field] = [];
                    if (rule.target_question_id) {
                        graph[rule.condition_field].push(rule.target_question_id);
                    }
                }

                const visited = new Set();
                const inStack = new Set();

                const hasCycle = (node) => {
                    if (inStack.has(node)) return true;
                    if (visited.has(node)) return false;

                    visited.add(node);
                    inStack.add(node);

                    for (const neighbor of (graph[node] || [])) {
                        if (hasCycle(neighbor)) return true;
                    }

                    inStack.delete(node);
                    return false;
                };

                for (const node of Object.keys(graph)) {
                    if (hasCycle(node)) return resolve(true);
                }

                resolve(false);
            });
        });
    }

    static _evaluateCondition(field, operator, conditionValue, context) {
        const contextValue = context[field];
        if (contextValue === undefined || contextValue === null) return false;

        const ctxStr = String(contextValue).toLowerCase();
        const condStr = String(conditionValue).toLowerCase();

        switch (operator) {
            case 'EQUALS':
                return ctxStr === condStr;
            case 'NOT_EQUALS':
                return ctxStr !== condStr;
            case 'CONTAINS':
                return ctxStr.includes(condStr);
            case 'IN':
                return condStr.split(',').map(s => s.trim()).includes(ctxStr);
            case 'NOT_IN':
                return !condStr.split(',').map(s => s.trim()).includes(ctxStr);
            case 'GT':
                return parseFloat(contextValue) > parseFloat(conditionValue);
            case 'LT':
                return parseFloat(contextValue) < parseFloat(conditionValue);
            default:
                return false;
        }
    }

    static _normalize(row) {
        if (!row) return null;
        return {
            ruleId: row.rule_id,
            templateId: row.template_id,
            conditionField: row.condition_field,
            conditionOperator: row.condition_operator,
            conditionValue: row.condition_value,
            actionType: row.action_type,
            targetQuestionId: row.target_question_id
        };
    }
}

module.exports = RFIRuleEngineService;

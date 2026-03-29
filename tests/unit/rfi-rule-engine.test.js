/**
 * Unit Tests - RFIRuleEngineService
 * Tests condition evaluation, circular logic detection, India overlay trigger
 */

jest.mock('../../config/database', () => ({
    run: jest.fn(),
    get: jest.fn(),
    all: jest.fn()
}));
jest.mock('../../services/RFIRegulatoryOverlayService', () => ({
    getOverlayQuestions: jest.fn()
}));

const db = require('../../config/database');
const RFIRegulatoryOverlayService = require('../../services/RFIRegulatoryOverlayService');
const RFIRuleEngineService = require('../../services/RFIRuleEngineService');

beforeEach(() => {
    jest.resetAllMocks();
    RFIRegulatoryOverlayService.getOverlayQuestions.mockReturnValue([]);
});

describe('RFIRuleEngineService', () => {

    describe('_evaluateCondition', () => {
        test('EQUALS: should match equal string values (case-insensitive)', () => {
            expect(RFIRuleEngineService._evaluateCondition('country', 'EQUALS', 'India', { country: 'india' })).toBe(true);
            expect(RFIRuleEngineService._evaluateCondition('country', 'EQUALS', 'India', { country: 'US' })).toBe(false);
        });

        test('NOT_EQUALS: should match when values differ', () => {
            expect(RFIRuleEngineService._evaluateCondition('country', 'NOT_EQUALS', 'India', { country: 'US' })).toBe(true);
            expect(RFIRuleEngineService._evaluateCondition('country', 'NOT_EQUALS', 'India', { country: 'india' })).toBe(false);
        });

        test('CONTAINS: should match substring', () => {
            expect(RFIRuleEngineService._evaluateCondition('businessType', 'CONTAINS', 'tech', { businessType: 'Technology' })).toBe(true);
            expect(RFIRuleEngineService._evaluateCondition('businessType', 'CONTAINS', 'finance', { businessType: 'Technology' })).toBe(false);
        });

        test('IN: should match if value in list', () => {
            expect(RFIRuleEngineService._evaluateCondition('country', 'IN', 'India,US,UK', { country: 'india' })).toBe(true);
            expect(RFIRuleEngineService._evaluateCondition('country', 'IN', 'India,US,UK', { country: 'china' })).toBe(false);
        });

        test('NOT_IN: should match if value NOT in list', () => {
            expect(RFIRuleEngineService._evaluateCondition('country', 'NOT_IN', 'India,US', { country: 'china' })).toBe(true);
            expect(RFIRuleEngineService._evaluateCondition('country', 'NOT_IN', 'India,US', { country: 'india' })).toBe(false);
        });

        test('GT/LT: should compare numeric values', () => {
            expect(RFIRuleEngineService._evaluateCondition('revenue', 'GT', '1000000', { revenue: '5000000' })).toBe(true);
            expect(RFIRuleEngineService._evaluateCondition('revenue', 'LT', '1000000', { revenue: '500000' })).toBe(true);
            expect(RFIRuleEngineService._evaluateCondition('revenue', 'GT', '1000000', { revenue: '500' })).toBe(false);
        });

        test('should return false for undefined context values', () => {
            expect(RFIRuleEngineService._evaluateCondition('country', 'EQUALS', 'India', {})).toBe(false);
        });
    });

    describe('evaluateRules', () => {
        test('should return visible question IDs with HIDE rules applied', async () => {
            const mockEvent = { rfi_id: 'rfi-1', template_id: 'tpl-1' };
            const mockQuestions = [
                { question_id: 'q-1' },
                { question_id: 'q-2' },
                { question_id: 'q-3' }
            ];
            const mockRules = [
                {
                    rule_id: 'r-1',
                    template_id: 'tpl-1',
                    condition_field: 'country',
                    condition_operator: 'NOT_EQUALS',
                    condition_value: 'India',
                    action_type: 'HIDE',
                    target_question_id: 'q-2'
                }
            ];

            db.get.mockImplementation((sql, params, cb) => cb(null, mockEvent));
            db.all
                .mockImplementationOnce((sql, params, cb) => cb(null, mockQuestions))
                .mockImplementationOnce((sql, params, cb) => cb(null, mockRules));

            const result = await RFIRuleEngineService.evaluateRules('rfi-1', { country: 'US' });

            // q-2 should be hidden because country !== India
            expect(result.visibleQuestionIds).toContain('q-1');
            expect(result.visibleQuestionIds).toContain('q-3');
            expect(result.visibleQuestionIds).not.toContain('q-2');
            expect(result.hiddenCount).toBe(1);
        });

        test('should inject overlay questions for India supplier', async () => {
            const mockEvent = { rfi_id: 'rfi-1', template_id: 'tpl-1' };
            const mockOverlayQs = [{ questionId: 'overlay_gstin', questionText: 'GSTIN' }];

            db.get.mockImplementation((sql, params, cb) => cb(null, mockEvent));
            db.all
                .mockImplementationOnce((sql, params, cb) => cb(null, []))
                .mockImplementationOnce((sql, params, cb) => cb(null, []));
            RFIRegulatoryOverlayService.getOverlayQuestions.mockReturnValue(mockOverlayQs);

            const result = await RFIRuleEngineService.evaluateRules('rfi-1', { country: 'India' });

            expect(RFIRegulatoryOverlayService.getOverlayQuestions).toHaveBeenCalledWith({ country: 'India' });
            expect(result.overlayQuestions).toHaveLength(1);
            expect(result.overlayQuestions[0].questionId).toBe('overlay_gstin');
        });

        test('should reject when RFI event not found', async () => {
            db.get.mockImplementation((sql, params, cb) => cb(null, null));
            await expect(RFIRuleEngineService.evaluateRules('bad-id', {}))
                .rejects.toThrow('RFI event not found');
        });
    });

    describe('detectCircularLogic', () => {
        test('should return false when no rules exist', async () => {
            db.all.mockImplementation((sql, params, cb) => cb(null, []));
            const result = await RFIRuleEngineService.detectCircularLogic('tpl-1');
            expect(result).toBe(false);
        });

        test('should return false for non-circular rules', async () => {
            const rules = [
                { condition_field: 'country', target_question_id: 'q-1' },
                { condition_field: 'revenue', target_question_id: 'q-2' }
            ];
            db.all.mockImplementation((sql, params, cb) => cb(null, rules));
            const result = await RFIRuleEngineService.detectCircularLogic('tpl-1');
            expect(result).toBe(false);
        });

        test('should detect simple circular dependency', async () => {
            // A -> B, B -> A creates a cycle
            const rules = [
                { condition_field: 'field-A', target_question_id: 'field-B' },
                { condition_field: 'field-B', target_question_id: 'field-A' }
            ];
            db.all.mockImplementation((sql, params, cb) => cb(null, rules));
            const result = await RFIRuleEngineService.detectCircularLogic('tpl-1');
            expect(result).toBe(true);
        });
    });

    describe('createRule', () => {
        test('should create a valid rule', async () => {
            const mockRuleRow = {
                rule_id: 'rule-uuid', template_id: 'tpl-1',
                condition_field: 'country', condition_operator: 'EQUALS',
                condition_value: 'India', action_type: 'SHOW', target_question_id: 'q-1'
            };
            db.run.mockImplementation((sql, params, cb) => cb.call({ lastID: 'rule-uuid' }, null));
            db.get.mockImplementation((sql, params, cb) => cb(null, mockRuleRow));

            const result = await RFIRuleEngineService.createRule('tpl-1', {
                conditionField: 'country',
                conditionOperator: 'EQUALS',
                conditionValue: 'India',
                actionType: 'SHOW',
                targetQuestionId: 'q-1'
            });

            expect(result.ruleId).toBe('rule-uuid');
            expect(result.actionType).toBe('SHOW');
        });

        test('should reject invalid condition operator', async () => {
            await expect(RFIRuleEngineService.createRule('tpl-1', {
                conditionField: 'country',
                conditionOperator: 'INVALID_OP',
                conditionValue: 'India',
                actionType: 'SHOW'
            })).rejects.toThrow('Invalid conditionOperator');
        });

        test('should reject invalid action type', async () => {
            await expect(RFIRuleEngineService.createRule('tpl-1', {
                conditionField: 'country',
                conditionOperator: 'EQUALS',
                conditionValue: 'India',
                actionType: 'INVALID'
            })).rejects.toThrow('actionType must be SHOW or HIDE');
        });
    });
});

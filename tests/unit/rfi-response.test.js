/**
 * Unit Tests - RFIResponseService
 * Tests draft save, submit validation, deadline enforcement, mandatory field check
 * Updated to match current service implementation.
 */

jest.mock('../../config/database', () => ({ run: jest.fn(), get: jest.fn(), all: jest.fn() }));
// Prevent getMyRFI from hanging on template enrichment
jest.mock('../../services/RFITemplateService', () => ({ getTemplateById: jest.fn() }));
// Prevent _validateMandatoryFields from hanging on rule evaluation
jest.mock('../../services/RFIRuleEngineService', () => ({
    evaluateRules: jest.fn()
}));

const db = require('../../config/database');
const RFITemplateService = require('../../services/RFITemplateService');
const RFIRuleEngineService = require('../../services/RFIRuleEngineService');
const RFIResponseService = require('../../services/RFIResponseService');

const TOMORROW = new Date(Date.now() + 86400000).toISOString();
const YESTERDAY = new Date(Date.now() - 86400000).toISOString();

const mockEvent = { rfi_id: 'rfi-1', template_id: 'tpl-1', title: 'Test RFI', status: 'OPEN', deadline: TOMORROW };

// Note: no template_id on response to avoid triggering template enrichment in getMyRFI
const mockResponse = {
    response_id: 'resp-1', rfi_id: 'rfi-1', supplier_id: 42, status: 'DRAFT',
    submission_date: null, internal_notes: null, evaluation_status: 'UNDER_REVIEW',
    created_at: new Date(), updated_at: new Date(),
    title: 'Test RFI', deadline: TOMORROW, event_status: 'OPEN'
};

beforeEach(() => {
    jest.resetAllMocks();
    RFITemplateService.getTemplateById.mockResolvedValue(null);
    // Default: all questions are visible
    RFIRuleEngineService.evaluateRules.mockResolvedValue({ visibleQuestionIds: ['q-mandatory'] });
});

describe('RFIResponseService', () => {

    describe('getMyRFI', () => {
        test('should return response with answers when exists', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [
                { response_detail_id: 'rd-1', response_id: 'resp-1', question_id: 'q-1', answer_value: 'Yes', attachment_id: null }
            ]));

            const result = await RFIResponseService.getMyRFI('rfi-1', 42);

            expect(result.responseId).toBe('resp-1');
            expect(result.status).toBe('DRAFT');
            expect(result.answers).toHaveLength(1);
        });

        test('should return NOT_STARTED status when no response record', async () => {
            // No response JOIN → null
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            // event lookup (template_id: null to skip template enrichment)
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEvent, template_id: null }));

            const result = await RFIResponseService.getMyRFI('rfi-1', 99);

            expect(result.status).toBe('NOT_STARTED');
            expect(result.rfiId).toBe('rfi-1');
        });

        test('should return null when RFI event not found', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, null))   // no response
                .mockImplementationOnce((sql, params, cb) => cb(null, null));  // no event

            const result = await RFIResponseService.getMyRFI('bad-rfi', 42);
            expect(result).toBeNull();
        });
    });

    describe('saveDraft', () => {
        test('should create new draft when no existing response', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));       // event
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));            // no existing
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({ lastID: 'resp-1' }, null)); // INSERT
            // getMyRFI: response JOIN + details
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));

            await RFIResponseService.saveDraft('rfi-1', 42, []);

            expect(db.run).toHaveBeenCalledTimes(1);
            expect(db.run.mock.calls[0][0]).toContain('INSERT');
        });

        test('should update existing DRAFT response', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));      // event
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));   // existing DRAFT
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));        // UPDATE
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));   // getMyRFI
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));

            await RFIResponseService.saveDraft('rfi-1', 42, []);

            expect(db.run.mock.calls[0][0]).toContain('UPDATE supplier_rfi_response');
        });

        test('should reject saving draft when RFI is CLOSED', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEvent, status: 'CLOSED' }));
            await expect(RFIResponseService.saveDraft('rfi-1', 42, [])).rejects.toThrow('not accepting responses');
        });

        test('should reject saving after deadline', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEvent, deadline: YESTERDAY }));
            await expect(RFIResponseService.saveDraft('rfi-1', 42, [])).rejects.toThrow('deadline has passed');
        });

        test('should reject saving a SUBMITTED response', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockResponse, status: 'SUBMITTED' }));
            await expect(RFIResponseService.saveDraft('rfi-1', 42, [])).rejects.toThrow('Cannot save draft');
        });
    });

    describe('submitResponse', () => {
        test('should reject submission past deadline', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEvent, deadline: YESTERDAY }));
            await expect(RFIResponseService.submitResponse('rfi-1', 42, [])).rejects.toThrow('deadline has passed');
        });

        test('should reject when RFI is not OPEN', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEvent, status: 'CLOSED' }));
            await expect(RFIResponseService.submitResponse('rfi-1', 42, [])).rejects.toThrow('not accepting responses');
        });

        test('should return field errors when mandatory questions not answered', async () => {
            const mandatoryQ = { question_id: 'q-mandatory', question_text: 'Required field', mandatory: true };

            // 1. submitResponse: event check
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // 2. saveDraft: event check
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // 3. saveDraft: no existing response
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            // 4. saveDraft: INSERT response
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // 5. saveDraft → getMyRFI: response JOIN (no template_id so no template enrichment)
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            // 6. getMyRFI: details
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));
            // 7. _validateMandatoryFields: event
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // 8. _validateMandatoryFields: mandatory questions
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [mandatoryQ]));
            // 9. _validateMandatoryFields: get response
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            // 10. _validateMandatoryFields: answers
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));
            // 11. _validateMandatoryFields: supplier lookup
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { supplierid: 42, country: 'US' }));
            // RFIRuleEngineService returns q-mandatory as visible
            RFIRuleEngineService.evaluateRules.mockResolvedValue({ visibleQuestionIds: ['q-mandatory'] });

            try {
                await RFIResponseService.submitResponse('rfi-1', 42, []);
                throw new Error('Expected error not thrown');
            } catch (err) {
                expect(err.fieldErrors).toBeDefined();
                expect(err.fieldErrors.length).toBeGreaterThan(0);
                expect(err.fieldErrors[0].questionId).toBe('q-mandatory');
            }
        });
    });

    describe('getProgress', () => {
        test('should return NOT_STARTED when no response', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));       // event JOIN
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 5 }));     // question count
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));            // no response

            const result = await RFIResponseService.getProgress('rfi-1', 99);

            expect(result.status).toBe('NOT_STARTED');
            expect(result.percentComplete).toBe(0);
        });

        test('should calculate completion percentage correctly', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));       // event
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 10 }));    // 10 questions
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));   // response exists
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 7 }));     // 7 answered

            const result = await RFIResponseService.getProgress('rfi-1', 42);

            expect(result.percentComplete).toBe(70);
            expect(result.answered).toBe(7);
            expect(result.totalRequired).toBe(10);
        });

        test('should return 0% when 0 total questions', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 0 }));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 0 }));

            const result = await RFIResponseService.getProgress('rfi-1', 42);

            expect(result.percentComplete).toBe(0);
        });

        test('should reject when event not found', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            await expect(RFIResponseService.getProgress('bad-id', 42)).rejects.toThrow('RFI event not found');
        });
    });
});

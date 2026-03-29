/**
 * Unit Tests - RFIResponseService
 * Tests draft save, submit validation, deadline enforcement, mandatory field check
 */

jest.mock('../../config/database', () => ({
    run: jest.fn(),
    get: jest.fn(),
    all: jest.fn()
}));

const db = require('../../config/database');
const RFIResponseService = require('../../services/RFIResponseService');

const TOMORROW = new Date(Date.now() + 86400000).toISOString();
const YESTERDAY = new Date(Date.now() - 86400000).toISOString();

const mockEvent = {
    rfi_id: 'rfi-1',
    template_id: 'tpl-1',
    title: 'Test RFI',
    status: 'OPEN',
    deadline: TOMORROW
};

const mockResponse = {
    response_id: 'resp-1',
    rfi_id: 'rfi-1',
    supplier_id: 42,
    status: 'DRAFT',
    submission_date: null,
    internal_notes: null,
    evaluation_status: 'UNDER_REVIEW',
    created_at: new Date(),
    updated_at: new Date(),
    title: 'Test RFI',
    deadline: TOMORROW,
    event_status: 'OPEN'
};

beforeEach(() => {
    jest.resetAllMocks();
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
            // No response, then look up the event
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, null))
                .mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));

            const result = await RFIResponseService.getMyRFI('rfi-1', 99);

            expect(result.status).toBe('NOT_STARTED');
            expect(result.rfiId).toBe('rfi-1');
        });

        test('should return null when RFI event not found', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, null))
                .mockImplementationOnce((sql, params, cb) => cb(null, null));

            const result = await RFIResponseService.getMyRFI('bad-rfi', 42);
            expect(result).toBeNull();
        });
    });

    describe('saveDraft', () => {
        test('should create new draft when no existing response', async () => {
            // event check
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // no existing response
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            // INSERT response
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({ lastID: 'resp-1' }, null));

            // For one answer: check existing detail (none), then INSERT detail
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));

            // getMyRFI for return: response JOIN event, then details
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));

            const result = await RFIResponseService.saveDraft('rfi-1', 42, [
                { questionId: 'q-1', answerValue: 'My answer' }
            ]);

            expect(db.run).toHaveBeenCalledTimes(2); // INSERT response + INSERT detail
        });

        test('should update existing DRAFT response', async () => {
            // event check
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // existing response = DRAFT
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            // UPDATE response to DRAFT
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // getMyRFI: response JOIN event
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));

            const result = await RFIResponseService.saveDraft('rfi-1', 42, []);

            const updateSql = db.run.mock.calls[0][0];
            expect(updateSql).toContain('UPDATE supplier_rfi_response');
        });

        test('should reject saving draft when RFI is CLOSED', async () => {
            const closedEvent = { ...mockEvent, status: 'CLOSED' };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, closedEvent));

            await expect(RFIResponseService.saveDraft('rfi-1', 42, []))
                .rejects.toThrow('not accepting responses');
        });

        test('should reject saving after deadline', async () => {
            const expiredEvent = { ...mockEvent, deadline: YESTERDAY };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, expiredEvent));

            await expect(RFIResponseService.saveDraft('rfi-1', 42, []))
                .rejects.toThrow('deadline has passed');
        });

        test('should reject saving a SUBMITTED response', async () => {
            const submittedResponse = { ...mockResponse, status: 'SUBMITTED' };
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, mockEvent))
                .mockImplementationOnce((sql, params, cb) => cb(null, submittedResponse));

            await expect(RFIResponseService.saveDraft('rfi-1', 42, []))
                .rejects.toThrow('Cannot save draft');
        });
    });

    describe('submitResponse', () => {
        test('should reject submission past deadline', async () => {
            const expiredEvent = { ...mockEvent, deadline: YESTERDAY };
            // saveDraft sees expired event first
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, expiredEvent));

            await expect(RFIResponseService.submitResponse('rfi-1', 42, []))
                .rejects.toThrow('deadline has passed');
        });

        test('should reject when RFI is not OPEN', async () => {
            const closedEvent = { ...mockEvent, status: 'CLOSED' };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, closedEvent));

            await expect(RFIResponseService.submitResponse('rfi-1', 42, []))
                .rejects.toThrow('not accepting responses');
        });

        test('should return field errors when mandatory questions not answered', async () => {
            const mandatoryQ = { question_id: 'q-mandatory', question_text: 'Required field', mandatory: true };

            // submitResponse does its OWN event check first, THEN calls saveDraft
            // Order: submitResponse event → saveDraft event → saveDraft existing → INSERT → getMyRFI → _validate

            // 1. submitResponse's event check
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // 2. saveDraft's event check
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // 3. saveDraft: no existing response
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            // 4. INSERT response
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // 5. getMyRFI (saveDraft return): response JOIN event
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            // 6. getMyRFI: details
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));
            // 7. _validate: event
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // 8. _validate: mandatory questions
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [mandatoryQ]));
            // 9. _validate: get response
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            // 10. _validate: answers (none answered)
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));

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
            // event query (JOIN)
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // total questions count
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 5 }));
            // no response found
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));

            const result = await RFIResponseService.getProgress('rfi-1', 99);

            expect(result.status).toBe('NOT_STARTED');
            expect(result.completionPct).toBe(0);
        });

        test('should calculate completion percentage correctly', async () => {
            // event
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            // total questions = 10
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 10 }));
            // response found
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            // answered count = 7
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 7 }));

            const result = await RFIResponseService.getProgress('rfi-1', 42);

            expect(result.completionPct).toBe(70);
            expect(result.answeredCount).toBe(7);
            expect(result.totalQuestions).toBe(10);
        });

        test('should return 0% when 0 total questions', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEvent));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 0 }));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockResponse));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { cnt: 0 }));

            const result = await RFIResponseService.getProgress('rfi-1', 42);

            expect(result.completionPct).toBe(0);
        });

        test('should reject when event not found', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));

            await expect(RFIResponseService.getProgress('bad-id', 42))
                .rejects.toThrow('RFI event not found');
        });
    });
});

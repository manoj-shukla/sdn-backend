/**
 * Unit Tests - RFITemplateService
 * Tests template CRUD, versioning, publish/archive, status enforcement
 */

jest.mock('../../config/database', () => ({
    run: jest.fn(),
    get: jest.fn(),
    all: jest.fn()
}));
jest.mock('../../services/RFIRuleEngineService', () => ({
    detectCircularLogic: jest.fn()
}));

const db = require('../../config/database');
const RFIRuleEngineService = require('../../services/RFIRuleEngineService');
const RFITemplateService = require('../../services/RFITemplateService');

const mockUser = { userId: 1, buyerId: 10, role: 'BUYER', subRole: 'buyer_admin' };

const mockTemplateRow = {
    template_id: 'uuid-1',
    template_name: 'IT Security RFI',
    category: 'IT',
    subcategory: 'Security',
    version: 1,
    status: 'DRAFT',
    created_by: 1,
    buyer_id: 10,
    applicable_regions: null,
    regulatory_overlays: null,
    created_date: new Date(),
    updated_date: new Date()
};

const mockSectionRow = {
    section_id: 'sec-1',
    template_id: 'uuid-1',
    section_name: 'General Info',
    display_order: 0,
    is_mandatory: true
};

const mockQuestionRow = {
    question_id: 'q-1',
    section_id: 'sec-1',
    template_id: 'uuid-1',
    question_text: 'Describe your security practices',
    question_type: 'LONG_TEXT',
    mandatory: true,
    promote_to_rfp: false,
    options: null,
    validation_rules: null,
    display_order: 0
};

// Helper: mock getTemplateById calls (db.get + 2x db.all)
function mockGetTemplate(templateRow, sections = [], questions = []) {
    db.get.mockImplementationOnce((sql, params, cb) => cb(null, templateRow));
    db.all
        .mockImplementationOnce((sql, params, cb) => cb(null, sections))
        .mockImplementationOnce((sql, params, cb) => cb(null, questions));
}

beforeEach(() => {
    jest.resetAllMocks();
});

describe('RFITemplateService', () => {

    describe('createTemplate', () => {
        test('should create a template and return normalized object', async () => {
            db.run.mockImplementation((sql, params, cb) => cb.call({ lastID: 'uuid-1' }, null));
            db.get.mockImplementation((sql, params, cb) => cb(null, mockTemplateRow));

            const result = await RFITemplateService.createTemplate(
                { templateName: 'IT Security RFI', category: 'IT' },
                mockUser
            );

            expect(result.templateName).toBe('IT Security RFI');
            expect(result.status).toBe('DRAFT');
            expect(result.templateId).toBe('uuid-1');
            expect(db.run).toHaveBeenCalledTimes(1);
        });

        test('should reject if templateName is missing', async () => {
            await expect(RFITemplateService.createTemplate({}, mockUser))
                .rejects.toThrow('templateName is required');
            expect(db.run).not.toHaveBeenCalled();
        });

        test('should pass buyerId from user context', async () => {
            db.run.mockImplementation((sql, params, cb) => cb.call({ lastID: 'uuid-1' }, null));
            db.get.mockImplementation((sql, params, cb) => cb(null, mockTemplateRow));

            await RFITemplateService.createTemplate({ templateName: 'Test' }, mockUser);

            const callParams = db.run.mock.calls[0][1];
            expect(callParams).toContain(10); // buyerId
        });
    });

    describe('listTemplates', () => {
        test('should return array of templates filtered by buyerId', async () => {
            db.all.mockImplementation((sql, params, cb) => cb(null, [mockTemplateRow]));

            const result = await RFITemplateService.listTemplates({}, mockUser);

            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect(result[0].templateId).toBe('uuid-1');
            expect(db.all.mock.calls[0][1]).toContain(10);
        });

        test('should return empty array when no templates exist', async () => {
            db.all.mockImplementation((sql, params, cb) => cb(null, []));
            const result = await RFITemplateService.listTemplates({}, mockUser);
            expect(result).toEqual([]);
        });

        test('should apply status filter when provided', async () => {
            db.all.mockImplementation((sql, params, cb) => cb(null, [mockTemplateRow]));

            await RFITemplateService.listTemplates({ status: 'ACTIVE' }, mockUser);

            const sql = db.all.mock.calls[0][0];
            expect(sql).toContain('status');
        });
    });

    describe('getTemplateById', () => {
        test('should return template with sections and questions', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockTemplateRow));
            db.all
                .mockImplementationOnce((sql, params, cb) => cb(null, [mockSectionRow]))
                .mockImplementationOnce((sql, params, cb) => cb(null, [mockQuestionRow]));

            const result = await RFITemplateService.getTemplateById('uuid-1');

            expect(result.templateId).toBe('uuid-1');
            expect(result.sections).toHaveLength(1);
            expect(result.sections[0].questions).toHaveLength(1);
        });

        test('should return null for non-existent template', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            const result = await RFITemplateService.getTemplateById('nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('updateTemplate', () => {
        test('should update a DRAFT template', async () => {
            // getTemplateById: get + 2x all
            mockGetTemplate(mockTemplateRow);
            // UPDATE run
            db.run.mockImplementationOnce((sql, params, cb) => cb(null));
            // fetch after update
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockTemplateRow, template_name: 'Updated Name' }));

            const result = await RFITemplateService.updateTemplate('uuid-1', { templateName: 'Updated Name' }, mockUser);

            expect(db.run).toHaveBeenCalledTimes(1);
            const sql = db.run.mock.calls[0][0];
            expect(sql).toContain('UPDATE rfi_template');
        });

        test('should reject editing a non-DRAFT template', async () => {
            const activeTemplate = { ...mockTemplateRow, status: 'ACTIVE' };
            mockGetTemplate(activeTemplate);

            await expect(RFITemplateService.updateTemplate('uuid-1', { templateName: 'x' }, mockUser))
                .rejects.toThrow('Only DRAFT templates can be edited');
        });

        test('should reject updating non-existent template', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            db.all
                .mockImplementationOnce((sql, params, cb) => cb(null, []))
                .mockImplementationOnce((sql, params, cb) => cb(null, []));

            await expect(RFITemplateService.updateTemplate('bad-id', {}, mockUser))
                .rejects.toThrow('Template not found');
        });
    });

    describe('publishTemplate', () => {
        test('should publish a DRAFT template (no circular rules)', async () => {
            // getTemplateById
            mockGetTemplate(mockTemplateRow);
            // detectCircularLogic
            RFIRuleEngineService.detectCircularLogic.mockResolvedValue(false);
            // UPDATE run
            db.run.mockImplementationOnce((sql, params, cb) => cb(null));
            // fetch after update
            const activeRow = { ...mockTemplateRow, status: 'ACTIVE' };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, activeRow));

            const result = await RFITemplateService.publishTemplate('uuid-1', mockUser);

            expect(RFIRuleEngineService.detectCircularLogic).toHaveBeenCalledWith('uuid-1');
            expect(db.run).toHaveBeenCalledTimes(1);
            const sql = db.run.mock.calls[0][0];
            expect(sql).toContain("'ACTIVE'");
        });

        test('should reject publishing if circular logic detected', async () => {
            mockGetTemplate(mockTemplateRow);
            RFIRuleEngineService.detectCircularLogic.mockResolvedValue(true);

            await expect(RFITemplateService.publishTemplate('uuid-1', mockUser))
                .rejects.toThrow('circular rule logic');
        });

        test('should reject publishing an ARCHIVED template', async () => {
            const archivedRow = { ...mockTemplateRow, status: 'ARCHIVED' };
            mockGetTemplate(archivedRow);

            await expect(RFITemplateService.publishTemplate('uuid-1', mockUser))
                .rejects.toThrow('Cannot publish');
        });
    });

    describe('archiveTemplate', () => {
        test('should archive an ACTIVE template', async () => {
            const activeRow = { ...mockTemplateRow, status: 'ACTIVE' };
            // getTemplateById returns ACTIVE
            mockGetTemplate(activeRow);
            // UPDATE run
            db.run.mockImplementationOnce((sql, params, cb) => cb(null));
            // fetch after update
            const archivedRow = { ...mockTemplateRow, status: 'ARCHIVED' };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, archivedRow));

            const result = await RFITemplateService.archiveTemplate('uuid-1', mockUser);

            const sql = db.run.mock.calls[0][0];
            expect(sql).toContain("'ARCHIVED'");
        });

        test('should reject archiving a DRAFT template', async () => {
            // DRAFT → cannot archive (only ACTIVE → ARCHIVED)
            mockGetTemplate(mockTemplateRow); // DRAFT

            await expect(RFITemplateService.archiveTemplate('uuid-1', mockUser))
                .rejects.toThrow('Cannot archive');
        });
    });

    describe('createNewVersion', () => {
        test('should clone template as a new DRAFT with incremented version', async () => {
            // First getTemplateById (with one section and one question)
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockTemplateRow));
            db.all
                .mockImplementationOnce((sql, params, cb) => cb(null, [mockSectionRow]))
                .mockImplementationOnce((sql, params, cb) => cb(null, [mockQuestionRow]));

            // INSERT template run
            // INSERT section run
            // INSERT question run
            db.run.mockImplementation((sql, params, cb) => cb.call({ lastID: 'new-uuid' }, null));

            // Final getTemplateById for the new version
            const newVersionRow = { ...mockTemplateRow, template_id: 'new-uuid', version: 2, status: 'DRAFT' };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, newVersionRow));
            db.all
                .mockImplementationOnce((sql, params, cb) => cb(null, []))
                .mockImplementationOnce((sql, params, cb) => cb(null, []));

            const result = await RFITemplateService.createNewVersion('uuid-1', mockUser);

            expect(result.version).toBe(2);
            expect(result.status).toBe('DRAFT');
        });
    });
});

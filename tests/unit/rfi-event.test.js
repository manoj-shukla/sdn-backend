/**
 * Unit Tests - RFIEventService
 * Tests event lifecycle, eligibility check, duplicate invite prevention
 * Updated to match current service implementation.
 */

jest.mock('../../config/database', () => ({ run: jest.fn(), get: jest.fn(), all: jest.fn() }));
jest.mock('../../services/RFIToRFPService', () => ({ convertRFIToRFP: jest.fn() }));
// Prevent getEventById from hanging while enriching template data
jest.mock('../../services/RFITemplateService', () => ({ getTemplateById: jest.fn() }));
jest.mock('../../services/NotificationService', () => ({ createNotification: jest.fn() }));

const db = require('../../config/database');
const RFIToRFPService = require('../../services/RFIToRFPService');
const RFITemplateService = require('../../services/RFITemplateService');
const NotificationService = require('../../services/NotificationService');
const RFIEventService = require('../../services/RFIEventService');

const mockUser = { userId: 1, buyerId: 10, role: 'BUYER' };

const mockEventRow = {
    rfi_id: 'rfi-1', template_id: 'tpl-1', title: 'Cloud Vendor RFI',
    description: 'Vendor evaluation', buyer_id: 10, publish_date: null,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    status: 'DRAFT', created_by: 1, created_at: new Date(), updated_at: new Date(),
    supplier_count: 0, submitted_count: 0,
};

const mockSupplier = { supplierid: 42, legalname: 'ACME Corp', isactive: true };

beforeEach(() => {
    jest.resetAllMocks();
    RFITemplateService.getTemplateById.mockResolvedValue(null);
    NotificationService.createNotification.mockResolvedValue(null);
});

describe('RFIEventService', () => {

    describe('createEvent', () => {
        test('should create event with DRAFT status', async () => {
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({ lastID: 'rfi-1' }, null));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));

            const result = await RFIEventService.createEvent({ title: 'Cloud Vendor RFI', deadline: mockEventRow.deadline }, mockUser);

            expect(result.title).toBe('Cloud Vendor RFI');
            expect(result.status).toBe('DRAFT');
            expect(result.rfiId).toBe('rfi-1');
        });

        test('should reject if title is missing', async () => {
            await expect(RFIEventService.createEvent({}, mockUser)).rejects.toThrow('title is required');
        });
    });

    describe('publishEvent', () => {
        test('should transition DRAFT to OPEN and dispatch invitations', async () => {
            // getEventById: event lookup
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));
            // UPDATE event status to OPEN
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // _dispatchInvitations makes 3 DB calls:
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { title: 'Cloud Vendor RFI' })); // fetch event title
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));                            // no pending invitations
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));                       // UPDATE invitation status to SENT
            // fetch event after update
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEventRow, status: 'OPEN' }));

            const result = await RFIEventService.publishEvent('rfi-1', mockUser);

            expect(db.run.mock.calls[0][0]).toContain("'OPEN'");
            expect(result.status).toBe('OPEN');
        });

                test('should reject publishing an OPEN event', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEventRow, status: 'OPEN' }));
            await expect(RFIEventService.publishEvent('rfi-1', mockUser)).rejects.toThrow('Cannot publish');
        });

        test('should reject publishing a non-existent event', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            await expect(RFIEventService.publishEvent('bad-id', mockUser)).rejects.toThrow('RFI event not found');
        });
    });

    describe('closeEvent', () => {
        test('should transition OPEN to CLOSED and expire pending invitations', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEventRow, status: 'OPEN' }));
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null)); // UPDATE CLOSED
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null)); // expire invitations
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEventRow, status: 'CLOSED' }));

            const result = await RFIEventService.closeEvent('rfi-1', mockUser);

            expect(db.run.mock.calls[1][0]).toContain('EXPIRED');
            expect(result.status).toBe('CLOSED');
        });

        test('should reject closing a DRAFT event', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));
            await expect(RFIEventService.closeEvent('rfi-1', mockUser)).rejects.toThrow('Cannot close');
        });
    });

    describe('convertToRFP', () => {
        test('should convert CLOSED event to CONVERTED and call RFIToRFPService', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEventRow, status: 'CLOSED' }));
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockEventRow, status: 'CONVERTED' }));
            RFIToRFPService.convertRFIToRFP.mockResolvedValue({ rfpTitle: 'RFP - Cloud Vendor RFI' });

            const result = await RFIEventService.convertToRFP('rfi-1', mockUser);

            expect(RFIToRFPService.convertRFIToRFP).toHaveBeenCalledWith('rfi-1', mockUser);
            expect(result.rfpDraft).toBeDefined();
            expect(result.event.status).toBe('CONVERTED');
        });

        test('should reject converting a DRAFT event', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));
            await expect(RFIEventService.convertToRFP('rfi-1', mockUser)).rejects.toThrow('Cannot convert');
        });
    });

    describe('addInvitations', () => {
        test('should add valid supplier invitations', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow)); // getEventById
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));          // no dup
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockSupplier)); // supplier active
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));      // INSERT

            const result = await RFIEventService.addInvitations('rfi-1', [42], [], mockUser);

            expect(result.added).toHaveLength(1);
            expect(result.errors).toHaveLength(0);
            expect(result.added[0].supplierId).toBe(42);
        });

        test('should reject duplicate supplier invitation', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { invitation_id: 'existing' })); // dup found

            const result = await RFIEventService.addInvitations('rfi-1', [42], [], mockUser);

            expect(result.added).toHaveLength(0);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].error).toContain('already invited');
        });

        test('should reject invitation for blocked/inactive supplier', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { ...mockSupplier, isactive: false }));

            const result = await RFIEventService.addInvitations('rfi-1', [42], [], mockUser);

            expect(result.errors[0].error).toContain('blocked');
        });

        test('should handle multiple suppliers with mixed eligibility', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow)); // getEventById
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));          // 42: no dup
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockSupplier)); // 42: active
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));      // INSERT 42
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { invitation_id: 'x' })); // 99: dup

            const result = await RFIEventService.addInvitations('rfi-1', [42, 99], [], mockUser);

            expect(result.added).toHaveLength(1);
            expect(result.errors).toHaveLength(1);
        });
    });

    describe('validateSupplierEligibility', () => {
        test('should return eligible for valid uninvited suppliers', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, mockSupplier)) // supplier exists
                .mockImplementationOnce((sql, params, cb) => cb(null, null));         // not yet invited

            const result = await RFIEventService.validateSupplierEligibility('rfi-1', [42]);

            expect(result[0].eligible).toBe(true);
        });

        test('should flag supplier not found as ineligible', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));

            const result = await RFIEventService.validateSupplierEligibility('rfi-1', [999]);

            expect(result[0].eligible).toBe(false);
            expect(result[0].reason).toContain('not found');
        });
    });

    describe('listEvents — supplier count via LEFT JOIN', () => {
        test('should parse supplierCount as number (PostgreSQL returns COUNT as string)', async () => {
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [{
                ...mockEventRow, supplier_count: '3', submitted_count: '2'
            }]));

            const results = await RFIEventService.listEvents(mockUser, {});

            expect(results[0].supplierCount).toBe(3);
            expect(results[0].submittedCount).toBe(2);
        });

        test('should default counts to 0 when LEFT JOIN returns null', async () => {
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [{
                ...mockEventRow, supplier_count: null, submitted_count: null
            }]));

            const results = await RFIEventService.listEvents(mockUser, {});

            expect(results[0].supplierCount).toBe(0);
            expect(results[0].submittedCount).toBe(0);
        });

        test('listEvents SQL should use LEFT JOIN aggregation not correlated subqueries', async () => {
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));

            await RFIEventService.listEvents(mockUser, {});

            const sql = db.all.mock.calls[0][0];
            expect(sql).toContain('LEFT JOIN');
            expect(sql).toContain('supplier_count');
            expect(sql).toContain('GROUP BY');
        });
    });
});

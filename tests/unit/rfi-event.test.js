/**
 * Unit Tests - RFIEventService
 * Tests event lifecycle, eligibility check, duplicate invite prevention
 */

jest.mock('../../config/database', () => ({
    run: jest.fn(),
    get: jest.fn(),
    all: jest.fn()
}));
jest.mock('../../services/RFIToRFPService', () => ({
    convertRFIToRFP: jest.fn()
}));

const db = require('../../config/database');
const RFIToRFPService = require('../../services/RFIToRFPService');
const RFIEventService = require('../../services/RFIEventService');

const mockUser = { userId: 1, buyerId: 10, role: 'BUYER' };

const mockEventRow = {
    rfi_id: 'rfi-1',
    template_id: 'tpl-1',
    title: 'Cloud Vendor RFI',
    description: 'Vendor evaluation',
    buyer_id: 10,
    publish_date: null,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    status: 'DRAFT',
    created_by: 1,
    created_at: new Date(),
    updated_at: new Date()
};

const mockSupplier = {
    supplierid: 42,
    legalname: 'ACME Corp',
    isactive: true
};

beforeEach(() => {
    jest.resetAllMocks();
});

describe('RFIEventService', () => {

    describe('createEvent', () => {
        test('should create event with DRAFT status', async () => {
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({ lastID: 'rfi-1' }, null));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));

            const result = await RFIEventService.createEvent(
                { title: 'Cloud Vendor RFI', deadline: mockEventRow.deadline },
                mockUser
            );

            expect(result.title).toBe('Cloud Vendor RFI');
            expect(result.status).toBe('DRAFT');
            expect(result.rfiId).toBe('rfi-1');
        });

        test('should reject if title is missing', async () => {
            await expect(RFIEventService.createEvent({}, mockUser))
                .rejects.toThrow('title is required');
        });
    });

    describe('publishEvent', () => {
        test('should transition DRAFT → OPEN and dispatch invitations', async () => {
            // getEventById
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow)); // DRAFT
            // UPDATE to OPEN
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // dispatch invitations
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // fetch after update
            const openRow = { ...mockEventRow, status: 'OPEN' };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, openRow));

            const result = await RFIEventService.publishEvent('rfi-1', mockUser);

            expect(db.run).toHaveBeenCalledTimes(2);
            const updateSql = db.run.mock.calls[0][0];
            expect(updateSql).toContain("'OPEN'");
            expect(result.status).toBe('OPEN');
        });

        test('should reject publishing an OPEN event', async () => {
            const openEvent = { ...mockEventRow, status: 'OPEN' };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, openEvent));

            await expect(RFIEventService.publishEvent('rfi-1', mockUser))
                .rejects.toThrow('Cannot publish');
        });

        test('should reject publishing a non-existent event', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));

            await expect(RFIEventService.publishEvent('bad-id', mockUser))
                .rejects.toThrow('RFI event not found');
        });
    });

    describe('closeEvent', () => {
        test('should transition OPEN → CLOSED and expire pending invitations', async () => {
            const openEvent = { ...mockEventRow, status: 'OPEN' };
            // getEventById
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, openEvent));
            // UPDATE to CLOSED
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // expire invitations
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // fetch after update
            const closedRow = { ...mockEventRow, status: 'CLOSED' };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, closedRow));

            const result = await RFIEventService.closeEvent('rfi-1', mockUser);

            const expireSql = db.run.mock.calls[1][0];
            expect(expireSql).toContain('EXPIRED');
            expect(result.status).toBe('CLOSED');
        });

        test('should reject closing a DRAFT event', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow)); // DRAFT

            await expect(RFIEventService.closeEvent('rfi-1', mockUser))
                .rejects.toThrow('Cannot close');
        });
    });

    describe('convertToRFP', () => {
        test('should convert CLOSED event to CONVERTED and call RFIToRFPService', async () => {
            const closedEvent = { ...mockEventRow, status: 'CLOSED' };
            // getEventById
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, closedEvent));
            // UPDATE to CONVERTED
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // fetch after update
            const convertedRow = { ...mockEventRow, status: 'CONVERTED' };
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, convertedRow));
            RFIToRFPService.convertRFIToRFP.mockResolvedValue({ rfpTitle: 'RFP - Cloud Vendor RFI' });

            const result = await RFIEventService.convertToRFP('rfi-1', mockUser);

            expect(RFIToRFPService.convertRFIToRFP).toHaveBeenCalledWith('rfi-1', mockUser);
            expect(result.rfpDraft).toBeDefined();
            expect(result.event.status).toBe('CONVERTED');
        });

        test('should reject converting a DRAFT event', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow)); // DRAFT

            await expect(RFIEventService.convertToRFP('rfi-1', mockUser))
                .rejects.toThrow('Cannot convert');
        });
    });

    describe('addInvitations', () => {
        test('should add valid supplier invitations', async () => {
            // getEventById
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));
            // no existing invitation
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            // supplier found and active
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockSupplier));
            // INSERT invitation
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({ lastID: 'inv-1' }, null));

            const result = await RFIEventService.addInvitations('rfi-1', [42], mockUser);

            expect(result.added).toHaveLength(1);
            expect(result.errors).toHaveLength(0);
            expect(result.added[0].supplierId).toBe(42);
        });

        test('should reject duplicate supplier invitation', async () => {
            const existingInvite = { invitation_id: 'existing', supplier_id: 42 };
            // getEventById
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));
            // existing invitation found
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, existingInvite));

            const result = await RFIEventService.addInvitations('rfi-1', [42], mockUser);

            expect(result.added).toHaveLength(0);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].error).toContain('already invited');
        });

        test('should reject invitation for blocked/inactive supplier', async () => {
            const inactiveSupplier = { ...mockSupplier, isactive: false };
            // getEventById
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));
            // no existing invite
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            // inactive supplier
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, inactiveSupplier));

            const result = await RFIEventService.addInvitations('rfi-1', [42], mockUser);

            expect(result.errors[0].error).toContain('blocked');
        });

        test('should handle multiple suppliers with mixed eligibility', async () => {
            // getEventById
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockEventRow));
            // supplier 42: no existing invite, active
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, mockSupplier));
            // supplier 99: already invited
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { invitation_id: 'x' }));
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));

            const result = await RFIEventService.addInvitations('rfi-1', [42, 99], mockUser);

            expect(result.added).toHaveLength(1);
            expect(result.errors).toHaveLength(1);
        });
    });

    describe('validateSupplierEligibility', () => {
        test('should return eligible for valid uninvited suppliers', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, mockSupplier))  // supplier found
                .mockImplementationOnce((sql, params, cb) => cb(null, null));          // not invited

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
});

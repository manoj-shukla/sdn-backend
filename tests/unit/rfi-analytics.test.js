/**
 * Unit Tests - RFIAnalyticsService
 * Covers getEventMetrics, getBuyerCapabilityDashboard (including Number() cast fix).
 */

jest.mock('../../config/database', () => ({ run: jest.fn(), get: jest.fn(), all: jest.fn() }));

const db = require('../../config/database');
const RFIAnalyticsService = require('../../services/RFIAnalyticsService');

const mockEvent = { rfi_id: 'rfi-1', title: 'Cloud RFI', status: 'OPEN', deadline: new Date(Date.now() + 86400000).toISOString() };

beforeEach(() => { jest.resetAllMocks(); });

describe('RFIAnalyticsService', () => {

    describe('getEventMetrics', () => {
        test('should calculate completion rate correctly', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, mockEvent))           // event
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_invited: 10 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_submitted: 7 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_in_progress: 1 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { avg_time_secs: 3600 }));

            const result = await RFIAnalyticsService.getEventMetrics('rfi-1');

            expect(result.completionRate).toBe(70);
            expect(result.totalInvited).toBe(10);
            expect(result.totalSubmitted).toBe(7);
        });

        test('should return 0% completion when no invitations sent', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, mockEvent))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_invited: 0 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_submitted: 0 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_in_progress: 0 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, null));

            const result = await RFIAnalyticsService.getEventMetrics('rfi-1');

            expect(result.completionRate).toBe(0);
        });

        test('should reject when event not found', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            await expect(RFIAnalyticsService.getEventMetrics('bad-id')).rejects.toThrow('not found');
        });

        test('should handle 100% completion rate', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, mockEvent))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_invited: 5 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_submitted: 5 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_in_progress: 0 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, null));

            const result = await RFIAnalyticsService.getEventMetrics('rfi-1');

            expect(result.completionRate).toBe(100);
        });
    });

    describe('getBuyerCapabilityDashboard', () => {
        test('should return zeros when buyer has no events', async () => {
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [])); // no events

            const result = await RFIAnalyticsService.getBuyerCapabilityDashboard(1);

            expect(result.totalRFIs).toBe(0);
            expect(result.totalSuppliersParticipated).toBe(0);
            expect(result.avgCompletionRate).toBe(0);
            expect(result.events).toEqual([]);
        });

        test('should sum totalSubmitted as numbers even when PostgreSQL returns COUNT as string', async () => {
            // PostgreSQL COUNT returns strings — this is the bug that caused "011111100"
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [
                { rfi_id: 'rfi-1', title: 'RFI A', status: 'OPEN', deadline: null }
            ]));
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_suppliers: '3' }))  // string
                .mockImplementationOnce((sql, params, cb) => cb(null, { suppliers_with_docs: '1' })); // string
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [
                { rfi_id: 'rfi-1', invited: '5', submitted: '3' }  // PostgreSQL strings
            ]));

            const result = await RFIAnalyticsService.getBuyerCapabilityDashboard(1);

            expect(typeof result.totalSubmitted).toBe('number');
            expect(result.totalSubmitted).toBe(3);     // not "03" or NaN
            expect(result.totalAwaiting).toBe(2);      // 5 - 3
            expect(result.totalInvited).toBe(5);
        });

        test('should not string-concatenate when multiple events have string counts', async () => {
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [
                { rfi_id: 'rfi-1', title: 'A', status: 'OPEN', deadline: null },
                { rfi_id: 'rfi-2', title: 'B', status: 'OPEN', deadline: null },
            ]));
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_suppliers: '4' }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { suppliers_with_docs: '2' }));
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [
                { rfi_id: 'rfi-1', invited: '3', submitted: '1' },
                { rfi_id: 'rfi-2', invited: '4', submitted: '2' },
            ]));

            const result = await RFIAnalyticsService.getBuyerCapabilityDashboard(1);

            // Without Number() cast: '0' + '1' + '2' = '012' which is NOT 3
            expect(result.totalSubmitted).toBe(3);   // must be numeric 3
            expect(result.totalInvited).toBe(7);     // must be numeric 7
            expect(result.totalAwaiting).toBe(4);    // 7 - 3
        });

        test('should compute avgCompletionRate from per-event data', async () => {
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [
                { rfi_id: 'rfi-1', title: 'A', status: 'OPEN', deadline: null }
            ]));
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_suppliers: '2' }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { suppliers_with_docs: '0' }));
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [
                { rfi_id: 'rfi-1', invited: '4', submitted: '2' }
            ]));

            const result = await RFIAnalyticsService.getBuyerCapabilityDashboard(1);

            expect(result.avgCompletionRate).toBe(50); // 2/4 * 100
        });

        test('convertedEvents should count events with CONVERTED status', async () => {
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [
                { rfi_id: 'rfi-1', title: 'A', status: 'CONVERTED', deadline: null },
                { rfi_id: 'rfi-2', title: 'B', status: 'OPEN', deadline: null },
            ]));
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_suppliers: '0' }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { suppliers_with_docs: '0' }));
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, []));

            const result = await RFIAnalyticsService.getBuyerCapabilityDashboard(1);

            expect(result.convertedEvents).toBe(1);
        });
    });
});

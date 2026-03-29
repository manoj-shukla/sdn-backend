/**
 * Unit Tests - RFIAnalyticsService & RFIRegulatoryOverlayService
 * Tests completion rate calculation, participation metrics, India overlay trigger
 */

jest.mock('../../config/database', () => ({
    run: jest.fn(),
    get: jest.fn(),
    all: jest.fn()
}));

const db = require('../../config/database');
const RFIAnalyticsService = require('../../services/RFIAnalyticsService');
const RFIRegulatoryOverlayService = require('../../services/RFIRegulatoryOverlayService');

const mockEvent = {
    rfi_id: 'rfi-1',
    title: 'Cloud Vendor RFI',
    status: 'CLOSED',
    deadline: new Date().toISOString(),
    publish_date: new Date(Date.now() - 86400000).toISOString(),
    buyer_id: 10
};

beforeEach(() => {
    jest.resetAllMocks();
});

describe('RFIAnalyticsService', () => {

    describe('getEventMetrics', () => {
        test('should calculate completion rate correctly', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, mockEvent))          // event
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_invited: 10 }))   // invited
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_submitted: 7 }))  // submitted
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_in_progress: 2 }))// in progress
                .mockImplementationOnce((sql, params, cb) => cb(null, { avg_time_secs: 3600 }));// avg time

            const result = await RFIAnalyticsService.getEventMetrics('rfi-1');

            expect(result.rfiId).toBe('rfi-1');
            expect(result.totalInvited).toBe(10);
            expect(result.totalSubmitted).toBe(7);
            expect(result.completionRate).toBe(70);
            expect(result.participationRate).toBe(70);
            expect(result.avgTimeToSubmitSecs).toBe(3600);
        });

        test('should return 0% completion when no invitations sent', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, mockEvent))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_invited: 0 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_submitted: 0 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_in_progress: 0 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { avg_time_secs: null }));

            const result = await RFIAnalyticsService.getEventMetrics('rfi-1');

            expect(result.completionRate).toBe(0);
            expect(result.totalInvited).toBe(0);
        });

        test('should reject when event not found', async () => {
            db.get.mockImplementation((sql, params, cb) => cb(null, null));

            await expect(RFIAnalyticsService.getEventMetrics('bad-id'))
                .rejects.toThrow('RFI event not found');
        });

        test('should handle 100% completion rate', async () => {
            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, mockEvent))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_invited: 5 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_submitted: 5 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_in_progress: 0 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { avg_time_secs: 1800 }));

            const result = await RFIAnalyticsService.getEventMetrics('rfi-1');

            expect(result.completionRate).toBe(100);
        });
    });

    describe('getBuyerCapabilityDashboard', () => {
        test('should return dashboard metrics for a buyer with events', async () => {
            db.all
                .mockImplementationOnce((sql, params, cb) => cb(null, [mockEvent, { ...mockEvent, rfi_id: 'rfi-2' }]))  // events
                .mockImplementationOnce((sql, params, cb) => cb(null, []))  // per-event completions

            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_suppliers: 8 }))      // participating
                .mockImplementationOnce((sql, params, cb) => cb(null, { suppliers_with_docs: 6 })); // with docs

            const result = await RFIAnalyticsService.getBuyerCapabilityDashboard(10);

            expect(result.buyerId).toBe(10);
            expect(result.totalRFIs).toBe(2);
            expect(result.totalSuppliersParticipated).toBe(8);
            expect(result.certificationCoverage).toBe(75); // 6/8 * 100
        });

        test('should return zeros when buyer has no events', async () => {
            db.all.mockImplementation((sql, params, cb) => cb(null, []));

            const result = await RFIAnalyticsService.getBuyerCapabilityDashboard(99);

            expect(result.totalRFIs).toBe(0);
            expect(result.totalSuppliersParticipated).toBe(0);
            expect(result.avgCompletionRate).toBe(0);
            expect(result.certificationCoverage).toBe(0);
        });

        test('should compute avgCompletionRate from per-event data', async () => {
            db.all
                .mockImplementationOnce((sql, params, cb) => cb(null, [mockEvent]))
                .mockImplementationOnce((sql, params, cb) => cb(null, [
                    { rfi_id: 'rfi-1', invited: 10, submitted: 8 }
                ]));

            db.get
                .mockImplementationOnce((sql, params, cb) => cb(null, { total_suppliers: 8 }))
                .mockImplementationOnce((sql, params, cb) => cb(null, { suppliers_with_docs: 0 }));

            const result = await RFIAnalyticsService.getBuyerCapabilityDashboard(10);

            expect(result.avgCompletionRate).toBe(80); // 8/10 * 100
        });
    });
});

describe('RFIRegulatoryOverlayService', () => {

    describe('getOverlayQuestions', () => {
        test('should inject India-specific questions for Indian suppliers', () => {
            const result = RFIRegulatoryOverlayService.getOverlayQuestions({ country: 'India' });

            expect(result.length).toBeGreaterThan(0);
            const tags = result.map(q => q.tag);
            expect(tags).toContain('INDIA_GST');
            expect(tags).toContain('INDIA_PAN');
            expect(tags).toContain('INDIA_MSME');
        });

        test('should inject India questions using country code "IN"', () => {
            const result = RFIRegulatoryOverlayService.getOverlayQuestions({ country: 'IN' });
            const tags = result.map(q => q.tag);
            expect(tags).toContain('INDIA_GST');
        });

        test('should inject AML questions for cross-border suppliers', () => {
            const result = RFIRegulatoryOverlayService.getOverlayQuestions({ country: 'US', crossBorder: true });
            const tags = result.map(q => q.tag);
            expect(tags).toContain('AML');
            expect(tags).toContain('EXPORT_CONTROL');
        });

        test('should inject both India and AML questions for Indian cross-border suppliers', () => {
            const result = RFIRegulatoryOverlayService.getOverlayQuestions({ country: 'India', crossBorder: true });
            const tags = result.map(q => q.tag);
            expect(tags).toContain('INDIA_GST');
            expect(tags).toContain('AML');
            expect(tags).toContain('EXPORT_CONTROL');
        });

        test('should return empty for non-India, non-cross-border supplier', () => {
            const result = RFIRegulatoryOverlayService.getOverlayQuestions({ country: 'US', crossBorder: false });
            expect(result).toHaveLength(0);
        });

        test('should handle null/undefined context gracefully', () => {
            expect(RFIRegulatoryOverlayService.getOverlayQuestions(null)).toHaveLength(0);
            expect(RFIRegulatoryOverlayService.getOverlayQuestions(undefined)).toHaveLength(0);
        });

        test('should mark GST as mandatory', () => {
            const result = RFIRegulatoryOverlayService.getOverlayQuestions({ country: 'India' });
            const gstin = result.find(q => q.tag === 'INDIA_GST');
            expect(gstin.mandatory).toBe(true);
        });
    });

    describe('getApplicableFrameworks', () => {
        test('should list India frameworks for Indian supplier', () => {
            const frameworks = RFIRegulatoryOverlayService.getApplicableFrameworks({ country: 'india' });
            expect(frameworks).toContain('GST');
            expect(frameworks).toContain('PAN');
            expect(frameworks).toContain('MSME');
        });

        test('should list AML and EXPORT_CONTROL for cross-border', () => {
            const frameworks = RFIRegulatoryOverlayService.getApplicableFrameworks({ country: 'US', crossBorder: 'true' });
            expect(frameworks).toContain('AML');
            expect(frameworks).toContain('EXPORT_CONTROL');
        });
    });
});

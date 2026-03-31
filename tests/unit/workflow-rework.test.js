/**
 * Unit Tests - Supplier Onboarding Rework Flow
 * Tests the rework resubmission cycle:
 *   Buyer requests rework → supplier resubmits → workflow resumes from step 1
 */

jest.mock('../../config/database', () => ({ run: jest.fn(), get: jest.fn(), all: jest.fn() }));
jest.mock('../../services/NotificationService', () => ({ createNotification: jest.fn().mockResolvedValue(null) }));
jest.mock('../../services/MessageService', () => ({ createMessage: jest.fn().mockResolvedValue(null) }));

const db = require('../../config/database');
const NotificationService = require('../../services/NotificationService');
const WorkflowService = require('../../services/WorkflowService');

const MessageService = require('../../services/MessageService');

beforeEach(() => {
    jest.resetAllMocks();
    NotificationService.createNotification.mockResolvedValue(null);
    MessageService.createMessage.mockResolvedValue(null);
});

describe('WorkflowService — rework resubmission', () => {

    describe('initiateWorkflow — resumes REWORK_REQUIRED instance', () => {
        test('should find REWORK_REQUIRED instance and reset it instead of creating a new one', async () => {
            // Existing instance in REWORK_REQUIRED state
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { instanceid: 'inst-1' }));
            // Reset workflow to PENDING
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // Reset step instances
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // Reset currentsteporder
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));

            const instanceId = await WorkflowService.initiateWorkflow(42, 'wf-1', 'RESUBMISSION');

            expect(instanceId).toBe('inst-1');
            // Should query for both PENDING and REWORK_REQUIRED
            const lookupSql = db.get.mock.calls[0][0];
            expect(lookupSql).toContain('REWORK_REQUIRED');
            expect(lookupSql).toContain('PENDING');
        });

        test('should reset workflow status to PENDING on resume', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { instanceid: 'inst-1' }));
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null)); // reset workflow
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null)); // reset steps
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null)); // reset step order

            await WorkflowService.initiateWorkflow(42, 'wf-1', 'RESUBMISSION');

            const resetWorkflowSql = db.run.mock.calls[0][0];
            expect(resetWorkflowSql).toContain("status = 'PENDING'");
            expect(resetWorkflowSql).toContain('completedat = NULL');
        });

        test('should reset step instances: step 1 to PENDING, others to WAITING', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { instanceid: 'inst-1' }));
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null)); // reset workflow
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null)); // reset steps
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null)); // reset step order

            await WorkflowService.initiateWorkflow(42, 'wf-1', 'RESUBMISSION');

            const resetStepsSql = db.run.mock.calls[1][0];
            expect(resetStepsSql).toContain('PENDING');
            expect(resetStepsSql).toContain('WAITING');
            expect(resetStepsSql).toContain('steporder');
        });

        test('should reset currentsteporder to 1 so approval restarts from first step', async () => {
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { instanceid: 'inst-1' }));
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));

            await WorkflowService.initiateWorkflow(42, 'wf-1', 'RESUBMISSION');

            const resetOrderSql = db.run.mock.calls[2][0];
            expect(resetOrderSql).toContain('currentsteporder = 1');
        });

        test('should create new instance when no existing PENDING or REWORK_REQUIRED workflow', async () => {
            // No existing instance
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, null));
            // Fetch workflow steps
            db.all.mockImplementationOnce((sql, params, cb) => cb(null, [
                { steporder: 1, stepname: 'Legal Review', assignedroleid: 2, isoptional: false }
            ]));
            // INSERT new instance
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { instanceid: 'new-inst' }));
            // INSERT step instance
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({ lastID: 'step-1' }, null));

            const instanceId = await WorkflowService.initiateWorkflow(42, 'wf-1', 'INITIAL');

            expect(instanceId).toBe('new-inst');
        });
    });

    describe('requestRework', () => {
        test('should set step instance to REWORK_REQUIRED', async () => {
            // fetch instance for auth check
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, {
                instanceid: 'inst-1', workflowtemplateid: 'wf-1', currentsteporder: 1, status: 'PENDING',
                supplierid: 42
            }));
            // fetch step instance
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, {
                stepinstanceid: 'step-1', instanceid: 'inst-1', steporder: 1, status: 'PENDING',
                assignedroleid: 2
            }));
            // UPDATE step to REWORK_REQUIRED
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // UPDATE workflow instance to REWORK_REQUIRED
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({}, null));
            // fetch supplier/buyer for notification
            db.get.mockImplementationOnce((sql, params, cb) => cb(null, { supplierid: 42, buyerid: 1 }));
            // UPDATE supplier approvalstatus
            db.run.mockImplementationOnce((sql, params, cb) => cb.call({ changes: 1 }, null));

            await WorkflowService.requestRework('inst-1', 1, 2, 'Please fix your certifications', 'step-1');

            // Step instance should be set to REWORK_REQUIRED
            const stepSql = db.run.mock.calls[0][0];
            expect(stepSql).toContain("REWORK_REQUIRED");

            // Workflow instance should also be REWORK_REQUIRED
            const workflowSql = db.run.mock.calls[1][0];
            expect(workflowSql).toContain("REWORK_REQUIRED");
        });

        test('should reject rework request with empty comments', async () => {
            await expect(
                WorkflowService.requestRework('inst-1', 1, 2, '', 'step-1')
            ).rejects.toThrow('mandatory');
        });
    });
});

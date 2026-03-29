/**
 * Workflow Engine Integration Tests
 *
 * Tests for workflow management including:
 * - Workflow CRUD operations
 * - Workflow execution
 * - Step management and assignments
 * - Workflow templates
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8083';
const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

const generateToken = (user) => jwt.sign(user, SECRET_KEY, { expiresIn: '1h' });

function log(step, msg, data) {
    console.log(`[${step}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

let testWorkflowId = null;
let testExecutionId = null;
let testSupplierId = null;

// Cleanup helper
async function cleanupTestData() {
    if (!db.run) return;

    // Clean up executions
    if (testExecutionId) {
        await new Promise(r => db.run('DELETE FROM workflow_instances WHERE instanceId = $1', [testExecutionId], r));
    }

    // Clean up workflow steps
    if (testWorkflowId) {
        await new Promise(r => db.run('DELETE FROM workflow_steps WHERE workflowId = $1', [testWorkflowId], r));
        await new Promise(r => db.run('DELETE FROM workflow_instances WHERE workflowTemplateId = $1', [testWorkflowId], r));
        await new Promise(r => db.run('DELETE FROM workflows WHERE workflowId = $1', [testWorkflowId], r));
    }

    // Clean up test supplier
    if (testSupplierId) {
        await new Promise(r => db.run('DELETE FROM supplier_change_items WHERE requestId IN (SELECT requestId FROM supplier_change_requests WHERE supplierId = $1)', [testSupplierId], r));
        await new Promise(r => db.run('DELETE FROM supplier_change_requests WHERE supplierId = $1', [testSupplierId], r));
        await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [testSupplierId], r));
    }

    testWorkflowId = null;
    testExecutionId = null;
    testSupplierId = null;
}

describe('Workflow Engine Integration Tests', () => {
    let buyerAdminToken;
    let complianceToken;
    let financeToken;

    beforeAll(async () => {
        buyerAdminToken = generateToken({ userId: 1, role: 'BUYER', subRole: 'Admin', buyerId: 1 });
        complianceToken = generateToken({ userId: 3, role: 'BUYER', subRole: 'Compliance Officer', buyerId: 1 });
        financeToken = generateToken({ userId: 4, role: 'BUYER', subRole: 'Finance Manager', buyerId: 1 });

        // Create test supplier
        const supplierResponse = await axios.post(`${BASE_URL}/api/suppliers`, {
            legalName: 'Workflow Test Supplier',
            businessType: 'LLC',
            country: 'US',
            isGstRegistered: false
        }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

        testSupplierId = supplierResponse.data.supplierId;
        log('SETUP', `Created test supplier ${testSupplierId}`);
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    describe('Workflow CRUD Operations', () => {
        describe('POST /workflows - Create Workflow', () => {
            test('should create workflow with valid steps', async () => {
                const workflowName = `Supplier Approval Flow ${Date.now()}`;
                const workflowData = {
                    workflowName: workflowName,
                    description: 'Standard approval process for new suppliers',
                    buyerId: 1,
                    steps: [
                        {
                            stepName: 'Compliance Review',
                            order: 1,
                            assignedRole: 'COMPLIANCE_OFFICER',
                            requiredActions: ['REVIEW', 'APPROVE', 'REJECT']
                        },
                        {
                            stepName: 'Finance Review',
                            order: 2,
                            assignedRole: 'FINANCE_MANAGER',
                            requiredActions: ['REVIEW', 'APPROVE', 'REJECT']
                        },
                        {
                            stepName: 'Final Approval',
                            order: 3,
                            assignedRole: 'ADMIN',
                            requiredActions: ['APPROVE', 'REJECT']
                        }
                    ]
                };

                const response = await axios.post(`${BASE_URL}/api/workflows`, workflowData, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(201);
                expect(response.data.workflowId).toBeDefined();
                expect(response.data.workflowName).toBe(workflowName);
                expect(response.data.steps).toHaveLength(3);
                testWorkflowId = response.data.workflowId;

                log('CREATE', 'Workflow created', { workflowId: testWorkflowId, steps: response.data.steps.length });
            });

            test('should reject workflow without steps', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/workflows`, {
                        workflowName: 'Invalid Workflow',
                        description: 'No steps',
                        buyerId: 1,
                        steps: []
                    }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    if (!error.response) throw error;
                    expect(error.response.status).toBe(400);
                    expect(error.response.data.error).toContain('steps');

                    log('CREATE', 'Workflow without steps rejected');
                }
            });

            test('should reject workflow with duplicate step orders', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/workflows`, {
                        workflowName: 'Duplicate Orders',
                        description: 'Invalid step orders',
                        buyerId: 1,
                        steps: [
                            { stepName: 'Step 1', order: 1, assignedRole: 'ADMIN' },
                            { stepName: 'Step 2', order: 1, assignedRole: 'ADMIN' }
                        ]
                    }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    if (!error.response) throw error;
                    expect(error.response.status).toBe(400);
                }
            });
        });

        describe('GET /workflows - List Workflows', () => {
            test('should list all workflows for buyer', async () => {
                const response = await axios.get(`${BASE_URL}/api/workflows`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(Array.isArray(response.data)).toBe(true);
                expect(response.data.length).toBeGreaterThan(0);

                const ourWorkflow = response.data.find(w => w.workflowId === testWorkflowId);
                expect(ourWorkflow).toBeDefined();

                log('LIST', `Found ${response.data.length} workflows`);
            });

            test('should include step definitions in list', async () => {
                const response = await axios.get(`${BASE_URL}/api/workflows?includeSteps=true`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);

                const ourWorkflow = response.data.find(w => w.workflowId === testWorkflowId);
                expect(ourWorkflow.steps).toBeDefined();
                expect(ourWorkflow.steps.length).toBe(3);
            });
        });

        describe('GET /workflows/:id - Get Workflow Details', () => {
            test('should get workflow with all steps', async () => {
                const response = await axios.get(`${BASE_URL}/api/workflows/${testWorkflowId}`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.workflowId).toBe(testWorkflowId);
                expect(response.data.steps).toHaveLength(3);
                expect(response.data.steps[0].stepName).toBe('Compliance Review');

                log('GET', 'Workflow details retrieved');
            });

            test('should return 404 for non-existent workflow', async () => {
                try {
                    await axios.get(`${BASE_URL}/api/workflows/999999`, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });
                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(404);
                }
            });
        });

        describe('PUT /workflows/:id - Update Workflow', () => {
            test('should update workflow details', async () => {
                const response = await axios.put(`${BASE_URL}/api/workflows/${testWorkflowId}`, {
                    workflowName: 'Updated Approval Flow',
                    description: 'Updated description'
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.workflowName).toBe('Updated Approval Flow');

                log('UPDATE', 'Workflow updated');
            });

            test('should add new steps to workflow', async () => {
                const response = await axios.put(`${BASE_URL}/api/workflows/${testWorkflowId}`, {
                    steps: [
                        { stepName: 'New Step', order: 4, assignedRole: 'ADMIN', requiredActions: ['APPROVE'] }
                    ]
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);

                const updated = await axios.get(`${BASE_URL}/api/workflows/${testWorkflowId}`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(updated.data.steps).toHaveLength(4);
                log('UPDATE', 'Step added to workflow');
            });
        });

        describe('DELETE /workflows/:id - Delete Workflow', () => {
            test('should delete workflow and all steps', async () => {
                // Create temporary workflow
                const tempWorkflow = await axios.post(`${BASE_URL}/api/workflows`, {
                    workflowName: 'Temporary Workflow',
                    description: 'To be deleted',
                    buyerId: 1,
                    steps: [
                        { stepName: 'Step 1', order: 1, assignedRole: 'ADMIN' }
                    ]
                }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                const tempWorkflowId = tempWorkflow.data.workflowId;

                const response = await axios.delete(`${BASE_URL}/api/workflows/${tempWorkflowId}`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);

                // Verify deletion
                try {
                    await axios.get(`${BASE_URL}/api/workflows/${tempWorkflowId}`, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });
                    throw new Error('Workflow should be deleted');
                } catch (error) {
                    expect(error.response.status).toBe(404);
                }

                log('DELETE', 'Workflow deleted');
            });
        });
    });

    describe('Workflow Execution', () => {
        beforeAll(async () => {
            // Create a dedicated workflow for execution tests to avoid pollution from CRUD tests
            const workflowName = `Execution Test flow ${Date.now()}`;
            const response = await axios.post(`${BASE_URL}/api/workflows`, {
                workflowName: workflowName,
                description: 'For execution tests',
                buyerId: 1,
                steps: [
                    { stepName: 'Compliance Review', order: 1, assignedRole: 'COMPLIANCE_OFFICER', requiredActions: ['APPROVE', 'REJECT'] },
                    { stepName: 'Finance Review', order: 2, assignedRole: 'FINANCE_MANAGER', requiredActions: ['APPROVE', 'REJECT'] },
                    { stepName: 'Final Approval', order: 3, assignedRole: 'ADMIN', requiredActions: ['APPROVE', 'REJECT'] }
                ]
            }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });
            testWorkflowId = response.data.workflowId;
        });

        describe('POST /workflows/:id/execute - Start Execution', () => {
            test('should start workflow execution', async () => {
                const response = await axios.post(`${BASE_URL}/api/workflows/${testWorkflowId}/execute`, {
                    entityType: 'SUPPLIER',
                    entityId: testSupplierId,
                    initiatedBy: 1
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.executionId).toBeDefined();
                expect(response.data.currentStep).toBeDefined();
                expect(response.data.status).toBe('IN_PROGRESS');
                testExecutionId = response.data.executionId;

                log('EXECUTE', 'Workflow execution started', { executionId: testExecutionId });
            });

            test('should initialize first step as active', async () => {
                const response = await axios.get(`${BASE_URL}/api/executions/${testExecutionId}`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.currentStepOrder).toBe(1);
                expect(response.data.currentStepName).toBe('Compliance Review');
            });
        });

        describe('GET /executions - List Executions', () => {
            test('should list active executions', async () => {
                const response = await axios.get(`${BASE_URL}/api/executions?status=IN_PROGRESS`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(Array.isArray(response.data)).toBe(true);

                const ourExecution = response.data.find(e => e.executionId === testExecutionId);
                expect(ourExecution).toBeDefined();

                log('LIST', `Found ${response.data.length} active executions`);
            });

            test('should filter executions by user', async () => {
                const response = await axios.get(`${BASE_URL}/api/executions?assignedTo=1`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
            });

            test('should support pagination', async () => {
                const response = await axios.get(`${BASE_URL}/api/executions?page=1&pageSize=10`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.executions).toBeDefined();
                expect(response.data.total).toBeDefined();
            });
        });

        describe('POST /executions/:id/advance - Advance to Next Step', () => {
            test('should advance to next step on approval', async () => {
                const response = await axios.post(`${BASE_URL}/api/executions/${testExecutionId}/advance`, {
                    action: 'APPROVE',
                    comments: 'Compliance review passed'
                }, {
                    headers: { 'Authorization': `Bearer ${complianceToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.currentStepOrder).toBe(2);
                expect(response.data.currentStepName).toBe('Finance Review');

                log('ADVANCE', 'Workflow advanced to next step');
            });

            test('should record step completion history', async () => {
                const response = await axios.get(`${BASE_URL}/api/executions/${testExecutionId}/history`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(Array.isArray(response.data)).toBe(true);
                expect(response.data.length).toBeGreaterThan(0);

                const firstStep = response.data[0];
                expect(firstStep.action).toBe('APPROVE');
                expect(firstStep.completedBy).toBeDefined();

                log('HISTORY', 'Step completion history retrieved');
            });
        });

        describe('POST /executions/:id/assign - Assign Step to User', () => {
            test('should assign current step to specific user', async () => {
                const response = await axios.post(`${BASE_URL}/api/executions/${testExecutionId}/assign`, {
                    userId: 4
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.assignedTo).toBe(4);

                log('ASSIGN', 'Step assigned to user');
            });

            test('should verify assignee can complete step', async () => {
                // Verify the assigned user can now complete the step
                const response = await axios.post(`${BASE_URL}/api/executions/${testExecutionId}/advance`, {
                    action: 'APPROVE',
                    comments: 'Finance review passed'
                }, {
                    headers: { 'Authorization': `Bearer ${financeToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.currentStepOrder).toBe(3);
            });
        });

        describe('POST /executions/:id/complete - Complete Workflow', () => {
            test('should complete workflow after final step', async () => {
                const response = await axios.post(`${BASE_URL}/api/executions/${testExecutionId}/advance`, {
                    action: 'APPROVE',
                    comments: 'Final approval'
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.status).toBe('COMPLETED');
                expect(response.data.completedAt).toBeDefined();

                log('COMPLETE', 'Workflow completed successfully');
            });

            test('should not allow actions after completion', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/executions/${testExecutionId}/advance`, {
                        action: 'APPROVE',
                        comments: 'Should fail'
                    }, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                    expect(error.response.data.error).toContain('completed');
                }
            });
        });

        describe('POST /executions/:id/reject - Reject Workflow', () => {
            test('should reject workflow at any step', async () => {
                // Start new execution
                const newExecution = await axios.post(`${BASE_URL}/api/workflows/${testWorkflowId}/execute`, {
                    entityType: 'SUPPLIER',
                    entityId: testSupplierId,
                    initiatedBy: 1
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                const newExecutionId = newExecution.data.executionId;

                // Reject at first step
                const response = await axios.post(`${BASE_URL}/api/executions/${newExecutionId}/advance`, {
                    action: 'REJECT',
                    comments: 'Does not meet requirements'
                }, {
                    headers: { 'Authorization': `Bearer ${complianceToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.status).toBe('REJECTED');
                expect(response.data.rejectedAt).toBeDefined();

                log('REJECT', 'Workflow rejected');

                // Clean up
                await new Promise(r => db.run('DELETE FROM workflow_instances WHERE instanceId = $1', [newExecutionId], r));
            });
        });
    });

    describe('Workflow Templates', () => {
        describe('GET /workflows/templates - Get Templates', () => {
            test('should return predefined workflow templates', async () => {
                const response = await axios.get(`${BASE_URL}/api/workflows/templates`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(Array.isArray(response.data)).toBe(true);

                if (response.data.length > 0) {
                    const template = response.data[0];
                    expect(template.templateId).toBeDefined();
                    expect(template.name).toBeDefined();
                    expect(template.description).toBeDefined();
                    expect(template.steps).toBeDefined();

                    log('TEMPLATE', `Found ${response.data.length} templates`);
                }
            });
        });

        describe('POST /workflows/from-template - Create from Template', () => {
            test('should create workflow from template', async () => {
                // First get templates
                const templates = await axios.get(`${BASE_URL}/api/workflows/templates`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                if (templates.data.length > 0) {
                    const templateId = templates.data[0].templateId;

                    const response = await axios.post(`${BASE_URL}/api/workflows/from-template`, {
                        templateId: templateId,
                        workflowName: 'From Template',
                        buyerId: 1
                    }, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });

                    expect(response.status).toBe(200);
                    expect(response.data.workflowId).toBeDefined();
                    expect(response.data.workflowName).toBe('From Template');

                    log('TEMPLATE', 'Workflow created from template');

                    // Clean up
                    await new Promise(r => db.run('DELETE FROM workflow_steps WHERE workflowId = $1', [response.data.workflowId], r));
                    await new Promise(r => db.run('DELETE FROM workflow_instances WHERE workflowTemplateId = $1', [response.data.workflowId], r));
                    await new Promise(r => db.run('DELETE FROM workflows WHERE workflowId = $1', [response.data.workflowId], r));
                }
            });
        });
    });

    describe('Workflow Cloning', () => {
        test('POST /workflows/:id/clone - Clone existing workflow', async () => {
            const response = await axios.post(`${BASE_URL}/api/workflows/${testWorkflowId}/clone`, {
                workflowName: 'Cloned Workflow'
            }, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.workflowId).toBeDefined();
            expect(response.data.workflowName).toBe('Cloned Workflow');

            // Verify steps were copied
            const cloned = await axios.get(`${BASE_URL}/api/workflows/${response.data.workflowId}`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(cloned.data.steps.length).toBeGreaterThan(0);

            log('CLONE', 'Workflow cloned successfully');

            // Clean up
            await new Promise(r => db.run('DELETE FROM workflow_steps WHERE workflowId = $1', [response.data.workflowId], r));
            await new Promise(r => db.run('DELETE FROM workflow_instances WHERE workflowTemplateId = $1', [response.data.workflowId], r));
            await new Promise(r => db.run('DELETE FROM workflows WHERE workflowId = $1', [response.data.workflowId], r));
        });
    });

    describe('Workflow Statistics', () => {
        test('GET /workflows/:id/stats - Get workflow statistics', async () => {
            const response = await axios.get(`${BASE_URL}/api/workflows/${testWorkflowId}/stats`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.totalExecutions).toBeDefined();
            expect(response.data.completedExecutions).toBeDefined();
            expect(response.data.rejectedExecutions).toBeDefined();
            expect(response.data.avgCompletionTime).toBeDefined();

            log('STATS', 'Workflow statistics retrieved', response.data);
        });
    });
});

// Run tests if executed directly
if (require.main === module) {
    console.log('Running Workflow Engine Integration Tests...\n');
}

/**
 * Circle Management Integration Tests
 *
 * Tests for supplier circle management including:
 * - Circle CRUD operations
 * - Circle member management
 * - Circle workflow assignments
 * - Bulk operations
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8083';
const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

const generateToken = (user) => {
    return jwt.sign(
        {
            userId: user.userId || user.userid || user.USERID || user.id,
            username: user.username,
            role: user.role,
            buyerId: user.buyerId || user.buyerid || user.BUYERID,
            supplierId: user.supplierId || user.supplierid || user.SUPPLIERID,
            subRole: user.subRole || user.subrole
        },
        SECRET_KEY,
        { expiresIn: '1h' }
    );
};

function log(step, msg, data) {
    console.log(`[${step}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

let testCircleId = null;
let testSupplierId = null;

// Cleanup helper
async function cleanupTestData() {
    if (!db.run) return;

    // Clean up circle members
    if (testCircleId) {
        await new Promise(r => db.run('DELETE FROM circle_members WHERE circleId = $1', [testCircleId], r));
        await new Promise(r => db.run('DELETE FROM circles WHERE circleId = $1', [testCircleId], r));
    }

    // Clean up test supplier
    if (testSupplierId) {
        await new Promise(r => db.run('DELETE FROM supplier_change_items WHERE requestId IN (SELECT requestId FROM supplier_change_requests WHERE supplierId = $1)', [testSupplierId], r));
        await new Promise(r => db.run('DELETE FROM supplier_change_requests WHERE supplierId = $1', [testSupplierId], r));
        await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [testSupplierId], r));
    }

    testCircleId = null;
    testSupplierId = null;
}

describe('Circle Management Integration Tests', () => {
    let buyerAdminToken;
    let buyerUserToken;

    beforeAll(async () => {
        buyerAdminToken = generateToken({ userId: 1, role: 'BUYER', subRole: 'Admin', buyerId: 1 });
        buyerUserToken = generateToken({ userId: 2, role: 'BUYER', subRole: 'User', buyerId: 1 });

        // Create test supplier
        const supplierResponse = await axios.post(`${BASE_URL}/api/suppliers`, {
            legalName: `Circle Test Supplier ${Date.now()}`,
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

    describe('Circle CRUD Operations', () => {
        describe('POST /circles - Create Circle', () => {
            test('should create circle with valid data', async () => {
                const circleData = {
                    circleName: `Preferred Suppliers ${Date.now()}`,
                    description: 'Top-tier suppliers with excellent performance',
                    buyerId: 1
                };

                const response = await axios.post(`${BASE_URL}/api/circles`, circleData, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.circleId).toBeDefined();
                expect(response.data.circleName).toContain('Preferred Suppliers');
                testCircleId = response.data.circleId;

                log('CREATE', 'Circle created', { circleId: testCircleId });
            });

            test('should reject duplicate circle name', async () => {
                try {
                    // Re-use test circle data for duplication failure
                    const duplicateCircleResponse = await axios.get(`${BASE_URL}/api/circles/${testCircleId}`, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                    await axios.post(`${BASE_URL}/api/circles`, {
                        circleName: duplicateCircleResponse.data.circleName,
                        description: 'Duplicate name',
                        buyerId: 1
                    }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                    expect(error.response.data.error).toContain('already exists');

                    log('CREATE', 'Duplicate circle name rejected');
                }
            });

            test('should reject circle with empty name', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/circles`, {
                        circleName: '',
                        description: 'Test',
                        buyerId: 1
                    }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);

                    log('CREATE', 'Empty circle name rejected');
                }
            });

            test('should reject non-admin from creating circle', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/circles`, {
                        circleName: `User Circle ${Date.now()}`,
                        description: 'Should fail',
                        buyerId: 1
                    }, { headers: { 'Authorization': `Bearer ${buyerUserToken}` } });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(403);

                    log('CREATE', 'Non-admin rejected from creating circle');
                }
            });
        });

        describe('GET /circles - List Circles', () => {
            test('should list all circles for buyer', async () => {
                const response = await axios.get(`${BASE_URL}/api/circles`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(Array.isArray(response.data)).toBe(true);
                expect(response.data.length).toBeGreaterThan(0);

                const ourCircle = response.data.find(c => c.circleId === testCircleId);
                expect(ourCircle).toBeDefined();
                expect(ourCircle.circleName).toContain('Preferred Suppliers');

                log('LIST', `Found ${response.data.length} circles`);
            });

            test('should filter circles by buyerId', async () => {
                const response = await axios.get(`${BASE_URL}/api/circles?buyerId=1`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                response.data.forEach(circle => {
                    expect(circle.buyerId).toBe(1);
                });

                log('LIST', 'Circles filtered by buyerId');
            });
        });

        describe('GET /circles/:id - Get Circle Details', () => {
            test('should get circle by ID', async () => {
                const response = await axios.get(`${BASE_URL}/api/circles/${testCircleId}`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.circleId).toBe(testCircleId);
                expect(response.data.circleName).toContain('Preferred Suppliers');
                expect(response.data.memberCount).toBeDefined();

                log('GET', 'Circle details retrieved', response.data);
            });

            test('should return 404 for non-existent circle', async () => {
                try {
                    await axios.get(`${BASE_URL}/api/circles/999999`, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });
                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(404);
                }
            });
        });

        describe('PUT /circles/:id - Update Circle', () => {
            test('should update circle details', async () => {
                const updateData = {
                    circleName: `Elite Suppliers ${Date.now()}`,
                    description: 'Updated description'
                };

                const response = await axios.put(`${BASE_URL}/api/circles/${testCircleId}`, updateData, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.circleName).toContain('Elite Suppliers');

                log('UPDATE', 'Circle updated');
            });

            test('should reject update to duplicate name', async () => {
                // Create another circle first
                const anotherCircleName = `Another Circle ${Date.now()}`;
                const anotherCircle = await axios.post(`${BASE_URL}/api/circles`, {
                    circleName: anotherCircleName,
                    description: 'Test',
                    buyerId: 1
                }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                try {
                    await axios.put(`${BASE_URL}/api/circles/${testCircleId}`, {
                        circleName: anotherCircleName
                    }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);

                    // Clean up
                    await axios.delete(`${BASE_URL}/api/circles/${anotherCircle.data.circleId}`, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });
                }
            });
        });

        describe('DELETE /circles/:id - Delete Circle', () => {
            test('should delete circle and remove members', async () => {
                // Create a temporary circle to delete
                const tempCircle = await axios.post(`${BASE_URL}/api/circles`, {
                    circleName: `Temporary Circle ${Date.now()}`,
                    description: 'Will be deleted',
                    buyerId: 1
                }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                const tempCircleId = tempCircle.data.circleId;

                const response = await axios.delete(`${BASE_URL}/api/circles/${tempCircleId}`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);

                // Verify it's deleted
                try {
                    await axios.get(`${BASE_URL}/api/circles/${tempCircleId}`, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });
                    throw new Error('Circle should be deleted');
                } catch (error) {
                    expect(error.response.status).toBe(404);
                }

                log('DELETE', 'Circle deleted successfully');
            });
        });
    });

    describe('Circle Member Management', () => {
        describe('POST /circles/:id/suppliers - Add Supplier to Circle', () => {
            test('should add supplier to circle', async () => {
                const response = await axios.post(`${BASE_URL}/api/circles/${testCircleId}/suppliers`, {
                    supplierId: testSupplierId
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.message).toContain('added');

                log('MEMBER', 'Supplier added to circle');
            });

            test('should reject duplicate supplier addition', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/circles/${testCircleId}/suppliers`, {
                        supplierId: testSupplierId
                    }, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                    expect(error.response.data.error).toContain('already');
                }
            });

            test('should reject supplier from different buyer', async () => {
                // Create supplier for different buyer
                const otherSupplier = await axios.post(`${BASE_URL}/api/suppliers`, {
                    legalName: `Other Buyer Supplier ${Date.now()}`,
                    businessType: 'Corp',
                    country: 'SG',
                    isGstRegistered: true,
                    gstin: '123456789A'
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` } // Same buyer initially
                });

                // Update to different buyer (direct DB manipulation for test)
                const otherSupplierId = otherSupplier.data.supplierId;
                await new Promise(r => db.run('UPDATE suppliers SET buyerId = 2 WHERE supplierId = $1', [otherSupplierId], r));

                try {
                    await axios.post(`${BASE_URL}/api/circles/${testCircleId}/suppliers`, {
                        supplierId: otherSupplierId
                    }, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                    expect(error.response.data.error).toContain('buyer');

                    // Clean up
                    await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [otherSupplierId], r));
                }
            });
        });

        describe('GET /circles/:id/suppliers - List Circle Members', () => {
            test('should list all suppliers in circle', async () => {
                const response = await axios.get(`${BASE_URL}/api/circles/${testCircleId}/suppliers`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(Array.isArray(response.data)).toBe(true);
                expect(response.data.length).toBeGreaterThan(0);

                const ourSupplier = response.data.find(s => s.supplierId === testSupplierId);
                expect(ourSupplier).toBeDefined();

                log('MEMBER', `Found ${response.data.length} suppliers in circle`);
            });

            test('should support pagination', async () => {
                const response = await axios.get(`${BASE_URL}/api/circles/${testCircleId}/suppliers?page=1&pageSize=10`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.suppliers).toBeDefined();
                expect(response.data.total).toBeDefined();
                expect(response.data.page).toBeDefined();
            });
        });

        describe('DELETE /circles/:id/suppliers/:supplierId - Remove Supplier', () => {
            test('should remove supplier from circle', async () => {
                const response = await axios.delete(`${BASE_URL}/api/circles/${testCircleId}/suppliers/${testSupplierId}`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);

                // Verify removal
                const members = await axios.get(`${BASE_URL}/api/circles/${testCircleId}/suppliers`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                const supplier = members.data.find(s => s.supplierId === testSupplierId);
                expect(supplier).toBeUndefined();

                log('MEMBER', 'Supplier removed from circle');
            });
        });

        describe('POST /circles/:id/suppliers/bulk - Bulk Add Suppliers', () => {
            test('should add multiple suppliers to circle', async () => {
                // Create multiple test suppliers
                const suppliers = [];
                for (let i = 0; i < 3; i++) {
                    const supplier = await axios.post(`${BASE_URL}/api/suppliers`, {
                        legalName: `Bulk Test Supplier ${i} ${Date.now()}`,
                        businessType: 'LLC',
                        country: 'US',
                        isGstRegistered: false
                    }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

                    suppliers.push(supplier.data.supplierId);
                }

                const response = await axios.post(`${BASE_URL}/api/circles/${testCircleId}/suppliers/bulk`, {
                    supplierIds: suppliers
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.added).toBe(3);

                log('MEMBER', 'Bulk added 3 suppliers to circle');

                // Clean up
                for (const supplierId of suppliers) {
                    await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [supplierId], r));
                }
            });

            test('should handle partial failures in bulk add', async () => {
                const response = await axios.post(`${BASE_URL}/api/circles/${testCircleId}/suppliers/bulk`, {
                    supplierIds: [testSupplierId, 999999, 999998] // Mix of valid and invalid
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(207); // Multi-status
                expect(response.data.added).toBeGreaterThan(0);
                expect(response.data.failed).toBeGreaterThan(0);

                log('MEMBER', 'Bulk add handled partial failures');
            });
        });
    });

    describe('Circle Workflows', () => {
        let testWorkflowId;

        beforeAll(async () => {
            // Create a test workflow
            const workflow = await axios.post(`${BASE_URL}/api/workflows`, {
                workflowName: `Circle Approval Workflow ${Date.now()}`,
                description: 'Test workflow for circles',
                buyerId: 1,
                steps: [
                    { stepName: 'Review', order: 1, assignedRole: 'COMPLIANCE' },
                    { stepName: 'Approve', order: 2, assignedRole: 'ADMIN' }
                ]
            }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

            testWorkflowId = workflow.data.workflowId;
        });

        describe('POST /circles/:id/workflows - Assign Workflow', () => {
            test('should assign workflow to circle', async () => {
                const response = await axios.post(`${BASE_URL}/api/circles/${testCircleId}/workflows`, {
                    workflowId: testWorkflowId
                }, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);

                log('WORKFLOW', 'Workflow assigned to circle');
            });

            test('should reject duplicate workflow assignment', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/circles/${testCircleId}/workflows`, {
                        workflowId: testWorkflowId
                    }, {
                        headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                }
            });
        });

        describe('GET /circles/:id/workflows - Get Circle Workflows', () => {
            test('should list workflows assigned to circle', async () => {
                const response = await axios.get(`${BASE_URL}/api/circles/${testCircleId}/workflows`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                expect(Array.isArray(response.data)).toBe(true);

                const assignedWorkflow = response.data.find(w => w.workflowId === testWorkflowId);
                expect(assignedWorkflow).toBeDefined();

                log('WORKFLOW', 'Retrieved circle workflows');
            });
        });

        describe('DELETE /circles/:id/workflows/:workflowId - Remove Workflow', () => {
            test('should remove workflow from circle', async () => {
                const response = await axios.delete(`${BASE_URL}/api/circles/${testCircleId}/workflows/${testWorkflowId}`, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);

                log('WORKFLOW', 'Workflow removed from circle');
            });
        });
    });

    describe('Circle Statistics', () => {
        test('GET /circles/:id/stats - Get circle statistics', async () => {
            const response = await axios.get(`${BASE_URL}/api/circles/${testCircleId}/stats`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.memberCount).toBeDefined();
            expect(response.data.activeWorkflows).toBeDefined();
            expect(response.data.pendingApprovals).toBeDefined();

            log('STATS', 'Circle statistics retrieved', response.data);
        });
    });
});

// Run tests if executed directly
if (require.main === module) {
    console.log('Running Circle Management Integration Tests...\n');
}

/**
 * E2E Supplier Onboarding Integration Tests
 *
 * Tests the full lifecycle:
 * 1. Buyer invites Supplier
 * 2. Supplier accepts invite
 * 3. Supplier provides details (Profile, Address, Contact)
 * 4. Supplier submits profile
 * 5. Buyer requests rework
 * 6. Supplier resubmits
 * 7. Buyer approves
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8083';
const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

const generateToken = (user) => jwt.sign(user, SECRET_KEY, { expiresIn: '1h' });

function log(step, msg, data) {
    // console.log(`[${step}] ${msg}`);
}

let testSupplierId = null;
let testInvitationId = null;
let testSupplierEmail = `e2e_supplier_${Date.now()}@example.com`;
let testUserId = null;

async function cleanupE2E() {
    if (!db.run) return;
    if (testUserId) {
        await new Promise(r => db.run('DELETE FROM users WHERE userid = $1', [testUserId], r));
    }
    if (testInvitationId) {
        await new Promise(r => db.run('DELETE FROM invitations WHERE invitationid = $1', [testInvitationId], r));
    }
    if (testSupplierId) {
        await new Promise(r => db.run('DELETE FROM supplier_change_items WHERE requestId IN (SELECT requestId FROM supplier_change_requests WHERE supplierId = $1)', [testSupplierId], r));
        await new Promise(r => db.run('DELETE FROM supplier_change_requests WHERE supplierId = $1', [testSupplierId], r));
        await new Promise(r => db.run('DELETE FROM addresses WHERE supplierId = $1', [testSupplierId], r));
        await new Promise(r => db.run('DELETE FROM contacts WHERE supplierId = $1', [testSupplierId], r));
        await new Promise(r => db.run('DELETE FROM documents WHERE supplierId = $1', [testSupplierId], r));
        await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [testSupplierId], r));
    }
}

describe('Supplier E2E Onboarding Flow', () => {
    let buyerToken;
    let supplierToken;
    let inviteToken;

    beforeAll(() => {
        // Mock buyer account
        buyerToken = generateToken({ userId: 1, role: 'BUYER', subRole: 'Admin', buyerId: 1 });
    });

    afterAll(async () => {
        await cleanupE2E();
    });

    test('1. Buyer creates invitation', async () => {
        const payload = {
            email: testSupplierEmail,
            legalName: 'E2E Test Supplier Inc.',
            country: 'US',
            supplierType: 'SME',
            message: 'Please join our network.'
        };

        const response = await axios.post(`${BASE_URL}/api/invitations`, payload, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });

        expect(response.status).toBe(200);
        expect(response.data.invitationId).toBeDefined();
        expect(response.data.token).toBeDefined();

        testInvitationId = response.data.invitationId;
        inviteToken = response.data.token;
        log('INVITE', 'Invitation created', response.data);
    });

    test('2. Supplier accepts invitation', async () => {
        const payload = {
            companyName: 'E2E Test Supplier Inc. Accepted',
            password: 'Password123!',
            country: 'US',
            businessType: 'SME'
        };

        const response = await axios.post(`${BASE_URL}/api/invitations/accept?token=${inviteToken}`, payload);

        expect(response.status).toBe(200);
        expect(response.data.token).toBeDefined();
        expect(response.data.user).toBeDefined();
        expect(response.data.user.supplierId).toBeDefined();

        supplierToken = response.data.token;
        testSupplierId = response.data.user.supplierId;
        testUserId = response.data.user.userId;
    });

    test('3. Supplier provides Company Details', async () => {
        const payload = {
            legalName: 'E2E Test Supplier Inc. Updated',
            country: 'US',
            businessType: 'SME',
            website: 'https://e2etest.com',
            description: 'E2E test description',
            taxId: 'TX12345678'
        };

        const response = await axios.put(`${BASE_URL}/api/suppliers/${testSupplierId}`, payload, {
            headers: {
                'Authorization': `Bearer ${supplierToken}`,
                'X-Supplier-Id': testSupplierId
            }
        });

        expect(response.status).toBe(200);

        // Verify status remains DRAFT, we removed the auto-submit
        const getRes = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        expect(getRes.data.approvalStatus).toBe('DRAFT');
    });

    test('4. Supplier submits profile', async () => {
        const response = await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/reviews/submit`, {}, {
            headers: {
                'Authorization': `Bearer ${supplierToken}`,
                'X-Supplier-Id': testSupplierId
            }
        });

        expect(response.status).toBe(200);

        // Verify status is SUBMITTED
        const getRes = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        expect(getRes.data.approvalStatus).toBe('SUBMITTED');
    });

    test('5. Buyer requests Rework', async () => {
        // 1. First find the pending workflow task
        let tasksRes = await axios.get(`${BASE_URL}/api/approvals/pending`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        let task = tasksRes.data.find(t => t.supplierId === testSupplierId);
        expect(task).toBeDefined();

        const payload = {
            stepOrder: task.stepOrder,
            comments: 'Please update your tax ID.'
        };

        const response = await axios.post(`${BASE_URL}/api/approvals/${task.instanceId}/rework`, payload, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });

        expect(response.status).toBe(200);

        // Verify status is REWORK_REQUIRED
        const getRes = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        expect(getRes.data.approvalStatus).toBe('REWORK_REQUIRED');
    });

    test('6. Supplier resubmits profile', async () => {
        const updatePayload = { taxId: 'TX87654321' };
        await axios.put(`${BASE_URL}/api/suppliers/${testSupplierId}`, updatePayload, {
            headers: {
                'Authorization': `Bearer ${supplierToken}`,
                'X-Supplier-Id': testSupplierId
            }
        });

        const response = await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/reviews/submit`, {}, {
            headers: {
                'Authorization': `Bearer ${supplierToken}`,
                'X-Supplier-Id': testSupplierId
            }
        });

        expect(response.status).toBe(200);

        // Verify status is SUBMITTED
        const getRes = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        expect(getRes.data.approvalStatus).toBe('SUBMITTED');
    });

    test('7. Buyer rejects profile', async () => {
        let tasksRes = await axios.get(`${BASE_URL}/api/approvals/pending`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        let task = tasksRes.data.find(t => t.supplierId === testSupplierId);
        expect(task).toBeDefined();

        const payload = {
            stepOrder: task.stepOrder,
            comments: 'We no longer need these services.'
        };

        const response = await axios.post(`${BASE_URL}/api/approvals/${task.instanceId}/reject`, payload, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });

        expect(response.status).toBe(200);

        const getRes = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        expect(getRes.data.approvalStatus).toBe('REJECTED');
    });

    test('8. Buyer re-evaluates and Approves profile (Submit Again First)', async () => {
        // Supplier submits again after reject
        await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/reviews/submit`, {}, {
            headers: {
                'Authorization': `Bearer ${supplierToken}`,
                'X-Supplier-Id': testSupplierId
            }
        });

        let tasksRes = await axios.get(`${BASE_URL}/api/approvals/pending`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        let task = tasksRes.data.find(t => t.supplierId === testSupplierId);
        expect(task).toBeDefined();

        const payload = {
            stepOrder: task.stepOrder,
            comments: 'Actually, we do need it.'
        };

        const response = await axios.post(`${BASE_URL}/api/approvals/${task.instanceId}/approve`, payload, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });

        expect(response.status).toBe(200);

        const getRes = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        // Approving ONE step does NOT mean overall is approved if there are multiple steps.
        // Wait, the workflow has 1 step or 4 steps by default?
        // Let's just check the instance execution status or run approve until completion.

        let executionRes = await axios.get(`${BASE_URL}/api/executions/${task.instanceId}`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });

        // Approve any remaining steps
        while (executionRes.data && executionRes.data.status === 'PENDING') {
            const nextOrder = executionRes.data.currentStepOrder;
            await axios.post(`${BASE_URL}/api/approvals/${task.instanceId}/approve`, { stepOrder: nextOrder, comments: "Auto approve" }, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });
            executionRes = await axios.get(`${BASE_URL}/api/executions/${task.instanceId}`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });
        }

        const getFinal = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}`, {
            headers: { 'Authorization': `Bearer ${buyerToken}` }
        });
        expect(getFinal.data.approvalStatus).toBe('APPROVED');
    });
});

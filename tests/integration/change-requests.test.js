/**
 * Change Request Integration Tests
 *
 * Tests for supplier change request workflow including:
 * - Supplier triggering changes
 * - Buyer viewing pending requests
 * - Role-based visibility (Finance, Compliance, Procurement)
 * - Item-level approval/rejection
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

let testSupplierId = null;
let testRequestId = null;

// Cleanup helper
async function cleanupTestSupplier() {
    if (!testSupplierId || !db.run) return;

    await new Promise(r => db.run('DELETE FROM supplier_change_items WHERE requestId IN (SELECT requestId FROM supplier_change_requests WHERE supplierId = $1)', [testSupplierId], r));
    await new Promise(r => db.run('DELETE FROM supplier_change_requests WHERE supplierId = $1', [testSupplierId], r));
    await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [testSupplierId], r));
    testSupplierId = null;
    testRequestId = null;
}

describe('Change Request Integration Tests', () => {
    let buyerAdminToken;
    let buyerFinanceToken;
    let buyerComplianceToken;
    let buyerProcurementToken;
    let supplierToken;

    beforeAll(async () => {
        buyerAdminToken = generateToken({ userId: 100, role: 'BUYER', subRole: 'Admin', buyerId: 1 });
        buyerFinanceToken = generateToken({ userId: 101, role: 'BUYER', subRole: 'Finance Manager', buyerId: 1 });
        buyerComplianceToken = generateToken({ userId: 102, role: 'BUYER', subRole: 'Compliance Officer', buyerId: 1 });
        buyerProcurementToken = generateToken({ userId: 103, role: 'BUYER', subRole: 'Procurement', buyerId: 1 });
        supplierToken = generateToken({ userId: 200, role: 'SUPPLIER', supplierId: 999, buyerId: 1 });

        // Create test supplier
        const response = await axios.post(`${BASE_URL}/api/suppliers`, {
            legalName: 'Change Request Test Supplier',
            businessType: 'Corporation',
            country: 'US',
            isGstRegistered: false
        }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

        testSupplierId = response.data.supplierId;

        // Ensure supplier is APPROVED so updates trigger change requests
        await new Promise(r => db.run("UPDATE suppliers SET approvalStatus = 'APPROVED' WHERE supplierId = $1", [testSupplierId], r));

        supplierToken = generateToken({ userId: 200, role: 'SUPPLIER', supplierId: testSupplierId, buyerId: 1 });
        log('SETUP', `Created test supplier ${testSupplierId} and generated token`);
    });

    afterAll(async () => {
        await cleanupTestSupplier();
    });

    describe('Change Request Creation', () => {
        test('Supplier update triggers change request', async () => {
            const updateData = {
                legalName: 'Updated Supplier Name',
                bankName: 'New Bank Name',
                website: 'https://updated-website.com'
            };

            const response = await axios.put(`${BASE_URL}/api/suppliers/${testSupplierId}`, updateData, {
                headers: { 'Authorization': `Bearer ${supplierToken}` }
            });

            expect(response.status).toBe(200);
            log('CHANGE', 'Change request triggered by supplier update');
        });
    });

    describe('Buyer View - Pending Requests', () => {
        test('GET /change-requests/pending - Buyer admin sees all pending requests', async () => {
            const response = await axios.get(`${BASE_URL}/api/change-requests/pending`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            const ourRequest = response.data.find(r => r.supplierId == testSupplierId);
            expect(ourRequest).toBeDefined();
            testRequestId = ourRequest.requestId;

            log('VIEW', 'Buyer admin can see pending requests', {
                requestId: testRequestId,
                items: ourRequest.items.length
            });
        });

        test('GET /change-requests/:id - Get request details', async () => {
            const response = await axios.get(`${BASE_URL}/api/change-requests/${testRequestId}`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.requestId).toBe(testRequestId);
            expect(response.data.supplierId).toBe(testSupplierId);
            expect(response.data.items).toBeDefined();

            log('VIEW', 'Request details retrieved', {
                supplierName: response.data.supplierName,
                itemCount: response.data.items.length
            });
        });
    });

    describe('Role-Based Visibility', () => {
        test('Finance Manager sees bankName changes', async () => {
            const response = await axios.get(`${BASE_URL}/api/change-requests/pending`, {
                headers: { 'Authorization': `Bearer ${buyerFinanceToken}` }
            });

            expect(response.status).toBe(200);
            const ourRequest = response.data.find(r => r.requestId == testRequestId);

            const bankItem = ourRequest.items.find(i => i.fieldName === 'bankName');
            expect(bankItem).toBeDefined();

            log('ROLE', 'Finance Manager can see bankName');
        });

        test('Compliance Officer sees legalName changes', async () => {
            const response = await axios.get(`${BASE_URL}/api/change-requests/pending`, {
                headers: { 'Authorization': `Bearer ${buyerComplianceToken}` }
            });

            expect(response.status).toBe(200);
            const ourRequest = response.data.find(r => r.requestId == testRequestId);

            const legalItem = ourRequest.items.find(i => i.fieldName === 'legalName');
            expect(legalItem).toBeDefined();

            log('ROLE', 'Compliance Officer can see legalName');
        });

        test('Procurement sees website changes', async () => {
            const response = await axios.get(`${BASE_URL}/api/change-requests/pending`, {
                headers: { 'Authorization': `Bearer ${buyerProcurementToken}` }
            });

            expect(response.status).toBe(200);
            const ourRequest = response.data.find(r => r.requestId == testRequestId);

            const websiteItem = ourRequest.items.find(i => i.fieldName === 'website');
            expect(websiteItem).toBeDefined();

            log('ROLE', 'Procurement can see website');
        });
    });

    describe('Item-Level Actions', () => {
        test('POST /change-requests/items/:itemId/approve - Finance approves bank change', async () => {
            // First get the items to find the bankName itemId
            const listResponse = await axios.get(`${BASE_URL}/api/change-requests/pending`, {
                headers: { 'Authorization': `Bearer ${buyerFinanceToken}` }
            });

            const ourRequest = listResponse.data.find(r => r.requestId == testRequestId);
            const bankItem = ourRequest.items.find(i => i.fieldName === 'bankName');

            const response = await axios.post(`${BASE_URL}/api/change-requests/items/${bankItem.itemId}/approve`, {
                comments: 'Bank details verified'
            }, {
                headers: { 'Authorization': `Bearer ${buyerFinanceToken}` }
            });

            expect(response.status).toBe(200);
            log('APPROVE', 'Finance approved bankName change');
        });

        test('POST /change-requests/items/:itemId/reject - Compliance rejects legal name change', async () => {
            // First get the items to find the legalName itemId
            const listResponse = await axios.get(`${BASE_URL}/api/change-requests/pending`, {
                headers: { 'Authorization': `Bearer ${buyerComplianceToken}` }
            });

            const ourRequest = listResponse.data.find(r => r.requestId == testRequestId);
            const legalItem = ourRequest.items.find(i => i.fieldName === 'legalName');

            const response = await axios.post(`${BASE_URL}/api/change-requests/items/${legalItem.itemId}/reject`, {
                comments: 'Name change requires additional documentation'
            }, {
                headers: { 'Authorization': `Bearer ${buyerComplianceToken}` }
            });

            expect(response.status).toBe(200);
            log('REJECT', 'Compliance rejected legalName change');
        });

        test('POST /change-requests/items/:itemId/approve - Procurement approves website change', async () => {
            const listResponse = await axios.get(`${BASE_URL}/api/change-requests/pending`, {
                headers: { 'Authorization': `Bearer ${buyerProcurementToken}` }
            });

            const ourRequest = listResponse.data.find(r => r.requestId == testRequestId);
            const websiteItem = ourRequest.items.find(i => i.fieldName === 'website');

            const response = await axios.post(`${BASE_URL}/api/change-requests/items/${websiteItem.itemId}/approve`, {
                comments: 'Website update approved'
            }, {
                headers: { 'Authorization': `Bearer ${buyerProcurementToken}` }
            });

            expect(response.status).toBe(200);
            log('APPROVE', 'Procurement approved website change');
        });
    });

    describe('Request-Level Actions', () => {
        test('POST /change-requests/:id/approve - Full request approval', async () => {
            // Create another supplier for full approval test
            const response = await axios.post(`${BASE_URL}/api/suppliers`, {
                legalName: 'Full Approval Test Supplier',
                businessType: 'LLC',
                country: 'SG',
                isGstRegistered: true,
                gstin: '123456789A'
            }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

            const newSupplierId = response.data.supplierId;

            // Ensure supplier is APPROVED
            await new Promise(r => db.run("UPDATE suppliers SET approvalStatus = 'APPROVED' WHERE supplierId = $1", [newSupplierId], r));

            // Trigger change
            await axios.put(`${BASE_URL}/api/suppliers/${newSupplierId}`, {
                bankName: 'Updated Bank'
            }, { headers: { 'Authorization': `Bearer ${supplierToken}` } });

            // Get the request
            const pendingResponse = await axios.get(`${BASE_URL}/api/change-requests/pending`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            const newRequest = pendingResponse.data.find(r => r.supplierId == newSupplierId);

            // Approve entire request
            const approveResponse = await axios.post(`${BASE_URL}/api/change-requests/${newRequest.requestId}/approve`, {
                comments: 'All changes approved'
            }, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(approveResponse.status).toBe(200);
            log('APPROVE', 'Full request approved');

            // Cleanup
            await new Promise(r => db.run('DELETE FROM supplier_change_items WHERE requestId = $1', [newRequest.requestId], r));
            await new Promise(r => db.run('DELETE FROM supplier_change_requests WHERE requestId = $1', [newRequest.requestId], r));
            await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [newSupplierId], r));
        }, 15000);

        test('POST /change-requests/:id/reject - Full request rejection', async () => {
            const response = await axios.post(`${BASE_URL}/api/suppliers`, {
                legalName: 'Reject Test Supplier',
                businessType: 'Corporation',
                country: 'US',
                isGstRegistered: false
            }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

            const newSupplierId = response.data.supplierId;

            // Ensure supplier is APPROVED
            await new Promise(r => db.run("UPDATE suppliers SET approvalStatus = 'APPROVED' WHERE supplierId = $1", [newSupplierId], r));

            // Trigger change
            await axios.put(`${BASE_URL}/api/suppliers/${newSupplierId}`, {
                legalName: 'Rejected Name'
            }, { headers: { 'Authorization': `Bearer ${supplierToken}` } });

            // Get the request
            const pendingResponse = await axios.get(`${BASE_URL}/api/change-requests/pending`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            const newRequest = pendingResponse.data.find(r => r.supplierId == newSupplierId);

            // Reject entire request
            const rejectResponse = await axios.post(`${BASE_URL}/api/change-requests/${newRequest.requestId}/reject`, {
                comments: 'Changes not approved at this time'
            }, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(rejectResponse.status).toBe(200);
            log('REJECT', 'Full request rejected');

            // Cleanup
            await new Promise(r => db.run('DELETE FROM supplier_change_items WHERE requestId = $1', [newRequest.requestId], r));
            await new Promise(r => db.run('DELETE FROM supplier_change_requests WHERE requestId = $1', [newRequest.requestId], r));
            await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [newSupplierId], r));
        }, 15000);
    });

    describe('Supplier View - My Requests', () => {
        test('GET /change-requests/my-requests - Supplier sees own requests', async () => {
            const response = await axios.get(`${BASE_URL}/api/change-requests/my-requests`, {
                headers: { 'Authorization': `Bearer ${supplierToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            const ourRequest = response.data.find(r => r.supplierId == testSupplierId);
            expect(ourRequest).toBeDefined();

            log('SUPPLIER', 'Supplier can view own change requests', {
                requestCount: response.data.length
            });
        });
    });
});

// Run tests if executed directly
if (require.main === module) {
    console.log('Running Change Request Integration Tests...\n');
}

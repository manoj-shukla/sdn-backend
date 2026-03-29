/**
 * Supplier Integration Tests
 *
 * Tests for supplier CRUD operations, bulk upload, reviews, and sub-resources
 * (addresses, contacts, documents)
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

let testSupplierId = null;

// Cleanup helper
async function cleanupTestSupplier() {
    if (!testSupplierId || !db.run) return;

    await new Promise(r => db.run('DELETE FROM supplier_change_items WHERE requestId IN (SELECT requestId FROM supplier_change_requests WHERE supplierId = $1)', [testSupplierId], r));
    await new Promise(r => db.run('DELETE FROM supplier_change_requests WHERE supplierId = $1', [testSupplierId], r));
    await new Promise(r => db.run('DELETE FROM addresses WHERE supplierId = $1', [testSupplierId], r));
    await new Promise(r => db.run('DELETE FROM contacts WHERE supplierId = $1', [testSupplierId], r));
    await new Promise(r => db.run('DELETE FROM documents WHERE supplierId = $1', [testSupplierId], r));
    await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [testSupplierId], r));
    testSupplierId = null;
}

describe('Supplier Integration Tests', () => {
    let buyerToken;
    let supplierToken;
    let adminToken;

    beforeAll(() => {
        buyerToken = generateToken({ userId: 1, role: 'BUYER', subRole: 'Admin', buyerId: 1 });
        supplierToken = generateToken({ userId: 2, role: 'SUPPLIER', supplierId: 999 });
        adminToken = generateToken({ userId: 999, role: 'ADMIN', subRole: 'Admin' });
    });

    afterAll(async () => {
        await cleanupTestSupplier();
    });

    describe('Supplier CRUD Operations', () => {
        test('POST /suppliers - Create supplier', async () => {
            const supplierData = {
                legalName: 'Test Supplier Inc.',
                businessType: 'Corporation',
                country: 'US',
                isGstRegistered: false,
                website: 'https://testsupplier.com',
                description: 'A test supplier for integration testing'
            };

            const response = await axios.post(`${BASE_URL}/api/suppliers`, supplierData, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.supplierId).toBeDefined();
            testSupplierId = response.data.supplierId;

            log('CREATE', 'Supplier created', { supplierId: testSupplierId });
        });

        test('GET /suppliers/:id - Get supplier by ID', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.legalName).toBe('Test Supplier Inc.');
            expect(response.data.supplierId).toBe(testSupplierId);

            log('GET', 'Supplier retrieved', response.data);
        });

        test('PUT /suppliers/:id - Update supplier (triggers change request)', async () => {
            const updateData = {
                legalName: 'Test Supplier Inc. (Updated)',
                website: 'https://testsupplier-updated.com'
            };

            const response = await axios.put(`${BASE_URL}/api/suppliers/${testSupplierId}`, updateData, {
                headers: { 'Authorization': `Bearer ${supplierToken}` }
            });

            expect(response.status).toBe(200);
            log('UPDATE', 'Supplier updated', response.data);
        });

        test('GET /suppliers - List all suppliers (buyer)', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            expect(response.data.length).toBeGreaterThan(0);

            log('LIST', `Found ${response.data.length} suppliers`);
        });

        test('GET /suppliers - Admin should not access supplier list', async () => {
            try {
                await axios.get(`${BASE_URL}/api/suppliers`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });
                throw new Error('Admin should not be able to list suppliers');
            } catch (error) {
                expect(error.response.status).toBe(403);
                log('LIST', 'Admin correctly blocked from supplier list');
            }
        });
    });

    describe('Supplier Address Management', () => {
        let addressId;

        test('POST /suppliers/:id/addresses - Add address', async () => {
            const addressData = {
                addressType: 'BUSINESS',
                addressLine1: '123 Business Street',
                city: 'Test City',
                stateProvince: 'CA',
                postalCode: '90210',
                country: 'US',
                isPrimary: true
            };

            const response = await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/addresses`, addressData, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.addressId).toBeDefined();
            addressId = response.data.addressId;

            log('ADDRESS', 'Address created', { addressId });
        });

        test('GET /suppliers/:id/addresses - Get all addresses', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}/addresses`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            expect(response.data.length).toBeGreaterThan(0);
            expect(response.data[0].addressLine1).toBe('123 Business Street');

            log('ADDRESS', `Found ${response.data.length} addresses`);
        });
    });

    describe('Supplier Contact Management', () => {
        let contactId;

        test('POST /suppliers/:id/contacts - Add contact', async () => {
            const contactData = {
                contactType: 'PRIMARY',
                firstName: 'John',
                lastName: 'Doe',
                email: 'john.doe@testsupplier.com',
                phone: '+1-555-1234',
                isPrimary: true
            };

            const response = await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/contacts`, contactData, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.contactId).toBeDefined();
            contactId = response.data.contactId;

            log('CONTACT', 'Contact created', { contactId });
        });

        test('GET /suppliers/:id/contacts - Get all contacts', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}/contacts`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            expect(response.data.length).toBeGreaterThan(0);
            expect(response.data[0].email).toBe('john.doe@testsupplier.com');

            log('CONTACT', `Found ${response.data.length} contacts`);
        });
    });

    describe('Supplier Document Management', () => {
        test('GET /suppliers/:supplierId/documents - Get all documents', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}/documents`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            log('DOCUMENT', `Found ${response.data.length} documents`);
        });
    });

    describe('Supplier Review Workflow', () => {
        test('POST /suppliers/:supplierId/reviews/submit - Submit for review', async () => {
            const response = await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/reviews/submit`, {}, {
                headers: { 'Authorization': `Bearer ${supplierToken}` }
            });

            expect(response.status).toBe(200);
            log('REVIEW', 'Supplier submitted for review');
        });

        test('GET /suppliers/:supplierId/reviews - Get reviews', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}/reviews`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            log('REVIEW', `Found ${response.data.length} reviews`);
        });

        test('POST /suppliers/:supplierId/reviews/decide - Approve section', async () => {
            const sections = ['PROFILE', 'DOCUMENTS', 'FINANCE'];

            for (const section of sections) {
                const response = await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/reviews/decide`, {
                    decision: 'APPROVE',
                    section: section,
                    comments: 'Test approval'
                }, {
                    headers: { 'Authorization': `Bearer ${buyerToken}` }
                });

                expect(response.status).toBe(200);
                log('REVIEW', `Section ${section} approved`);
            }
        });
    });

    describe('Supplier Bulk Upload', () => {
        test('GET /suppliers/bulk-upload/template - Download template', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/bulk-upload/template`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` },
                responseType: 'arraybuffer'
            });

            expect(response.status).toBe(200);
            expect(response.headers['content-disposition']).toContain('attachment');
            expect(response.data).toBeInstanceOf(Buffer);

            log('BULK', 'Template downloaded');
        });

        test('POST /suppliers/bulk-upload - Requires admin or buyer admin', async () => {
            const regularUserToken = generateToken({ userId: 3, role: 'BUYER', subRole: 'User', buyerId: 1 });

            try {
                await axios.post(`${BASE_URL}/api/suppliers/bulk-upload`, {}, {
                    headers: { 'Authorization': `Bearer ${regularUserToken}` }
                });
                throw new Error('Regular user should not be able to bulk upload');
            } catch (error) {
                expect(error.response.status).toBe(403);
                log('BULK', 'Regular user correctly blocked from bulk upload');
            }
        });
    });

    describe('Supplier Messages', () => {
        test('GET /suppliers/:supplierId/messages - Get messages', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}/messages`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            log('MESSAGE', `Found ${response.data.length} messages`);
        });
    });
});

// Run tests if executed directly
if (require.main === module) {
    console.log('Running Supplier Integration Tests...\n');
}

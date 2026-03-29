/**
 * Messages & Documents Integration Tests
 *
 * Tests for:
 * - Message exchange between buyers and suppliers
 * - Document upload and management
 * - Document verification workflow
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8083';
const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

function log(step, msg, data) {
    console.log(`[${step}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

let testSupplierId = null;
let testMessageId = null;
let testDocumentId = null;
let updatedSupplierToken = null;

// Cleanup helper
async function cleanupTestData() {
    if (!testSupplierId || !db.run) return;

    await new Promise(r => db.run('DELETE FROM messages WHERE supplierId = $1', [testSupplierId], r));
    await new Promise(r => db.run('DELETE FROM documents WHERE supplierId = $1', [testSupplierId], r));
    await new Promise(r => db.run('DELETE FROM suppliers WHERE supplierId = $1', [testSupplierId], r));
    testSupplierId = null;
    testMessageId = null;
    testDocumentId = null;
}

describe('Messages Integration Tests', () => {
    let buyerToken;
    let supplierToken;

    beforeAll(async () => {
        buyerToken = jwt.sign({ userId: 1, role: 'BUYER', subRole: 'Admin', buyerId: 1 }, SECRET_KEY, { expiresIn: '1h' });
        supplierToken = jwt.sign({ userId: 2, role: 'SUPPLIER', supplierId: 999, buyerId: 1 }, SECRET_KEY, { expiresIn: '1h' });

        // Create test supplier
        const response = await axios.post(`${BASE_URL}/api/suppliers`, {
            legalName: 'Messages Test Supplier',
            businessType: 'LLC',
            country: 'US',
            isGstRegistered: false
        }, { headers: { 'Authorization': `Bearer ${buyerToken}` } });

        testSupplierId = response.data.supplierId;
        log('SETUP', `Created test supplier ${testSupplierId}`);
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    describe('Message Exchange', () => {
        test('POST /messages - Send message from buyer to supplier', async () => {
            const messageData = {
                supplierId: testSupplierId,
                subject: 'Welcome to our platform',
                content: 'Thank you for registering. Please complete your profile.',
                recipientRole: 'SUPPLIER',
                senderName: 'Test Buyer',
                priority: 'NORMAL'
            };

            const response = await axios.post(`${BASE_URL}/api/messages`, messageData, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.messageId).toBeDefined();
            testMessageId = response.data.messageId;

            log('MESSAGE', 'Message sent from buyer', { messageId: testMessageId });
        });

        test('GET /messages/supplier/:supplierId - Get supplier messages (buyer view)', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}/messages`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            expect(response.data.length).toBeGreaterThan(0);
            expect(response.data[0].subject).toBe('Welcome to our platform');

            log('MESSAGE', `Found ${response.data.length} messages`);
        });

        test('GET /suppliers/:supplierId/messages - Get messages (supplier view)', async () => {
            // Update supplier token to match testSupplierId
            updatedSupplierToken = jwt.sign(
                { userId: 2, role: 'SUPPLIER', supplierId: testSupplierId, buyerId: 1 },
                SECRET_KEY,
                { expiresIn: '1h' }
            );

            const response = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}/messages`, {
                headers: { 'Authorization': `Bearer ${updatedSupplierToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            expect(response.data.length).toBeGreaterThan(0);

            log('MESSAGE', 'Supplier retrieved messages');
        });

        test('POST /messages/:id/read - Mark message as read', async () => {
            const response = await axios.patch(`${BASE_URL}/api/messages/${testMessageId}/read`, {}, {
                headers: { 'Authorization': `Bearer ${updatedSupplierToken}` }
            });

            expect(response.status).toBe(200);
            log('MESSAGE', 'Message marked as read');
        });

        test('POST /messages - Send message with high priority', async () => {
            const messageData = {
                supplierId: testSupplierId,
                subject: 'URGENT: Document Required',
                content: 'Please upload your tax document within 24 hours.',
                recipientRole: 'SUPPLIER',
                senderName: 'Test Buyer',
                priority: 'HIGH'
            };

            const response = await axios.post(`${BASE_URL}/api/messages`, messageData, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.priority).toBe('HIGH');

            log('MESSAGE', 'High priority message sent');
        });
    });

    describe('Message Filtering and Search', () => {
        test('GET /messages - Filter by priority', async () => {
            const response = await axios.get(`${BASE_URL}/api/messages?priority=HIGH`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            log('MESSAGE', `Found ${response.data.length} high priority messages`);
        });

        test('GET /messages - Filter by read status', async () => {
            const response = await axios.get(`${BASE_URL}/api/messages?isRead=false`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            log('MESSAGE', `Found ${response.data.length} unread messages`);
        });
    });
});

describe('Documents Integration Tests', () => {
    let buyerToken;
    let supplierToken;

    beforeAll(async () => {
        buyerToken = jwt.sign({ userId: 1, role: 'BUYER', subRole: 'Admin', buyerId: 1 }, SECRET_KEY, { expiresIn: '1h' });
        supplierToken = jwt.sign({ userId: 2, role: 'SUPPLIER', supplierId: 998, buyerId: 1 }, SECRET_KEY, { expiresIn: '1h' });

        // Create test supplier
        const response = await axios.post(`${BASE_URL}/api/suppliers`, {
            legalName: 'Documents Test Supplier',
            businessType: 'Corporation',
            country: 'US',
            isGstRegistered: false
        }, { headers: { 'Authorization': `Bearer ${buyerToken}` } });

        testSupplierId = response.data.supplierId;
        log('SETUP', `Created test supplier ${testSupplierId}`);
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    describe('Document Upload', () => {
        test('POST /suppliers/:supplierId/documents - Upload document', async () => {
            // Create a test file
            const testFilePath = path.join(__dirname, 'test-document.pdf');
            fs.writeFileSync(testFilePath, 'Test document content');

            const form = new FormData();
            form.append('file', fs.createReadStream(testFilePath));
            form.append('documentType', 'TAX_DOCUMENT');
            form.append('documentName', 'Tax Certificate 2024');

            const response = await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/documents`, form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${buyerToken}`
                }
            });

            expect(response.status).toBe(200);
            expect(response.data.documentId).toBeDefined();
            testDocumentId = response.data.documentId;

            // Clean up test file
            fs.unlinkSync(testFilePath);

            log('DOCUMENT', 'Document uploaded', { documentId: testDocumentId });
        });

        test('GET /suppliers/:supplierId/documents - Get all documents', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/${testSupplierId}/documents`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            expect(response.data.length).toBeGreaterThan(0);

            log('DOCUMENT', `Found ${response.data.length} documents`);
        });

        test('GET /documents/:id - Get document by ID', async () => {
            const response = await axios.get(`${BASE_URL}/api/documents/${testDocumentId}`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.documentId).toBe(testDocumentId);
            expect(response.data.documentName).toBe('Tax Certificate 2024');

            log('DOCUMENT', 'Document details retrieved');
        });
    });

    describe('Document Verification', () => {
        test('PUT /documents/:id/verify - Verify document', async () => {
            const response = await axios.put(`${BASE_URL}/api/documents/${testDocumentId}/verify`, {
                verificationStatus: 'VERIFIED',
                verifiedBy: 1,
                comments: 'Document verified and valid'
            }, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.verificationStatus).toBe('VERIFIED');

            log('DOCUMENT', 'Document verified');
        });

        test('PUT /documents/:id/verify - Reject document', async () => {
            // Upload another document to reject
            const testFilePath = path.join(__dirname, 'test-document-2.pdf');
            fs.writeFileSync(testFilePath, 'Test document content 2');

            const form = new FormData();
            form.append('file', fs.createReadStream(testFilePath));
            form.append('documentType', 'INSURANCE');
            form.append('documentName', 'Insurance Certificate');

            const uploadResponse = await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/documents`, form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${buyerToken}`
                }
            });

            const newDocId = uploadResponse.data.documentId;
            fs.unlinkSync(testFilePath);

            const response = await axios.put(`${BASE_URL}/api/documents/${newDocId}/verify`, {
                verificationStatus: 'REJECTED',
                verifiedBy: 1,
                comments: 'Document expired, please upload current version'
            }, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.verificationStatus).toBe('REJECTED');

            log('DOCUMENT', 'Document rejected');
        });
    });

    describe('Document Types', () => {
        const documentTypes = [
            'TAX_DOCUMENT',
            'INSURANCE',
            'BUSINESS_LICENSE',
            'CERTIFICATE_OF_INCORPORATION',
            'BANK_STATEMENT',
            'OTHER'
        ];

        test('Upload documents of various types', async () => {
            for (const type of documentTypes.slice(0, 2)) { // Test 2 types for brevity
                const testFilePath = path.join(__dirname, `test-${type.toLowerCase()}.pdf`);
                fs.writeFileSync(testFilePath, `Test ${type} content`);

                const form = new FormData();
                form.append('file', fs.createReadStream(testFilePath));
                form.append('documentType', type);
                form.append('documentName', `${type} Document`);

                const response = await axios.post(`${BASE_URL}/api/suppliers/${testSupplierId}/documents`, form, {
                    headers: {
                        ...form.getHeaders(),
                        'Authorization': `Bearer ${buyerToken}`
                    }
                });

                expect(response.status).toBe(200);
                fs.unlinkSync(testFilePath);
            }

            log('DOCUMENT', 'Multiple document types uploaded');
        });

        test('GET /suppliers/:supplierId/documents?documentType=TAX_DOCUMENT - Filter by type', async () => {
            const response = await axios.get(
                `${BASE_URL}/api/suppliers/${testSupplierId}/documents?documentType=TAX_DOCUMENT`,
                { headers: { 'Authorization': `Bearer ${buyerToken}` } }
            );

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            response.data.forEach(doc => {
                expect(doc.documentType).toBe('TAX_DOCUMENT');
            });

            log('DOCUMENT', `Found ${response.data.length} tax documents`);
        });
    });

    describe('Document Expiry Tracking', () => {
        test('POST /documents/:id/expiry - Set document expiry', async () => {
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);

            const response = await axios.post(`${BASE_URL}/api/documents/${testDocumentId}/expiry`, {
                expiryDate: expiryDate.toISOString()
            }, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.expiryDate).toBeDefined();

            log('DOCUMENT', 'Document expiry set', { expiryDate: response.data.expiryDate });
        });

        test('GET /documents/expiring - Get expiring documents', async () => {
            const response = await axios.get(`${BASE_URL}/api/documents/expiring?days=30`, {
                headers: { 'Authorization': `Bearer ${buyerToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            log('DOCUMENT', `Found ${response.data.length} expiring documents`);
        });
    });
});

// Run tests if executed directly
if (require.main === module) {
    console.log('Running Messages & Documents Integration Tests...\n');
}

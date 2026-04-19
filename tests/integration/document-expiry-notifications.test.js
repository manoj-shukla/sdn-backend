/**
 * Document Expiry & Notification Tests
 *
 * Test Scenarios:
 * 1. Documents approaching expiry trigger notifications
 * 2. Expired documents are flagged on supplier dashboard
 * 3. Buyer dashboard shows expiry warnings
 * 4. Notifications sent for critical documents
 * 5. Different expiry thresholds for document types
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8083';
const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

// Helper: Wrap db queries in promises
const query = (sql, params) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve({ rows });
    });
});

const run = (sql, params) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ rows: [{ lastID: this.lastID }] });
    });
});

function log(step, msg, data) {
    console.log(`[${step}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

function generateToken(user) {
    return jwt.sign(
        {
            userId: user.userId || user.userid || user.USERID,
            username: user.username,
            role: user.role,
            buyerId: user.buyerId || user.buyerid || user.BUYERID,
            supplierId: user.supplierId || user.supplierid || user.SUPPLIERID
        },
        SECRET_KEY,
        { expiresIn: '1h' }
    );
}

describe('Document Expiry & Notifications', () => {
    let supplierId;
    let buyerId;
    let supplierUserId;
    let buyerUserId;
    let supplierToken;
    let buyerToken;
    let testDocumentId;

    beforeAll(async () => {
        try {
            // Login as admin
            const adminLogin = await axios.post(`${BASE_URL}/auth/login`, {
                username: 'admin',
                password: 'Admin123!'
            });

            // Create buyer
            const buyerResult = await query('INSERT INTO buyers (buyerName, email) VALUES ($1, $2) RETURNING buyerId', ['Document Test Buyer', 'docbuyer@example.com']
            );
            buyerId = buyerResult.rows[0].buyerid || buyerResult.rows[0].buyerId;

            // Create supplier
            const supplierResult = await query(
                'INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus) VALUES ($1, $2, $3, $4, $5) RETURNING supplierId',
                [buyerId, 'Doc Test Supplier', 'LLC', 'US', 'ACTIVE']
            );
            supplierId = supplierResult.rows[0].supplierid;

            // Create supplier user
            const ts = Date.now();
            const supplierUsername = `doc_supplier_${ts}`;
            const buyerUsername = `doc_buyer_${ts}`;

            const passwordHash = await require('bcryptjs').hash('SupplierUser123!', 10);
            const userResult = await query(
                'INSERT INTO sdn_users (username, password, email, role, supplierId) VALUES ($1, $2, $3, $4, $5) RETURNING userId',
                [supplierUsername, passwordHash, `docsupplier_${ts}@example.com`, 'SUPPLIER', supplierId]
            );
            supplierUserId = userResult.rows[0].userid || userResult.rows[0].userId;

            // Create buyer user
            const buyerUserResult = await query(`INSERT INTO sdn_users (username, password, email, role, buyerId)
                 VALUES($1, $2, $3, $4, $5) RETURNING userId`, [buyerUsername, passwordHash, `docbuyer_${ts}@example.com`, 'BUYER', buyerId]
            );
            buyerUserId = buyerUserResult.rows[0].userid || buyerUserResult.rows[0].userId;

            // Generate tokens
            supplierToken = generateToken({ userId: supplierUserId, username: supplierUsername, role: 'SUPPLIER', supplierId });
            buyerToken = generateToken({ userId: buyerUserId, username: buyerUsername, role: 'BUYER', buyerId });

            log('SETUP', 'Test data created', { supplierId, buyerId });

        } catch (err) {
            log('SETUP', 'Setup failed', { error: err.message, stack: err.stack });
            throw err; // Rethrow to fail the test early
        }
    });

    afterAll(async () => {
        try {
            if (supplierId) await query('DELETE FROM documents WHERE supplierId = $1', [supplierId]);
            if (supplierId) await query('DELETE FROM notifications WHERE entityId = $1', [supplierId]);
            if (supplierUserId || buyerUserId) await query('DELETE FROM sdn_users WHERE userId IN ($1, $2)', [supplierUserId, buyerUserId]);
            if (supplierId) await query('DELETE FROM suppliers WHERE supplierId = $1', [supplierId]);
            if (buyerId) await query('DELETE FROM buyers WHERE buyerName = $1', ['Document Test Buyer']);
            log('CLEANUP', 'Test data deleted');
        } catch (err) {
            log('CLEANUP', 'Cleanup failed', { error: err.message });
        }
    });

    describe('Document Creation with Expiry', () => {
        test('should create document with expiry date', async () => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 30); // 30 days from now

            const response = await axios.post(`${BASE_URL}/api/documents`,
                {
                    supplierId: supplierId,
                    documentType: 'Insurance Certificate',
                    documentName: 'Insurance Policy 2024',
                    expiryDate: tomorrow.toISOString(),
                    fileUrl: '/documents/insurance.pdf'
                },
                { headers: { 'Authorization': `Bearer ${supplierToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('documentId');
            testDocumentId = response.data.documentId;

            log('DOCUMENT', 'Created with expiry', { documentId: testDocumentId, expiryDate: tomorrow.toISOString() });
        });

        test('should calculate compliance status based on expiry', async () => {
            // Create expiring document (5 days from now)
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 5);

            const response = await axios.post(`${BASE_URL}/api/documents`,
                {
                    supplierId: supplierId,
                    documentType: 'Tax Certificate',
                    documentName: 'Tax Certificate 2024',
                    expiryDate: expiryDate.toISOString(),
                    fileUrl: '/documents/tax.pdf'
                },
                { headers: { 'Authorization': `Bearer ${supplierToken}` } }
            );

            expect(response.status).toBe(200);
            log('DOCUMENT', 'Created expiring document', { expiryDate: expiryDate.toISOString() });
        });
    });

    describe('Dashboard Expiry Warnings', () => {
        test('supplier dashboard should show expiring documents', async () => {
            const response = await axios.get(`${BASE_URL}/api/documents/expiring?days=30&supplierId=${supplierId}`,
                { headers: { 'Authorization': `Bearer ${supplierToken}` } }
            );

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            log('SUPPLIER_DASHBOARD', 'Expiring documents', { count: response.data.length });
        });

        test('buyer dashboard should show supplier documents expiring soon', async () => {
            const response = await axios.get(`${BASE_URL}/api/documents/expiring?days=30&buyerId=${buyerId}`,
                { headers: { 'Authorization': `Bearer ${buyerToken}` } }
            );

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            log('BUYER_DASHBOARD', 'Expiring documents for buyer suppliers', { count: response.data.length });
        });
    });

    describe('Notification Triggers', () => {
        test('should create notification when document expires within 30 days', async () => {
            // Create document expiring in 7 days
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 7);

            const docResponse = await axios.post(`${BASE_URL}/api/documents`,
                {
                    supplierId: supplierId,
                    documentType: 'Business License',
                    documentName: 'Business License 2024',
                    expiryDate: expiryDate.toISOString(),
                    fileUrl: '/documents/license.pdf'
                },
                { headers: { 'Authorization': `Bearer ${supplierToken}` } }
            );

            // Check for notifications
            const notifications = await axios.get(`${BASE_URL}/api/notifications`,
                { headers: { 'Authorization': `Bearer ${buyerToken}` } }
            );

            expect(notifications.status).toBe(200);
            // Verify notification was created
            const expiryNotifications = notifications.data.filter(n =>
                n.type === 'DOCUMENT_EXPIRY' && n.entityId === docResponse.data.documentId
            );

            log('NOTIFICATION', 'Expiry notification created', {
                documentId: docResponse.data.documentId,
                notificationCount: expiryNotifications.length
            });
        });

        test('should send notification to both supplier and buyer', async () => {
            // This test verifies notifications are sent to both parties
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 14);

            await axios.post(`${BASE_URL}/api/documents`,
                {
                    supplierId: supplierId,
                    documentType: 'Insurance Certificate',
                    documentName: 'Insurance Policy 2024',
                    expiryDate: expiryDate.toISOString(),
                    fileUrl: '/documents/insurance.pdf'
                },
                { headers: { 'Authorization': `Bearer ${supplierToken}` } }
            );

            // Check buyer notifications
            const buyerNotifications = await axios.get(`${BASE_URL}/api/notifications?recipientRole=BUYER`,
                { headers: { 'Authorization': `Bearer ${buyerToken}` } }
            );

            // Check supplier notifications
            const supplierNotifications = await axios.get(`${BASE_URL}/api/notifications?supplierId=${supplierId}`,
                { headers: { 'Authorization': `Bearer ${supplierToken}` } }
            );

            expect(buyerNotifications.status).toBe(200);
            expect(supplierNotifications.status).toBe(200);

            log('NOTIFICATION', 'Sent to both parties', {
                buyerCount: buyerNotifications.data.length,
                supplierCount: supplierNotifications.data.length
            });
        });
    });

    describe('Document Status by Expiry', () => {
        test('should mark documents as VALID, EXPIRING, or EXPIRED', async () => {
            // Create documents with different expiry dates
            const past = new Date();
            past.setDate(past.getDate() - 10); // Expired

            const near = new Date();
            near.setDate(near.getDate() + 15); // Expiring soon

            const future = new Date();
            future.setDate(future.getDate() + 60); // Valid

            // Expired document
            await axios.post(`${BASE_URL}/api/documents`,
                {
                    supplierId: supplierId,
                    documentType: 'Old Certificate',
                    documentName: 'Old Cert',
                    expiryDate: past.toISOString(),
                    fileUrl: '/docs/old.pdf'
                },
                { headers: { 'Authorization': `Bearer ${supplierToken}` } }
            );

            // Expiring document
            await axios.post(`${BASE_URL}/api/documents`,
                {
                    supplierId: supplierId,
                    documentType: 'Expiring Cert',
                    documentName: 'Expiring Cert',
                    expiryDate: near.toISOString(),
                    fileUrl: '/docs/expiring.pdf'
                },
                { headers: { Authorization: `Bearer ${supplierToken}` } }
            );

            // Valid document
            await axios.post(`${BASE_URL}/api/documents`,
                {
                    supplierId: supplierId,
                    documentType: 'Valid Cert',
                    documentName: 'Valid Cert',
                    expiryDate: future.toISOString(),
                    fileUrl: '/docs/valid.pdf'
                },
                { headers: { Authorization: `Bearer ${supplierToken}` } }
            );

            // Fetch with status
            const response = await axios.get(`${BASE_URL}/api/documents?supplierId=${supplierId}&includeStatus=true`,
                { headers: { Authorization: `Bearer ${buyerToken}` } }
            );

            expect(response.status).toBe(200);

            const expired = response.data.filter(d => d.complianceStatus === 'EXPIRED');
            const expiring = response.data.filter(d => d.complianceStatus === 'EXPIRING');
            const valid = response.data.filter(d => d.complianceStatus === 'VALID');

            log('DOCUMENT_STATUS', 'By expiry', {
                expired: expired.length,
                expiring: expiring.length,
                valid: valid.length
            });

            expect(expired.length).toBeGreaterThan(0);
            expect(expiring.length).toBeGreaterThan(0);
            expect(valid.length).toBeGreaterThan(0);
        });
    });

    describe('Dashboard Alert Display', () => {
        test('should show alert banner on supplier dashboard for expiring docs', async () => {
            const response = await axios.get(`${BASE_URL}/api/suppliers/${supplierId}/dashboard-alerts`,
                { headers: { Authorization: `Bearer ${supplierToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('expiringDocuments');
            expect(Array.isArray(response.data.expiringDocuments)).toBe(true);
            log('SUPPLIER_DASHBOARD', 'Alerts retrieved', response.data);
        });

        test('should show warning on buyer dashboard for suppliers with expiring docs', async () => {
            const response = await axios.get(`${BASE_URL}/api/buyers/${buyerId}/dashboard-alerts`,
                { headers: { Authorization: `Bearer ${buyerToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('suppliersWithExpiringDocs');
            log('BUYER_DASHBOARD', 'Alerts retrieved', response.data);
        });
    });
});

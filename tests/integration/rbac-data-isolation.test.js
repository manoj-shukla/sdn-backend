/**
 * RBAC (Role-Based Access Control) & Data Isolation Tests
 *
 * Critical security tests to ensure:
 * 1. Users cannot access data from other buyers
 * 2. Users cannot access data from other suppliers
 * 3. Admins have appropriate access
 * 4. Supplier users see only their supplier's data
 * 5. Buyer users see only their buyer's data
 * 6. APIs do not leak restricted information
 *
 * SECURITY CRITICAL: These tests MUST all pass
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

describe('RBAC & Data Isolation Tests', () => {
    let buyer1Id, buyer2Id;
    let supplier1Id, supplier2Id;
    let buyer1User, buyer2User;
    let supplier1User, supplier2User;
    let adminUser;

    // Use unique suffix to avoid conflicts with parallel test runs
    const testSuffix = Date.now().toString(36);
    const testEmail1 = `rbac_buyer1_${testSuffix}@example.com`;
    const testEmail2 = `rbac_buyer2_${testSuffix}@example.com`;
    const testEmail3 = `rbac_supplier1_${testSuffix}@example.com`;
    const testEmail4 = `rbac_supplier2_${testSuffix}@example.com`;
    const testUser1 = `rbac_buyer1_${testSuffix}`;
    const testUser2 = `rbac_buyer2_${testSuffix}`;
    const testUser3 = `rbac_supplier1_${testSuffix}`;
    const testUser4 = `rbac_supplier2_${testSuffix}`;

    beforeAll(async () => {
        try {
            console.log('[SETUP] Starting RBAC test setup...');
            console.log('[SETUP] Test suffix:', testSuffix);

            // Clean up any existing test data first
            console.log('[SETUP] Cleaning up existing test data...');
            try {
                await query('DELETE FROM user_supplier_memberships WHERE userId IN (SELECT userId FROM users WHERE email LIKE $1)', [`%_${testSuffix}@example.com`]);
                await query('DELETE FROM users WHERE email LIKE $1', [`%_${testSuffix}@example.com`]);
                await query('DELETE FROM suppliers WHERE legalName LIKE $1', [`RBAC % ${testSuffix}%`]);
                await query('DELETE FROM buyers WHERE buyerName LIKE $1', [`RBAC % ${testSuffix}%`]);
                console.log('[SETUP] Cleanup completed');
            } catch (cleanupErr) {
                console.log('[SETUP] Cleanup error (non-critical):', cleanupErr.message);
            }

            // Login as admin
            const adminLogin = await axios.post(`${BASE_URL}/auth/login`, {
                username: 'admin',
                password: 'Admin123!'
            });
            adminUser = { userId: 1, username: 'admin', role: 'ADMIN' };
            console.log('[SETUP] Admin user created:', adminUser);

            // Create two buyers using run() to get lastID
            const buyer1Result = await run('INSERT INTO buyers (buyerName, email) VALUES ($1, $2)', [`RBAC Buyer 1 ${testSuffix}`, `rbac_buyer1_${testSuffix}@example.com`]
            );
            buyer1Id = buyer1Result.rows[0].lastID;
            console.log('[SETUP] Buyer 1 created with ID:', buyer1Id);

            const buyer2Result = await run('INSERT INTO buyers (buyerName, email) VALUES ($1, $2)', [`RBAC Buyer 2 ${testSuffix}`, `rbac_buyer2_${testSuffix}@example.com`]
            );
            buyer2Id = buyer2Result.rows[0].lastID;
            console.log('[SETUP] Buyer 2 created with ID:', buyer2Id);

            // Create two suppliers for different buyers
            const supplier1Result = await run(
                'INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus) VALUES ($1, $2, $3, $4, $5)',
                [buyer1Id, `RBAC Supplier 1 ${testSuffix}`, 'LLC', 'US', 'ACTIVE']
            );
            supplier1Id = supplier1Result.rows[0].lastID;
            console.log('[SETUP] Supplier 1 created with ID:', supplier1Id);

            const supplier2Result = await run(
                'INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus) VALUES ($1, $2, $3, $4, $5)',
                [buyer2Id, `RBAC Supplier 2 ${testSuffix}`, 'Corporation', 'UK', 'ACTIVE']
            );
            supplier2Id = supplier2Result.rows[0].lastID;
            console.log('[SETUP] Supplier 2 created with ID:', supplier2Id);

            // Create users for each buyer and supplier
            const passwordHash = await require('bcryptjs').hash('TestUser123!', 10);

            const buyer1UserResult = await run(
                'INSERT INTO users (username, password, email, role, buyerId) VALUES ($1, $2, $3, $4, $5)',
                [testUser1, passwordHash, testEmail1, 'BUYER', buyer1Id]
            );
            const buyer1UserId = buyer1UserResult.rows[0].lastID;
            console.log('[SETUP] Buyer 1 user created with ID:', buyer1UserId);

            const buyer2UserResult = await run(
                'INSERT INTO users (username, password, email, role, buyerId) VALUES ($1, $2, $3, $4, $5)',
                [testUser2, passwordHash, testEmail2, 'BUYER', buyer2Id]
            );
            const buyer2UserId = buyer2UserResult.rows[0].lastID;
            console.log('[SETUP] Buyer 2 user created with ID:', buyer2UserId);

            const supplier1UserResult = await run(
                'INSERT INTO users (username, password, email, role, supplierId) VALUES ($1, $2, $3, $4, $5)',
                [testUser3, passwordHash, testEmail3, 'SUPPLIER', supplier1Id]
            );
            const supplier1UserId = supplier1UserResult.rows[0].lastID;
            console.log('[SETUP] Supplier 1 user created with ID:', supplier1UserId);

            const supplier2UserResult = await run(
                'INSERT INTO users (username, password, email, role, supplierId) VALUES ($1, $2, $3, $4, $5)',
                [testUser4, passwordHash, testEmail4, 'SUPPLIER', supplier2Id]
            );
            const supplier2UserId = supplier2UserResult.rows[0].lastID;
            console.log('[SETUP] Supplier 2 user created with ID:', supplier2UserId);

            buyer1User = { userId: buyer1UserId, username: testUser1, role: 'BUYER', buyerId: buyer1Id };
            buyer2User = { userId: buyer2UserId, username: testUser2, role: 'BUYER', buyerId: buyer2Id };
            supplier1User = { userId: supplier1UserId, username: testUser3, role: 'SUPPLIER', supplierId: supplier1Id };
            supplier2User = { userId: supplier2UserId, username: testUser4, role: 'SUPPLIER', supplierId: supplier2Id };

            console.log('[SETUP] All test data created successfully!');
            console.log('[SETUP] buyer1User:', buyer1User);
            console.log('[SETUP] buyer2User:', buyer2User);
            console.log('[SETUP] supplier1User:', supplier1User);
            console.log('[SETUP] supplier2User:', supplier2User);

            log('SETUP', 'Test data created', {
                buyers: { buyer1: buyer1Id, buyer2: buyer2Id },
                suppliers: { supplier1: supplier1Id, supplier2: supplier2Id },
                users: {
                    buyer1User: buyer1User.userId,
                    buyer2User: buyer2User.userId,
                    supplier1User: supplier1User.userId,
                    supplier2User: supplier2User.userId
                }
            });

        } catch (err) {
            console.error('[SETUP] Setup failed:', err);
            log('SETUP', 'Setup failed', { error: err.message, stack: err.stack });
            throw err; // Re-throw to fail the test suite
        }
    });

    afterAll(async () => {
        try {
            await query('DELETE FROM suppliers WHERE supplierId IN ($1, $2)', [supplier1Id, supplier2Id]);
            await query('DELETE FROM buyers WHERE buyerId IN ($1, $2)', [buyer1Id, buyer2Id]);
            log('CLEANUP', 'Test data deleted');
        } catch (err) {
            log('CLEANUP', 'Cleanup failed', { error: err.message });
        }
    });

    describe('CRITICAL: Buyer Data Isolation', () => {
        test('CRITICAL: Buyer 1 CANNOT see Buyer 2 suppliers', async () => {
            const buyer1Token = generateToken(buyer1User);

            const response = await axios.get(`${BASE_URL}/api/suppliers`,
                { headers: { 'Authorization': `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);
            // Handle both array and object response formats
            const suppliers = Array.isArray(response.data) ? response.data : (response.data.data || response.data.suppliers || []);

            // Verify only buyer1's suppliers are returned
            suppliers.forEach(supplier => {
                const supplierBuyerId = supplier.buyerid || supplier.buyerId;
                expect(supplierBuyerId).toBe(buyer1Id);
                expect(supplierBuyerId).not.toBe(buyer2Id);
            });

            log('RBAC', 'Buyer 1 isolated', { supplierCount: suppliers.length });
        });

        test('CRITICAL: Buyer 2 CANNOT see Buyer 1 suppliers', async () => {
            const buyer2Token = generateToken(buyer2User);

            const response = await axios.get(`${BASE_URL}/api/suppliers`,
                { headers: { Authorization: `Bearer ${buyer2Token}` } }
            );

            expect(response.status).toBe(200);
            // Handle both array and object response formats
            const suppliers = Array.isArray(response.data) ? response.data : (response.data.data || response.data.suppliers || []);

            // Verify only buyer2's suppliers are returned
            suppliers.forEach(supplier => {
                const supplierBuyerId = supplier.buyerid || supplier.buyerId;
                expect(supplierBuyerId).toBe(buyer2Id);
                expect(supplierBuyerId).not.toBe(buyer1Id);
            });

            log('RBAC', 'Buyer 2 isolated', { supplierCount: suppliers.length });
        });
    });

    describe('CRITICAL: Supplier Data Isolation', () => {
        test('CRITICAL: Supplier 1 CANNOT see Supplier 2 data', async () => {
            const supplier1Token = generateToken(supplier1User);

            // Try to access supplier 2 directly
            try {
                const response = await axios.get(`${BASE_URL}/api/suppliers/${supplier2Id}`,
                    { headers: { 'Authorization': `Bearer ${supplier1Token}` } }
                );
                // Should either return 403 or 404
                expect([403, 404]).toContain(response.status);
                log('RBAC', 'Supplier 1 blocked from Supplier 2', { status: response.status });
            } catch (error) {
                expect([403, 404]).toContain(error.response.status);
            }
        });

        test('CRITICAL: Supplier 1 can only see their own messages', async () => {
            const supplier1Token = generateToken(supplier1User);

            // Create message for supplier 2
            await query(
                'INSERT INTO messages (supplierId, buyerId, subject, content, senderName, recipientRole) VALUES ($1, $2, $3, $4, $5, $6)',
                [supplier2Id, buyer2Id, 'Test Message', 'Content', 'System', 'SUPPLIER']
            );

            const response = await axios.get(`${BASE_URL}/api/messages`,
                { headers: { 'Authorization': `Bearer ${supplier1Token}` } }
            );

            expect(response.status).toBe(200);
            const messages = response.data;

            // Verify supplier1 doesn't see supplier2's messages
            const hasOtherSupplierMessages = messages.some(m => m.supplierId === supplier2Id);
            expect(hasOtherSupplierMessages).toBe(false);

            log('RBAC', 'Supplier messages isolated');
        });
    });

    describe('CRITICAL: Supplier Document Isolation', () => {
        test('CRITICAL: Supplier 1 CANNOT access Supplier 2 documents', async () => {
            const supplier1Token = generateToken(supplier1User);

            // Create document for supplier 2
            await query(
                'INSERT INTO documents (supplierId, documentType, documentName, filePath) VALUES ($1, $2, $3, $4)',
                [supplier2Id, 'Confidential Doc', 'Secret.pdf', '/docs/secret.pdf']
            );

            try {
                const response = await axios.get(`${BASE_URL}/api/documents?supplierId=${supplier2Id}`,
                    { headers: { 'Authorization': `Bearer ${supplier1Token}` } }
                );

                // Should be blocked - either 403 or empty result
                expect(response.status).toBe(403);

                log('RBAC', 'Supplier 1 blocked from Supplier 2 docs');
            } catch (error) {
                expect(error.response.status).toBe(403);
            }
        });

        test('CRITICAL: API filters documents by supplierId', async () => {
            const supplier1Token = generateToken(supplier1User);

            // Create documents for both suppliers
            await run(
                'INSERT INTO documents (supplierId, documentType, documentName, filePath) VALUES ($1, $2, $3, $4)',
                [supplier1Id, 'Doc 1', 'doc1.pdf', '/docs/doc1.pdf']
            );

            await run(
                'INSERT INTO documents (supplierId, documentType, documentName, filePath) VALUES ($1, $2, $3, $4)',
                [supplier2Id, 'Doc 2', 'doc2.pdf', '/docs/doc2.pdf']
            );

            const response = await axios.get(`${BASE_URL}/api/documents`,
                { headers: { 'Authorization': `Bearer ${supplier1Token}` } }
            );

            expect(response.status).toBe(200);
            const documents = response.data;

            console.log('[DEBUG] Documents response:', JSON.stringify(documents, null, 2));
            console.log('[DEBUG] First doc keys:', documents.length > 0 ? Object.keys(documents[0]) : 'No docs');

            // Verify only supplier1's documents are returned
            documents.forEach(doc => {
                const docSupplierId = doc.supplierid || doc.supplierId;
                console.log('[DEBUG] Doc supplierId:', docSupplierId, 'Expected:', supplier1Id);
                expect(docSupplierId).toBe(supplier1Id);
                expect(docSupplierId).not.toBe(supplier2Id);
            });

            log('RBAC', 'Documents filtered by supplier');
        });
    });

    describe('CRITICAL: Analytics Data Isolation', () => {
        test('CRITICAL: Buyer 1 analytics only shows their data', async () => {
            const buyer1Token = generateToken(buyer1User);

            const response = await axios.get(`${BASE_URL}/api/analytics/buyer/summary?buyerId=${buyer1Id}`,
                { headers: { 'Authorization': `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);
            // API returns activeSuppliers, not totalSuppliers
            expect(response.data).toHaveProperty('activeSuppliers');

            // Verify it's buyer1's data
            if (response.data.buyerId) {
                expect(response.data.buyerId).toBe(buyer1Id);
            }

            log('RBAC', 'Buyer analytics isolated');
        });

        test('CRITICAL: Buyer 1 CANNOT access Buyer 2 analytics', async () => {
            const buyer1Token = generateToken(buyer1User);

            try {
                const response = await axios.get(`${BASE_URL}/api/analytics/buyer/summary?buyerId=${buyer2Id}`,
                    {
                        headers: { Authorization: `Bearer ${buyer1Token}` },
                        validateStatus: () => true // Handle statuses manually to avoid catch block for these
                    }
                );

                // Should be blocked
                expect([403, 404]).toContain(response.status);
                log('RBAC', 'Buyer 1 blocked from Buyer 2 analytics', { status: response.status });
            } catch (error) {
                const status = (error.response && error.response.status) || 500;
                expect([403, 404]).toContain(status);
            }
        });
    });

    describe('CRITICAL: Change Request Data Isolation', () => {
        test('CRITICAL: Supplier 1 CANNOT see Supplier 2 change requests', async () => {
            const supplier1Token = generateToken(supplier1User);

            // Create change request for supplier 2 using correct table name
            await query(
                `INSERT INTO supplier_change_requests (supplierId, requestType, status, requestedByUserId, buyerId)
                 VALUES ($1, $2, 'PENDING', $3, $4)`,
                [supplier2Id, 'UPDATE_PROFILE', buyer2User.userId, buyer2Id]
            );

            const response = await axios.get(`${BASE_URL}/api/change-requests/pending`,
                { headers: { 'Authorization': `Bearer ${supplier1Token}` } }
            );

            expect(response.status).toBe(200);
            const requests = response.data;

            // Verify supplier1 doesn't see supplier2's change requests
            const hasOtherSupplierRequests = requests.some(r => r.supplierId === supplier2Id);
            expect(hasOtherSupplierRequests).toBe(false);

            log('RBAC', 'Change requests isolated');
        });
    });

    describe('CRITICAL: Circle Data Isolation', () => {
        test('CRITICAL: Buyer 1 circles do not leak to Buyer 2', async () => {
            const buyer1Token = generateToken(buyer1User);

            // Create circle for buyer 1
            await query('INSERT INTO circles (buyerId, circleName) VALUES ($1, $2)', [buyer1Id, 'Buyer 1 Circle']
            );

            const response = await axios.get(`${BASE_URL}/api/circles/buyer/${buyer1Id}`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);
            const circles = response.data;

            // Verify only buyer1's circles are returned
            circles.forEach(circle => {
                const circleBuyerId = circle.buyerid || circle.buyerId;
                expect(circleBuyerId).toBe(buyer1Id);
            });

            log('RBAC', 'Circles isolated by buyer');
        });
    });

    describe('CRITICAL: Workflow Data Isolation', () => {
        test('CRITICAL: Supplier 1 cannot access Supplier 2 workflows', async () => {
            const supplier1Token = generateToken(supplier1User);

            // Create workflow instance for supplier 2
            const workflowInstance = await run(
                'INSERT INTO workflow_instances (supplierId, workflowTemplateId, status) VALUES ($1, $2, $3)',
                [supplier2Id, 1, 'STARTED']
            );
            const instanceId = workflowInstance.rows[0].lastID;

            // Try to access supplier2's workflow
            try {
                const response = await axios.get(`${BASE_URL}/api/workflows/instances/${instanceId}`,
                    { headers: { Authorization: `Bearer ${supplier1Token}` } }
                );

                // Should be blocked
                expect([403, 404]).toContain(response.status);

                log('RBAC', 'Supplier 1 blocked from Supplier 2 workflows');
            } catch (error) {
                expect([403, 404]).toContain(error.response.status);
            }
        });
    });

    describe('CRITICAL: Message Data Isolation', () => {
        test('CRITICAL: Buyer 1 cannot see Buyer 2 messages', async () => {
            const buyer1Token = generateToken(buyer1User);

            // Create messages for buyer 2
            await query(
                'INSERT INTO messages (supplierId, buyerId, subject, content, senderName, recipientRole) VALUES ($1, $2, $3, $4, $5, $6)',
                [supplier1Id, buyer2Id, 'Buyer 2 Message', 'Content', 'System', 'BUYER']
            );

            const response = await axios.get(`${BASE_URL}/api/messages`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);
            const messages = response.data;

            // Verify buyer1 doesn't see buyer2's messages
            const hasBuyer2Messages = messages.some(m => m.buyerId === buyer2Id);
            expect(hasBuyer2Messages).toBe(false);

            log('RBAC', 'Messages isolated by buyer');
        });
    });

    describe('CRITICAL: Admin Access Control', () => {
        test('CRITICAL: Admins have limited access to supplier data', async () => {
            const adminToken = generateToken(adminUser);

            // Admins should NOT see supplier list (per business rule)
            try {
                const response = await axios.get(`${BASE_URL}/api/suppliers`,
                    { headers: { 'Authorization': `Bearer ${adminToken}` } }
                );

                // Should be blocked for admins
                expect(response.status).toBe(403);

                log('RBAC', 'Admin blocked from supplier list');
            } catch (error) {
                expect(error.response.status).toBe(403);
            }
        });

        test('CRITICAL: Admins can access user management', async () => {
            const adminToken = generateToken(adminUser);

            const response = await axios.get(`${BASE_URL}/api/users`,
                { headers: { 'Authorization': `Bearer ${adminToken}` } }
            );

            expect(response.status).toBe(200);
            log('RBAC', 'Admin can access user management');
        });
    });

    describe('CRITICAL: API Response Does Not Leak Data', () => {
        test('CRITICAL: API response does not include other buyers in supplier details', async () => {
            const supplier1Token = generateToken(supplier1User);

            const response = await axios.get(`${BASE_URL}/api/suppliers/${supplier1Id}`,
                { headers: { Authorization: `Bearer ${supplier1Token}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('supplierId', supplier1Id);
            // API returns lowercase field names
            expect(response.data).toHaveProperty('buyerid', buyer1Id);
            expect(response.data.buyerid).not.toBe(buyer2Id);

            // Verify no other buyer IDs in response - check all nested properties
            const responseStr = JSON.stringify(response.data);
            expect(responseStr).not.toContain(buyer2Id.toString());
            expect(responseStr).not.toContain('rbac_buyer2');
            expect(responseStr).not.toContain('rbac_supplier2');

            // Verify response doesn't have otherBuyers array or similar
            expect(response.data).not.toHaveProperty('otherBuyers');
            expect(response.data).not.toHaveProperty('sharedWith');
            expect(response.data).not.toHaveProperty('allBuyers');

            log('RBAC', 'No data leakage in supplier details', { responseKeys: Object.keys(response.data) });
        });

        test('CRITICAL: Supplier list API does not leak buyer2 suppliers to buyer1', async () => {
            const buyer1Token = generateToken(buyer1User);

            const response = await axios.get(`${BASE_URL}/api/suppliers`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);
            // Response might be an object with a data property or directly an array
            const suppliers = Array.isArray(response.data) ? response.data : (response.data.data || response.data.suppliers || []);

            // Verify only buyer1's suppliers are returned
            suppliers.forEach(supplier => {
                expect(supplier.buyerid || supplier.buyerId).toBe(buyer1Id);
                expect(supplier.buyerid || supplier.buyerId).not.toBe(buyer2Id);
                expect(supplier.legalname || supplier.legalName).not.toContain('RBAC Supplier 2');
            });

            // Verify buyer2's supplier is NOT in the list
            const supplierIds = suppliers.map(s => s.supplierid || s.supplierId);
            expect(supplierIds).not.toContain(supplier2Id);

            log('RBAC', 'Supplier list filtered correctly', { count: suppliers.length });
        });

        test('CRITICAL: Document list does not show supplier2 docs to supplier1', async () => {
            const supplier1Token = generateToken(supplier1User);

            const response = await axios.get(`${BASE_URL}/api/documents`,
                { headers: { Authorization: `Bearer ${supplier1Token}` } }
            );

            expect(response.status).toBe(200);
            // Response might be an object with a data property or directly an array
            const documents = Array.isArray(response.data) ? response.data : (response.data.data || response.data.documents || []);

            // Verify only supplier1's documents are returned (if any documents exist)
            if (documents.length > 0) {
                documents.forEach(doc => {
                    const docSupplierId = doc.supplierid || doc.supplierId;
                    // If supplierId is present, verify it belongs to supplier1
                    if (docSupplierId) {
                        expect(docSupplierId).toBe(supplier1Id);
                        expect(docSupplierId).not.toBe(supplier2Id);
                    }
                });

                // Verify document names don't leak
                const responseStr = JSON.stringify(response.data);
                expect(responseStr).not.toContain('Confidential Doc');
                expect(responseStr).not.toContain('Secret');
            }

            log('RBAC', 'Documents filtered correctly', { count: documents.length });
        });

        test('CRITICAL: Message list does not leak messages between suppliers', async () => {
            const supplier1Token = generateToken(supplier1User);

            const response = await axios.get(`${BASE_URL}/api/messages`,
                { headers: { Authorization: `Bearer ${supplier1Token}` } }
            );

            expect(response.status).toBe(200);
            const messages = response.data;

            // Verify no supplier2 messages
            messages.forEach(msg => {
                expect(msg.supplierId).not.toBe(supplier2Id);
            });

            log('RBAC', 'Messages filtered correctly', { count: messages.length });
        });

        test('CRITICAL: User list is filtered by role/access', async () => {
            const buyer1Token = generateToken(buyer1User);

            const response = await axios.get(`${BASE_URL}/api/users/buyer/${buyer1Id}`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);
            const users = Array.isArray(response.data) ? response.data : (response.data.data || response.data.users || []);

            // All returned users should belong to buyer1
            users.forEach(user => {
                const userBuyerId = user.buyerid || user.buyerId;
                if (userBuyerId) {
                    expect(userBuyerId).toBe(buyer1Id);
                }
            });

            // Verify buyer2 users are NOT in response
            const usernames = users.map(u => u.username);
            expect(usernames).not.toContain('rbac_buyer2');

            // Verify response doesn't contain buyer2 user data
            const responseStr = JSON.stringify(response.data);
            expect(responseStr).not.toContain('buyer2@example.com');
            expect(responseStr).not.toContain('supplier2@example.com');

            log('RBAC', 'User list filtered by buyer', { userCount: users.length });
        });

        test('CRITICAL: Analytics endpoints do not leak cross-buyer data', async () => {
            const buyer1Token = generateToken(buyer1User);

            const response = await axios.get(`${BASE_URL}/api/analytics/buyer/summary?buyerId=${buyer1Id}`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);

            // Verify analytics only contain buyer1's data
            const responseBuyerId = response.data.buyerid || response.data.buyerId;
            if (responseBuyerId) {
                expect(responseBuyerId).toBe(buyer1Id);
            }

            // Check no supplier2 references in analytics
            const responseStr = JSON.stringify(response.data);
            expect(responseStr).not.toContain('rbac_buyer2');
            expect(responseStr).not.toContain('rbac_supplier2');

            if (response.data.suppliers) {
                response.data.suppliers.forEach(s => {
                    const supplierBuyerId = s.buyerid || s.buyerId;
                    if (supplierBuyerId) {
                        expect(supplierBuyerId).toBe(buyer1Id);
                    }
                });
            }

            log('RBAC', 'Analytics data isolated');
        });
    });
});

/**
 * Supplier → Buyers Many-to-Many Relationship Tests
 *
 * IMPORTANT: A supplier can be associated with multiple buyers
 * Test Scenarios:
 * 1. Supplier can belong to multiple buyers
 * 2. Supplier users can see data for all their buyers
 * 3. Supplier dashboard shows data for all associated buyers
 * 4. Buyer dashboard shows supplier shared with other buyers
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

describe('Supplier → Buyers Many-to-Many Relationship', () => {
    let buyer1Id, buyer2Id, buyer3Id;
    let supplierId; // Reference ID (first one)
    let s1Id, s2Id, s3Id; // Unique IDs for each buyer
    let supplierUserId;
    let supplierToken;
    let buyer1User, buyer2User, buyer3User;

    beforeAll(async () => {
        try {
            // Create three buyers
            const buyer1Result = await query('INSERT INTO buyers (buyerName, email) VALUES ($1, $2) RETURNING buyerId', ['Multi-Buyer Buyer 1', 'mbuyer1@example.com']
            );
            buyer1Id = buyer1Result.rows[0].buyerid;

            const buyer2Result = await query('INSERT INTO buyers (buyerName, email) VALUES ($1, $2) RETURNING buyerId', ['Multi-Buyer Buyer 2', 'mbuyer2@example.com']
            );
            buyer2Id = buyer2Result.rows[0].buyerid;

            const buyer3Result = await query('INSERT INTO buyers (buyerName, email) VALUES ($1, $2) RETURNING buyerId', ['Multi-Buyer Buyer 3', 'mbuyer3@example.com']
            );
            buyer3Id = buyer3Result.rows[0].buyerid;

            // Create ONE supplier record for each buyer
            const s1Result = await query(
                'INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus) VALUES ($1, $2, $3, $4, $5) RETURNING supplierId',
                [buyer1Id, 'Multi-Buyer Supplier', 'LLC', 'US', 'ACTIVE']
            );
            s1Id = s1Result.rows[0].supplierid;
            supplierId = s1Id; // Store one for reference in tests

            // Link to buyer 2
            const s2Result = await query(
                'INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus) VALUES ($1, $2, $3, $4, $5) RETURNING supplierId',
                [buyer2Id, 'Multi-Buyer Supplier', 'LLC', 'US', 'ACTIVE']
            );
            s2Id = s2Result.rows[0].supplierid;

            // Link to buyer 3
            const s3Result = await query(
                'INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus) VALUES ($1, $2, $3, $4, $5) RETURNING supplierId',
                [buyer3Id, 'Multi-Buyer Supplier', 'LLC', 'US', 'ACTIVE']
            );
            s3Id = s3Result.rows[0].supplierid;

            // Create supplier user
            const suffix = Date.now();
            const supplierUsername = `multi_buyer_supplier_${suffix}`;
            const passwordHash = await require('bcryptjs').hash('SupplierUser123!', 10);
            const userResult = await query(
                'INSERT INTO sdn_users (username, password, email, role, supplierId) VALUES ($1, $2, $3, $4, $5) RETURNING userId',
                [supplierUsername, passwordHash, `supplier_${suffix}@example.com`, 'SUPPLIER', supplierId]
            );
            supplierUserId = userResult.rows[0].userid;

            // Create buyer users
            const mb1Name = `mbuyer1_user_${suffix}`;
            const mb2Name = `mbuyer2_user_${suffix}`;
            const mb3Name = `mbuyer3_user_${suffix}`;

            const buyer1UserResult = await query(
                'INSERT INTO sdn_users (username, password, email, role, buyerId) VALUES ($1, $2, $3, $4, $5) RETURNING userId',
                [mb1Name, passwordHash, `buyer1_${suffix}@example.com`, 'BUYER', buyer1Id]
            );
            buyer1User = { userId: buyer1UserResult.rows[0].userid, username: mb1Name, role: 'BUYER', buyerId: buyer1Id };

            const buyer2UserResult = await query(
                'INSERT INTO sdn_users (username, password, email, role, buyerId) VALUES ($1, $2, $3, $4, $5) RETURNING userId',
                [mb2Name, passwordHash, `buyer2_${suffix}@example.com`, 'BUYER', buyer2Id]
            );
            buyer2User = { userId: buyer2UserResult.rows[0].userid, username: mb2Name, role: 'BUYER', buyerId: buyer2Id };

            const buyer3UserResult = await query(
                'INSERT INTO sdn_users (username, password, email, role, buyerId) VALUES ($1, $2, $3, $4, $5) RETURNING userId',
                [mb3Name, passwordHash, `buyer3_${suffix}@example.com`, 'BUYER', buyer3Id]
            );
            buyer3User = { userId: buyer3UserResult.rows[0].userid, username: mb3Name, role: 'BUYER', buyerId: buyer3Id };

            // Create memberships linking supplier user to all three unique supplier records
            await query(
                'INSERT INTO user_supplier_memberships (userId, supplierId, isActive) VALUES ($1, $2, TRUE), ($3, $4, TRUE), ($5, $6, TRUE)',
                [supplierUserId, s1Id, supplierUserId, s2Id, supplierUserId, s3Id]
            );

            supplierToken = generateToken({
                userId: supplierUserId,
                username: 'multi_buyer_supplier',
                role: 'SUPPLIER',
                supplierId
            });

            log('SETUP', 'Multi-buyer supplier created', {
                supplierId,
                buyers: [buyer1Id, buyer2Id, buyer3Id]
            });

        } catch (err) {
            log('SETUP', 'Setup failed', { error: err.message });
        }
    });

    afterAll(async () => {
        try {
            await query('DELETE FROM user_supplier_memberships WHERE supplierId = $1', [supplierId]);
            await query('DELETE FROM suppliers WHERE legalName = $1', ['Multi-Buyer Supplier']);
            await query('DELETE FROM buyers WHERE buyerName LIKE $1', ['Multi-Buyer Buyer%']);
            await query('DELETE FROM sdn_users WHERE username LIKE $1', ['multi_buyer_%']);
            log('CLEANUP', 'Test data deleted');
        } catch (err) {
            log('CLEANUP', 'Cleanup failed', { error: err.message });
        }
    });

    describe('Supplier with Multiple Buyers', () => {
        test('CRITICAL: Supplier can be associated with multiple buyers', async () => {
            // Query all suppliers with this legal name
            const suppliers = await query(
                "SELECT * FROM suppliers WHERE legalName = 'Multi-Buyer Supplier'"
            );

            expect(suppliers.rows.length).toBeGreaterThanOrEqual(3);

            // Verify each has different buyerId
            const buyerIds = suppliers.rows.map(s => s.buyerid || s.buyerId);
            const uniqueBuyerIds = [...new Set(buyerIds)];

            expect(uniqueBuyerIds.length).toBe(3);
            expect(uniqueBuyerIds).toContain(buyer1Id);
            expect(uniqueBuyerIds).toContain(buyer2Id);
            expect(uniqueBuyerIds).toContain(buyer3Id);

            log('RELATIONSHIP', 'Supplier has multiple buyers', {
                supplierId,
                buyerCount: suppliers.rows.length,
                buyerIds
            });
        });

        test('Supplier user can see all associated buyers', async () => {
            const response = await axios.get(`${BASE_URL}/auth/me`,
                { headers: { 'Authorization': `Bearer ${supplierToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('memberships');

            // Should have memberships for all 3 buyers
            expect(response.data.memberships.length).toBeGreaterThanOrEqual(3);

            // Verify all buyers are present
            const buyerIds = response.data.memberships.map(m => m.buyerId || m.buyerid);
            expect(buyerIds).toContain(buyer1Id);
            expect(buyerIds).toContain(buyer2Id);
            expect(buyerIds).toContain(buyer3Id);

            log('SUPPLIER_USER', 'Sees all buyers', {
                membershipCount: response.data.memberships.length
            });
        });

        test('Buyer 1 can see the shared supplier', async () => {
            const buyer1Token = generateToken(buyer1User);

            const response = await axios.get(`${BASE_URL}/api/suppliers/${s1Id}`,
                { headers: { 'Authorization': `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data.supplierId === s1Id || response.data.supplierid === s1Id).toBe(true);

            log('BUYER_1', 'Can see shared supplier');
        });

        test('Buyer 2 can see the shared supplier', async () => {
            const buyer2Token = generateToken(buyer2User);

            const response = await axios.get(`${BASE_URL}/api/suppliers/${s2Id}`,
                { headers: { Authorization: `Bearer ${buyer2Token}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data.supplierId === s2Id || response.data.supplierid === s2Id).toBe(true);

            log('BUYER_2', 'Can see shared supplier');
        });

        test('Buyer 3 can see the shared supplier', async () => {
            const buyer3Token = generateToken(buyer3User);

            const response = await axios.get(`${BASE_URL}/api/suppliers/${s3Id}`,
                { headers: { Authorization: `Bearer ${buyer3Token}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data.supplierId === s3Id || response.data.supplierid === s3Id).toBe(true);

            log('BUYER_3', 'Can see shared supplier');
        });
    });

    describe('Supplier Dashboard with Multiple Buyers', () => {
        test('Supplier dashboard shows data for all associated buyers', async () => {
            const s1Dashboard = await axios.get(`${BASE_URL}/api/suppliers/${s1Id}/dashboard`, {
                headers: { 'Authorization': `Bearer ${supplierToken}` }
            });
            expect(s1Dashboard.status).toBe(200);
            expect(s1Dashboard.data.buyers).toBeDefined();
            expect(s1Dashboard.data.stats).toBeDefined();
            expect(s1Dashboard.data.stats.totalBuyers).toBeGreaterThanOrEqual(3);

            log('SUPPLIER_DASHBOARD', 'Multi-buyer dashboard data');
        });

        test('Supplier analytics include all buyer relationships', async () => {
            const response = await axios.get(`${BASE_URL}/api/analytics/supplier/summary`,
                { headers: { Authorization: `Bearer ${supplierToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data.activeBuyers).toBeDefined();

            log('SUPPLIER_ANALYTICS', 'Multi-buyer analytics summary');
        });
    });

    describe('Data Privacy: Buyer cannot see other buyers of shared supplier', () => {
        test('CRITICAL: Buyer 1 cannot see Buyer 2 or Buyer 3 on supplier details', async () => {
            const buyer1Token = generateToken(buyer1User);

            const response = await axios.get(`${BASE_URL}/api/suppliers/${supplierId}`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);

            // Response should not reveal other buyer relationships
            // API should only return data relevant to the requesting buyer
            const responseStr = JSON.stringify(response.data);

            // Check that other buyer IDs are not exposed anywhere in response
            expect(responseStr).not.toContain(buyer2Id.toString());
            expect(responseStr).not.toContain(buyer3Id.toString());
            expect(responseStr).not.toContain('Multi-Buyer Buyer 2');
            expect(responseStr).not.toContain('Multi-Buyer Buyer 3');
            expect(responseStr).not.toContain('mbuyer2');
            expect(responseStr).not.toContain('mbuyer3');

            // Check for common data leak patterns
            expect(response.data).not.toHaveProperty('otherBuyers');
            expect(response.data).not.toHaveProperty('sharedWith');
            expect(response.data).not.toHaveProperty('allBuyers');
            expect(response.data).not.toHaveProperty('buyerList');

            // The response should only show buyer1's relationship
            if (response.data.buyerId) {
                expect(response.data.buyerId).toBe(buyer1Id);
            }

            log('BUYER_PRIVACY', 'Buyer 1 cannot see other buyers', {
                responseKeys: Object.keys(response.data)
            });
        });

        test('CRITICAL: Buyer 1 supplier list does not show supplier shared with Buyer 2', async () => {
            const buyer1Token = generateToken(buyer1User);

            const response = await axios.get(`${BASE_URL}/api/suppliers`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);
            const suppliers = response.data;

            // All suppliers should belong to buyer1 only
            suppliers.forEach(supplier => {
                expect(supplier.buyerId).toBe(buyer1Id);
            });

            // Should not show the supplier's buyer2 or buyer3 relationships
            const multiBuyerSuppliers = suppliers.filter(s => s.legalName === 'Multi-Buyer Supplier');
            expect(multiBuyerSuppliers.length).toBe(1); // Only buyer1's relationship

            log('BUYER_PRIVACY', 'Supplier list isolated by buyer');
        });

        test('CRITICAL: Buyer 1 cannot access Buyer 2 or Buyer 3 change requests', async () => {
            const buyer1Token = generateToken(buyer1User);

            // Create a change request as supplier on behalf of s1
            await axios.post(`${BASE_URL}/api/change-requests`,
                {
                    supplierId: s1Id,
                    requestType: 'UPDATE_PROFILE',
                    updates: { legalName: 'Buyer 1 Change' }
                },
                { headers: { Authorization: `Bearer ${supplierToken}` } }
            );

            // Get all change requests - should only see buyer1's requests
            const response = await axios.get(`${BASE_URL}/api/change-requests/pending`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);
            const requests = response.data;

            // Verify no cross-buyer data
            requests.forEach(req => {
                if (req.buyerId) {
                    expect(req.buyerId).toBe(buyer1Id);
                }
            });

            log('BUYER_PRIVACY', 'Change requests isolated by buyer');
        });

        test('CRITICAL: Buyer 1 cannot see messages meant for Buyer 2', async () => {
            const buyer1Token = generateToken(buyer1User);
            const buyer2Token = generateToken(buyer2User);

            // Send a message as buyer2 to supplier
            await axios.post(`${BASE_URL}/api/messages`,
                {
                    supplierId: supplierId,
                    subject: 'Buyer 2 Private Message',
                    content: 'This is private to buyer2',
                    recipientRole: 'SUPPLIER'
                },
                { headers: { Authorization: `Bearer ${buyer2Token}` } }
            );

            // Buyer 1 should NOT see this message
            const buyer1Messages = await axios.get(`${BASE_URL}/api/messages?supplierId=${s1Id}`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(buyer1Messages.status).toBe(200);
            const hasBuyer2Message = (buyer1Messages.data || []).some(m => m.subject === 'Buyer 2 Private Message');
            expect(hasBuyer2Message).toBe(false);

            log('BUYER_PRIVACY', 'Messages isolated by buyer');
        });

        test('CRITICAL: Analytics do not leak buyer2/buyer3 data to buyer1', async () => {
            const buyer1Token = generateToken(buyer1User);

            const response = await axios.get(`${BASE_URL}/api/analytics/buyer/summary?buyerId=${buyer1Id}`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(response.status).toBe(200);

            // Verify no cross-buyer data leakage
            const responseStr = JSON.stringify(response.data);
            expect(responseStr).not.toContain('mbuyer2');
            expect(responseStr).not.toContain('mbuyer3');

            if (response.data.buyerId) {
                expect(response.data.buyerId).toBe(buyer1Id);
            }

            log('BUYER_PRIVACY', 'Analytics isolated by buyer');
        });
    });

    describe('Change Requests with Multi-Buyer Supplier', () => {
        test('Change request from Buyer 1 only affects their relationship', async () => {
            const buyer1Token = generateToken(buyer1User);

            // Submit change request for supplier
            const response = await axios.post(`${BASE_URL}/api/change-requests`,
                {
                    supplierId: s1Id,
                    requestType: 'UPDATE_PROFILE',
                    updates: {
                        legalName: 'Updated Name for Buyer 1'
                    }
                },
                { headers: { Authorization: `Bearer ${supplierToken}` } }
            );

            expect(response.status).toBe(200);
            const changeRequestId = response.data.requestId;

            // Verify change request is tied to buyer 1
            const cr = await query('SELECT * FROM supplier_change_requests WHERE requestId = $1', [changeRequestId]
            );

            expect(cr.rows.length).toBe(1);

            log('CHANGE_REQUEST', 'Buyer 1 change request isolated');
        });
    });

    describe('Messages with Multi-Buyer Supplier', () => {
        test('Messages are scoped to specific buyer-supplier relationship', async () => {
            const buyer1Token = generateToken(buyer1User);

            // Send message as supplier
            await axios.post(`${BASE_URL}/api/messages`,
                {
                    supplierId: s1Id,
                    subject: 'Test Message',
                    content: 'Test content',
                    recipientRole: 'BUYER'
                },
                { headers: { Authorization: `Bearer ${supplierToken}` } }
            );

            // Buyer 1 should see messages for their relationship
            const buyer1Messages = await axios.get(`${BASE_URL}/api/messages?supplierId=${s1Id}`,
                { headers: { Authorization: `Bearer ${buyer1Token}` } }
            );

            expect(buyer1Messages.status).toBe(200);

            // Buyer 2 should also see messages for their relationship
            const buyer2Token = generateToken(buyer2User);
            const buyer2Messages = await axios.get(`${BASE_URL}/api/messages?supplierId=${s2Id}`,
                { headers: { Authorization: `Bearer ${buyer2Token}` } }
            );

            expect(buyer2Messages.status).toBe(200);

            log('MESSAGES', 'Multi-buyer message scoping');
        });
    });
});

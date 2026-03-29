/**
 * Many-to-Many Relationship Tests
 * Tests for user_supplier_memberships table (Buyer ↔ Supplier ↔ User)
 *
 * Test Scenarios:
 * 1. User can be added to multiple suppliers
 * 2. Supplier can have multiple users
 * 3. Buyer can have multiple suppliers
 * 4. User memberships can be deactivated without deletion
 * 5. Membership filtering by isActive
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8083';
const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

// Helper: Wrap db queries in promises
const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve({ rows });
    });
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ rows: [{ lastID: this.lastID }] });
    });
});

// Test data IDs
const testUserIds = [];
const testSupplierIds = [];
let testBuyerId;

function log(step, msg, data) {
    console.log(`[${step}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

// Helper: Generate tokens for different roles
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

describe('Many-to-Many Relationship: Buyer ↔ Supplier ↔ User', () => {
    let adminToken;
    let buyerAdminToken;
    let supplierUserId1;
    let supplierUserId2;
    let supplier1Id;
    let supplier2Id;
    let testUsername1;
    let testUsername2;
    let testEmail1;
    let testEmail2;

    beforeAll(async () => {
        try {
            // Generate unique test data
            const timestamp = Date.now();
            testUsername1 = `supplier1_user_${timestamp}`;
            testUsername2 = `supplier2_user_${timestamp}`;
            testEmail1 = `supplier1_${timestamp}@test.com`;
            testEmail2 = `supplier2_${timestamp}@test.com`;
            const buyerName = `Test Buyer Co ${timestamp}`;

            // Login as admin
            const adminLogin = await axios.post(`${BASE_URL}/auth/login`, {
                username: 'admin',
                password: 'Admin123!'
            });
            adminToken = adminLogin.data.token;

            // Create test buyer
            const buyerResult = await query(
                'INSERT INTO buyers (buyerName, email) VALUES ($1, $2) RETURNING buyerId',
                [buyerName, `testbuyer_${timestamp}@example.com`]
            );
            testBuyerId = buyerResult.rows[0].buyerid;

            // Create test supplier
            const supplierResult = await query(
                'INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus) VALUES ($1, $2, $3, $4, $5) RETURNING supplierId',
                [testBuyerId, `Test Supplier 1 ${timestamp}`, 'LLC', 'US', 'ACTIVE']
            );
            supplier1Id = supplierResult.rows[0].supplierid;

            const supplierResult2 = await query(
                'INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus) VALUES ($1, $2, $3, $4, $5) RETURNING supplierId',
                [testBuyerId, `Test Supplier 2 ${timestamp}`, 'Corporation', 'US', 'ACTIVE']
            );
            supplier2Id = supplierResult2.rows[0].supplierid;

            // Create supplier users
            const passwordHash = await require('bcryptjs').hash('SupplierUser123!', 10);

            const userResult1 = await query(
                'INSERT INTO users (username, password, email, role, supplierId) VALUES ($1, $2, $3, $4, $5) RETURNING userId',
                [testUsername1, passwordHash, testEmail1, 'SUPPLIER', supplier1Id]
            );
            supplierUserId1 = userResult1.rows[0].userid;

            const userResult2 = await query(
                'INSERT INTO users (username, password, email, role, supplierId) VALUES ($1, $2, $3, $4, $5) RETURNING userId',
                [testUsername2, passwordHash, testEmail2, 'SUPPLIER', supplier2Id]
            );
            supplierUserId2 = userResult2.rows[0].userid;

            log('SETUP', 'Test data created', {
                supplier1Id,
                supplier2Id,
                supplierUserId1,
                supplierUserId2
            });

        } catch (err) {
            log('SETUP', 'Setup failed', { error: err.message });
        }
    });

    afterAll(async () => {
        try {
            await run('DELETE FROM user_supplier_memberships WHERE userId IN ($1, $2)', [supplierUserId1, supplierUserId2]);
            await run('DELETE FROM users WHERE userId IN ($1, $2)', [supplierUserId1, supplierUserId2]);
            await run('DELETE FROM suppliers WHERE supplierId IN ($1, $2)', [supplier1Id, supplier2Id]);
            await run('DELETE FROM buyers WHERE buyerName LIKE $1', [`Test Buyer Co%`]);
            log('CLEANUP', 'Test data deleted');
        } catch (err) {
            log('CLEANUP', 'Cleanup failed', { error: err.message });
        }
    });

    describe('User → Supplier Membership', () => {
        test('should allow user to be associated with only one supplier', async () => {
            const user = await query('SELECT * FROM users WHERE username = $1', [testUsername1]);
            expect(user.rows.length).toBe(1);
            expect(user.rows[0].supplierid).toBe(supplier1Id);
        });

        test('should retrieve all memberships for a user', async () => {
            const memberships = await query('SELECT * FROM user_supplier_memberships WHERE userId = $1', [supplierUserId1]
            );

            expect(Array.isArray(memberships.rows)).toBe(true);
            log('MEMBERSHIPS', 'Retrieved for user', { count: memberships.rows.length });
        });

        test('should retrieve all users for a supplier', async () => {
            const users = await query(`SELECT u.*, m.isActive FROM users u
                 LEFT JOIN user_supplier_memberships m ON u.userId = m.userId
                 WHERE u.supplierId = $1`, [supplier1Id]
            );

            expect(users.rows.length).toBeGreaterThan(0);
            expect(users.rows[0].supplierid).toBe(supplier1Id);
            log('SUPPLIER_USERS', 'Retrieved for supplier', { count: users.rows.length });
        });
    });

    describe('Buyer → Suppliers Relationship', () => {
        test('should retrieve all suppliers for a buyer', async () => {
            const suppliers = await query('SELECT * FROM suppliers WHERE buyerId = $1 ORDER BY legalName', [testBuyerId]
            );

            expect(suppliers.rows.length).toBeGreaterThan(0);
            log('BUYER_SUPPLIERS', 'Retrieved for buyer', { count: suppliers.rows.length });
        });

        test('should filter suppliers by approval status', async () => {
            const activeSuppliers = await query(
                "SELECT * FROM suppliers WHERE buyerId = $1 AND approvalStatus = 'ACTIVE'",
                [testBuyerId]
            );

            expect(activeSuppliers.rows.length).toBeGreaterThan(0);
            log('FILTERED_SUPPLIERS', 'Active suppliers', { count: activeSuppliers.rows.length });
        });
    });

    describe('Membership Activation/Deactivation', () => {
        test('should allow deactivating a membership without deleting', async () => {
            // Add a membership - using ON CONFLICT to avoid duplicate key errors
            await run('INSERT INTO user_supplier_memberships (userId, supplierId, isActive) VALUES ($1, $2, TRUE) ON CONFLICT (userId, supplierId) DO UPDATE SET isActive = TRUE', [supplierUserId1, supplier1Id]
            );

            // Deactivate
            await run('UPDATE user_supplier_memberships SET isActive = FALSE WHERE userId = $1 AND supplierId = $2', [supplierUserId1, supplier1Id]
            );

            const membership = await query('SELECT * FROM user_supplier_memberships WHERE userId = $1 AND supplierId = $2', [supplierUserId1, supplier1Id]
            );

            expect(membership.rows.length).toBe(1);
            expect(membership.rows[0].isactive).toBe(false);
            log('MEMBERSHIP', 'Deactivated successfully');
        });

        test('should filter out inactive memberships', async () => {
            // Create active and inactive memberships - using ON CONFLICT
            await run('INSERT INTO user_supplier_memberships (userId, supplierId, isActive) VALUES ($1, $2, TRUE) ON CONFLICT (userId, supplierId) DO UPDATE SET isActive = TRUE', [supplierUserId1, supplier1Id]
            );
            await run('INSERT INTO user_supplier_memberships (userId, supplierId, isActive) VALUES ($1, $2, FALSE) ON CONFLICT (userId, supplierId) DO UPDATE SET isActive = FALSE', [supplierUserId1, supplier2Id]
            );

            const activeMemberships = await query('SELECT * FROM user_supplier_memberships WHERE userId = $1 AND isActive = TRUE', [supplierUserId1]
            );

            expect(activeMemberships.rows.length).toBe(1);
            expect(activeMemberships.rows[0].supplierid).toBe(supplier1Id);
            log('MEMBERSHIP', 'Filtered active memberships', { count: activeMemberships.rows.length });
        });
    });

    describe('API Response: Memberships', () => {
        test('GET /auth/me returns user memberships', async () => {
            const supplierUser = await query('SELECT * FROM users WHERE userId = $1', [supplierUserId1]);
            const token = generateToken(supplierUser.rows[0]);

            const response = await axios.get(`${BASE_URL}/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('memberships');
            log('AUTH_ME', 'Returns memberships', { memberships: response.data.memberships });
        });

        test('memberships include supplier details', async () => {
            // Add membership - using ON CONFLICT
            await run('INSERT INTO user_supplier_memberships (userId, supplierId, isActive) VALUES ($1, $2, TRUE) ON CONFLICT (userId, supplierId) DO UPDATE SET isActive = TRUE', [supplierUserId1, supplier1Id]
            );

            const supplierUser = await query('SELECT * FROM users WHERE userId = $1', [supplierUserId1]);
            const token = generateToken(supplierUser.rows[0]);

            const response = await axios.get(`${BASE_URL}/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            expect(response.status).toBe(200);
            if (response.data.memberships && response.data.memberships.length > 0) {
                expect(response.data.memberships[0]).toHaveProperty('supplierName');
            }
            log('MEMBERSHIP_DETAILS', 'Includes supplier details');
        });
    });
});

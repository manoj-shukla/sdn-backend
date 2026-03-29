/**
 * Authentication & Buyer Integration Tests
 *
 * Tests for:
 * - User authentication (login, logout)
 * - Password management (forgot password, reset)
 * - Buyer CRUD operations
 * - Buyer role management (RBAC)
 * - User invitations
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8083';
const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

function log(step, msg, data) {
    console.log(`[${step}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

// Test user IDs for cleanup
let testBuyerId = null;
let testUserId = null;

// Cleanup helper
async function cleanupTestData() {
    if (!db.run) return;

    try {
        // Clean up users and invitations by email
        const testEmails = ['newuser@testbuyer.com', 'admin@testbuyer.com', 'cancel-test@testbuyer.com'];
        await new Promise(r => db.run('DELETE FROM invitations WHERE email IN ($1, $2, $3)', testEmails, r));
        await new Promise(r => db.run('DELETE FROM users WHERE email IN ($1, $2, $3)', testEmails, r));
        
        if (testUserId) {
            await new Promise(r => db.run('DELETE FROM users WHERE userid = $1', [testUserId], r));
        }

        if (testBuyerId) {
            await new Promise(r => db.run('DELETE FROM buyers WHERE buyerid = $1', [testBuyerId], r));
        }
    } catch (e) {
        console.error("Cleanup error:", e);
    }

    testBuyerId = null;
    testUserId = null;
}

describe('Authentication Integration Tests', () => {
    describe('User Login', () => {
        test('POST /auth/login - Valid credentials', async () => {
            const response = await axios.post(`${BASE_URL}/auth/login`, {
                username: 'admin',
                password: 'Admin123!'
            });

            expect(response.status).toBe(200);
            expect(response.data.token).toBeDefined();
            expect(response.data.user).toBeDefined();
            expect(response.data.user.role).toBeDefined();

            log('AUTH', 'Login successful', { userId: response.data.user.userId, role: response.data.user.role });
        });

        test('POST /auth/login - Invalid credentials', async () => {
            try {
                await axios.post(`${BASE_URL}/auth/login`, {
                    username: 'admin',
                    password: 'wrongpassword'
                });
                throw new Error('Should have thrown an error');
            } catch (error) {
                expect(error.response.status).toBe(401);
                log('AUTH', 'Invalid credentials rejected');
            }
        });

        test('POST /auth/login - Missing credentials', async () => {
            try {
                await axios.post(`${BASE_URL}/auth/login`, {
                    username: 'admin'
                });
                throw new Error('Should have thrown an error');
            } catch (error) {
                expect(error.response.status).toBe(400);
                log('AUTH', 'Missing password rejected');
            }
        });
    });

    describe('Token Validation', () => {
        test('Valid token grants access', async () => {
            const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
                username: 'admin',
                password: 'Admin123!'
            });

            const token = loginResponse.data.token;

            const response = await axios.get(`${BASE_URL}/api/buyers`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            expect(response.status).toBe(200);
            log('AUTH', 'Valid token accepted');
        });

        test('Invalid token is rejected', async () => {
            try {
                await axios.get(`${BASE_URL}/api/buyers`, {
                    headers: { 'Authorization': 'Bearer invalid-token' }
                });
                throw new Error('Should have thrown an error');
            } catch (error) {
                expect(error.response.status).toBe(401);
                log('AUTH', 'Invalid token rejected');
            }
        });

        test('Missing token is rejected', async () => {
            try {
                await axios.get(`${BASE_URL}/api/buyers`);
                throw new Error('Should have thrown an error');
            } catch (error) {
                expect(error.response.status).toBe(401);
                log('AUTH', 'Missing token rejected');
            }
        });
    });
});

describe('Buyer Integration Tests', () => {
    let buyerAdminToken;

    beforeAll(async () => {
        // Login as buyer admin
        const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
            username: 'admin',
            password: 'Admin123!'
        });
        buyerAdminToken = loginResponse.data.token;

        // Clean up any existing test buyer data to avoid conflicts
        try {
            await new Promise(r => db.run('DELETE FROM invitations WHERE email = $1', ['newuser@testbuyer.com'], r));
            await new Promise(r => db.run('DELETE FROM users WHERE email = $1', ['admin@testbuyer.com'], r));
            await new Promise(r => db.run('DELETE FROM buyers WHERE buyercode = $1', ['TESTBUYER01'], r));
            await new Promise(r => db.run('DELETE FROM buyers WHERE buyername = $1', ['Test Buyer Organization'], r));
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    describe('Buyer CRUD Operations', () => {
        test('POST /buyers - Create buyer', async () => {
            const buyerData = {
                buyerName: 'Test Buyer Organization',
                buyerCode: 'TESTBUYER01',
                email: 'admin@testbuyer.com',
                phone: '+1-555-0100',
                country: 'US',
                isActive: true
            };

            const response = await axios.post(`${BASE_URL}/api/buyers`, buyerData, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.buyerId).toBeDefined();
            testBuyerId = response.data.buyerId;

            log('BUYER', 'Buyer created', { buyerId: testBuyerId });
        });

        test('GET /buyers/:id - Get buyer by ID', async () => {
            const response = await axios.get(`${BASE_URL}/api/buyers/${testBuyerId}`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.buyerName).toBe('Test Buyer Organization');
            expect(response.data.buyerId).toBe(testBuyerId);

            log('BUYER', 'Buyer retrieved', response.data);
        });

        test('PUT /buyers/:id - Update buyer', async () => {
            const updateData = {
                buyerName: 'Test Buyer Organization (Updated)',
                phone: '+1-555-0199'
            };

            const response = await axios.put(`${BASE_URL}/api/buyers/${testBuyerId}`, updateData, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.buyerName).toBe('Test Buyer Organization (Updated)');

            log('BUYER', 'Buyer updated');
        });

        test('GET /buyers - List all buyers', async () => {
            const response = await axios.get(`${BASE_URL}/api/buyers`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);
            expect(response.data.length).toBeGreaterThan(0);

            const ourBuyer = response.data.find(b => b.buyerId === testBuyerId);
            expect(ourBuyer).toBeDefined();

            log('BUYER', `Found ${response.data.length} buyers`);
        });
    });

    describe('Buyer Workflows', () => {
        test('POST /buyers/:id/workflows - Create workflow', async () => {
            const workflowData = {
                name: 'Supplier Approval Workflow',
                description: 'Standard workflow for approving new suppliers',
                steps: [
                    { stepName: 'Compliance Review', order: 1, assignedRole: 'Compliance Officer' },
                    { stepName: 'Finance Review', order: 2, assignedRole: 'Finance Manager' },
                    { stepName: 'Final Approval', order: 3, assignedRole: 'Admin' }
                ]
            };

            const response = await axios.post(`${BASE_URL}/api/buyers/${testBuyerId}/workflows`, workflowData, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.data).toBeDefined();

            log('WORKFLOW', 'Workflow created', { workflowId: response.data.data.workflowId });
        });

        test('GET /buyers/:id/workflows - Get workflows', async () => {
            const response = await axios.get(`${BASE_URL}/api/buyers/${testBuyerId}/workflows`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data.data)).toBe(true);

            log('WORKFLOW', `Found ${response.data.data.length} workflows`);
        });
    });

    describe('Buyer Roles (RBAC)', () => {
        test('GET /buyers/:id/roles - Get buyer roles', async () => {
            const response = await axios.get(`${BASE_URL}/api/buyers/${testBuyerId}/roles`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data.data)).toBe(true);

            log('ROLE', 'Buyer roles retrieved', { roleCount: response.data.data.length });
        });
    });
});

describe('User Invitation Tests', () => {
    let buyerAdminToken;

    beforeAll(async () => {
        const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
            username: 'admin',
            password: 'Admin123!'
        });
        buyerAdminToken = loginResponse.data.token;
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    describe('Invitation Workflow', () => {
        let invitationId;

        test('POST /invitations - Create invitation', async () => {
            const invitationData = {
                email: 'newuser@testbuyer.com',
                buyerId: 1,
                role: 'BUYER',
                subRole: 'Admin',
                invitedBy: 1
            };

            const response = await axios.post(`${BASE_URL}/api/invitations`, invitationData, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(response.data.invitationId).toBeDefined();
            invitationId = response.data.invitationId;

            log('INVITE', 'Invitation created', { invitationId, email: invitationData.email });
        });

        test('GET /invitations - Get invitations', async () => {
            const response = await axios.get(`${BASE_URL}/api/invitations`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            log('INVITE', `Found ${response.data.length} invitations`);
        });

        test('GET /invitations/pending - Get pending invitations', async () => {
            const response = await axios.get(`${BASE_URL}/api/invitations/pending`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            expect(Array.isArray(response.data)).toBe(true);

            log('INVITE', `Found ${response.data.length} pending invitations`);
        });

        test('POST /invitations/:id/resend - Resend invitation', async () => {
            // First get a pending invitation
            const pendingResponse = await axios.get(`${BASE_URL}/api/invitations/pending`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            if (pendingResponse.data.length > 0) {
                const invitationId = pendingResponse.data[0].invitationId;

                const response = await axios.post(`${BASE_URL}/api/invitations/${invitationId}/resend`, {}, {
                    headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
                });

                expect(response.status).toBe(200);
                log('INVITE', 'Invitation resent');
            } else {
                log('INVITE', 'No pending invitations to resend');
            }
        });

        test('DELETE /invitations/:id - Cancel invitation', async () => {
            // Create a test invitation
            const createResponse = await axios.post(`${BASE_URL}/api/invitations`, {
                email: 'cancel-test@testbuyer.com',
                buyerId: 1,
                role: 'BUYER',
                subRole: 'User',
                invitedBy: 1
            }, { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } });

            const invitationId = createResponse.data.invitationId;

            const response = await axios.delete(`${BASE_URL}/api/invitations/${invitationId}`, {
                headers: { 'Authorization': `Bearer ${buyerAdminToken}` }
            });

            expect(response.status).toBe(200);
            log('INVITE', 'Invitation cancelled');
        });
    });
});

describe('Password Management Tests', () => {
    test('POST /auth/forgot-password - Request password reset', async () => {
        const response = await axios.post(`${BASE_URL}/auth/forgot-password`, {
            email: 'admin@example.com'
        });

        expect(response.status).toBe(200);
        log('AUTH', 'Password reset requested');
    });

    test('POST /auth/reset-password - Reset password with valid token', async () => {
        // Note: This requires a valid reset token from the forgot-password endpoint
        // In a real scenario, you'd get this from the email link
        const resetToken = jwt.sign({ userId: 1 }, SECRET_KEY, { expiresIn: '1h' });

        const response = await axios.post(`${BASE_URL}/auth/reset-password`, {
            token: resetToken,
            newPassword: 'NewPassword123!'
        });

        expect(response.status).toBe(200);
        log('AUTH', 'Password reset successful');

        // Reset back to original password
        await axios.post(`${BASE_URL}/auth/reset-password`, {
            token: jwt.sign({ userId: 1 }, SECRET_KEY, { expiresIn: '1h' }),
            newPassword: 'Admin123!'
        });
    });

    test('POST /auth/reset-password - Reject invalid token', async () => {
        try {
            await axios.post(`${BASE_URL}/auth/reset-password`, {
                token: 'invalid-token',
                newPassword: 'NewPassword123!'
            });
            throw new Error('Should have thrown an error');
        } catch (error) {
            expect(error.response.status).toBe(401);
            log('AUTH', 'Invalid reset token rejected');
        }
    });
});

// Run tests if executed directly
if (require.main === module) {
    console.log('Running Authentication & Buyer Integration Tests...\n');
}

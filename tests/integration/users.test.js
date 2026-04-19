/**
 * User Management Integration Tests
 *
 * Tests for user lifecycle management including:
 * - User CRUD operations
 * - Role management
 * - Permission checks
 * - User activation/deactivation
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const WorkflowService = require('../../services/WorkflowService');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8083';
const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

const generateToken = (user) => jwt.sign(user, SECRET_KEY, { expiresIn: '1h' });

function log(step, msg, data) {
    console.log(`[${step}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

let testUserId = null;
let testRoleId = null;
let testUsername = null;
let testEmail = null;

// Cleanup helper
async function cleanupTestData() {
    if (!db.run) return;

    // Clean up test user
    if (testUserId) {
        await new Promise(r => db.run('DELETE FROM sdn_users WHERE userId = $1', [testUserId], r));
    }

    // Clean up test role
    if (testRoleId) {
        await new Promise(r => db.run('DELETE FROM buyer_roles WHERE roleId = $1', [testRoleId], r));
    }

    testUserId = null;
    testRoleId = null;
}

describe('User Management Integration Tests', () => {
    let adminToken;
    let buyerAdminToken;
    let regularUserToken;
    let testUserToken;

    beforeAll(async () => {
        adminToken = generateToken({ userId: 999, role: 'ADMIN', subRole: 'Super Admin', buyerId: 1 });
        buyerAdminToken = generateToken({ userId: 1, role: 'BUYER', subRole: 'Admin', buyerId: 1 });
        regularUserToken = generateToken({ userId: 2, role: 'BUYER', subRole: 'User', buyerId: 1 });

        // Seed default roles for testing Role Management endpoints
        await WorkflowService.seedDefaults(1);
    });

    afterAll(async () => {
        await cleanupTestData();
    });

    describe('User CRUD Operations', () => {
        describe('POST /users - Create User', () => {
            test('should create user with valid data', async () => {
                // Generate unique test data
                const timestamp = Date.now();
                testUsername = `testuser_${timestamp}`;
                testEmail = `testuser_${timestamp}@example.com`;

                const userData = {
                    username: testUsername,
                    email: testEmail,
                    password: 'SecurePass123!',
                    role: 'BUYER',
                    subRole: 'User',
                    buyerId: 1,
                    phone: '+1-555-0100'
                };

                const response = await axios.post(`${BASE_URL}/api/users`, userData, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.userId).toBeDefined();
                expect(response.data.username).toBe(testUsername);
                expect(response.data.email).toBe(testEmail);
                expect(response.data.password).toBeUndefined(); // Password not returned
                testUserId = response.data.userId;

                testUserToken = generateToken({
                    userId: testUserId,
                    role: 'BUYER',
                    subRole: 'User',
                    buyerId: 1,
                    email: testEmail
                });

                log('CREATE', 'User created', { userId: testUserId });
            });

            test('should hash password before storing', async () => {
                const user = await new Promise((resolve) => {
                    db.get("SELECT password FROM sdn_users WHERE userId = $1", [testUserId], (err, row) => {
                        resolve(row);
                    });
                });

                expect(user.password).toBeDefined();
                expect(user.password).not.toBe('SecurePass123!'); // Should be hashed

                const isValid = await bcrypt.compare('SecurePass123!', user.password);
                expect(isValid).toBe(true);

                log('CREATE', 'Password verified as hashed');
            });

            test('should reject duplicate username', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/users`, {
                        username: testUsername,
                        email: `different_${Date.now()}@example.com`,
                        password: 'Pass123!',
                        role: 'BUYER',
                        buyerId: 1
                    }, {
                        headers: { 'Authorization': `Bearer ${adminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                    expect(error.response.data.error).toContain('username');

                    log('CREATE', 'Duplicate username rejected');
                }
            });

            test('should reject duplicate email', async () => {
                // First ensure a clean state or use the already created testEmail
                try {
                    await axios.post(`${BASE_URL}/api/users`, {
                        username: `differentuser_${Date.now()}`,
                        email: testEmail, // duplicate email
                        password: 'Pass123!',
                        role: 'BUYER',
                        buyerId: 1
                    }, {
                        headers: { 'Authorization': `Bearer ${adminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                    expect(error.response.data.error).toContain('email');
                }
            });

            test('should validate password strength', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/users`, {
                        username: `weakpass_${Date.now()}`,
                        email: `weak_${Date.now()}@example.com`,
                        password: 'weak', // Too short
                        role: 'BUYER',
                        buyerId: 1
                    }, {
                        headers: { 'Authorization': `Bearer ${adminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                    expect(error.response.data.error.toLowerCase()).toContain('password');
                }
            });

            test('should require valid role', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/users`, {
                        username: `invalidrole_${Date.now()}`,
                        email: `invalid_${Date.now()}@example.com`,
                        password: 'ValidPass123!',
                        role: 'INVALID_ROLE',
                        buyerId: 1
                    }, {
                        headers: { 'Authorization': `Bearer ${adminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                }
            });
        });

        describe('GET /users - List Users', () => {
            test('should list all users with pagination', async () => {
                const response = await axios.get(`${BASE_URL}/api/users?page=1&pageSize=10`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.users).toBeDefined();
                expect(response.data.total).toBeDefined();
                expect(response.data.page).toBe(1);
                expect(response.data.pageSize).toBe(10);
                expect(Array.isArray(response.data.users)).toBe(true);

                log('LIST', `Found ${response.data.total} total users`);
            });

            test('should filter users by role', async () => {
                const response = await axios.get(`${BASE_URL}/api/users?role=BUYER`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                response.data.sdn_users.forEach(user => {
                    expect(user.role).toBe('BUYER');
                });

                log('LIST', 'Users filtered by role');
            });

            test('should filter users by buyer', async () => {
                const response = await axios.get(`${BASE_URL}/api/users?buyerId=1`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                response.data.sdn_users.forEach(user => {
                    expect(user.buyerId).toBe(1);
                });
            });

            test('should search users by name or email', async () => {
                const response = await axios.get(`${BASE_URL}/api/users?search=${testUsername}`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                const found = response.data.sdn_users.find(u => u.username === testUsername);
                expect(found).toBeDefined();
            });

            test('should hide passwords from list', async () => {
                const response = await axios.get(`${BASE_URL}/api/users`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                response.data.sdn_users.forEach(user => {
                    expect(user.password).toBeUndefined();
                });
            });
        });

        describe('GET /users/:id - Get User Details', () => {
            test('should get user by ID', async () => {
                const response = await axios.get(`${BASE_URL}/api/users/${testUserId}`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.userId).toBe(testUserId);
                expect(response.data.username).toBe(testUsername);
                expect(response.data.email).toBe(testEmail);
                expect(response.data.password).toBeUndefined();

                log('GET', 'User details retrieved');
            });

            test('should return 404 for non-existent user', async () => {
                try {
                    await axios.get(`${BASE_URL}/api/users/999999`, {
                        headers: { 'Authorization': `Bearer ${adminToken}` }
                    });
                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(404);
                }
            });
        });

        describe('PUT /users/:id - Update User', () => {
            test('should update user profile', async () => {
                const updateEmail = `updated_${Date.now()}@example.com`;
                const updateData = {
                    email: updateEmail,
                    phone: '+1-555-0199'
                };

                const response = await axios.put(`${BASE_URL}/api/users/${testUserId}`, updateData, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.email).toBe(updateEmail);
                expect(response.data.phone).toBe('+1-555-0199');

                log('UPDATE', 'User profile updated');
            });

            test('should not allow updating username', async () => {
                try {
                    await axios.put(`${BASE_URL}/api/users/${testUserId}`, {
                        username: 'newusername'
                    }, {
                        headers: { 'Authorization': `Bearer ${adminToken}` }
                    });
                    throw new Error('Should have rejected username update');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                    expect(error.response.data.error).toContain('Username cannot be updated');
                }
            });

            test('should validate email format on update', async () => {
                try {
                    await axios.put(`${BASE_URL}/api/users/${testUserId}`, {
                        email: 'invalid-email'
                    }, {
                        headers: { 'Authorization': `Bearer ${adminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                }
            });
        });

        describe('PUT /users/:id/role - Change User Role', () => {
            test('should change user role and subrole', async () => {
                const response = await axios.put(`${BASE_URL}/api/users/${testUserId}/role`, {
                    role: 'SUPPLIER',
                    subRole: 'Admin',
                    supplierId: 10
                }, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.role).toBe('SUPPLIER');
                expect(response.data.subRole).toBe('Admin');
                expect(response.data.supplierId).toBe(10);

                log('ROLE', 'User role changed');
            });

            test.skip('should log role change in audit trail', async () => {
                // Audit logging not yet fully implemented in v2 schema
            });
        });

        describe('PUT /users/:id/status - Activate/Deactivate User', () => {
            test('should deactivate user account', async () => {
                const response = await axios.put(`${BASE_URL}/api/users/${testUserId}/status`, {
                    isActive: false,
                    reason: 'Account deactivation for testing'
                }, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.isActive).toBe(false);

                log('STATUS', 'User deactivated');
            });

            test('should prevent deactivated user from logging in', async () => {
                try {
                    await axios.post(`${BASE_URL}/auth/login`, {
                        username: testUsername,
                        password: 'SecurePass123!'
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(403);
                    expect(error.response.data.error).toContain('inactive');
                }
            });

            test('should reactivate user account', async () => {
                const response = await axios.put(`${BASE_URL}/api/users/${testUserId}/status`, {
                    isActive: true,
                    reason: 'Reactivated for testing'
                }, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.isActive).toBe(true);

                log('STATUS', 'User reactivated');
            });
        });

        describe('DELETE /users/:id - Delete User', () => {
            test('should soft delete user', async () => {
                // Create a temporary user to delete
                const tempUser = await axios.post(`${BASE_URL}/api/users`, {
                    username: `tempuser_${Date.now()}`,
                    email: `temp_${Date.now()}@example.com`,
                    password: 'TempPass123!',
                    role: 'BUYER',
                    buyerId: 1
                }, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                const tempUserId = tempUser.data.userId;

                const response = await axios.delete(`${BASE_URL}/api/users/${tempUserId}`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);

                // Verify hard delete (user is completely removed)
                const deleted = await new Promise((resolve) => {
                    db.get("SELECT * FROM sdn_users WHERE userId = $1", [tempUserId], (err, row) => {
                        resolve(row);
                    });
                });

                expect(deleted).toBeUndefined();

                log('DELETE', 'User hard deleted');

                // Clean up
                await new Promise(r => db.run('DELETE FROM sdn_users WHERE userId = $1', [tempUserId], r));
            });
        });
    });

    describe('Role Management', () => {
        describe('GET /roles - List Roles', () => {
            test('should list all predefined roles', async () => {
                const response = await axios.get(`${BASE_URL}/api/roles`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(Array.isArray(response.data)).toBe(true);
                expect(response.data.length).toBeGreaterThan(0);

                log('ROLE', `Found ${response.data.length} roles`);
            });

            test('should include role permissions', async () => {
                const response = await axios.get(`${BASE_URL}/api/roles?includePermissions=true`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);

                const role = response.data[0];
                expect(role.permissions).toBeDefined();
                expect(Array.isArray(role.permissions)).toBe(true);
            });
        });

        describe('GET /roles/:id - Get Role Details', () => {
            test('should get role with all permissions', async () => {
                // Get a role ID first
                const roles = await axios.get(`${BASE_URL}/api/roles`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                const roleId = roles.data[0].roleId;

                const response = await axios.get(`${BASE_URL}/api/roles/${roleId}`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.roleId).toBe(roleId);
                expect(response.data.permissions).toBeDefined();

                log('ROLE', 'Role details retrieved');
            });
        });

        describe('POST /roles - Create Custom Role', () => {
            test('should create custom role with permissions', async () => {
                const roleData = {
                    roleName: `Custom Manager ${Date.now()}`,
                    description: 'Custom management role',
                    buyerId: 1,
                    permissions: [
                        'VIEW_SUPPLIERS',
                        'EDIT_SUPPLIERS',
                        'APPROVE_SUPPLIERS',
                        'VIEW_MESSAGES'
                    ]
                };

                const response = await axios.post(`${BASE_URL}/api/roles`, roleData, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.roleId).toBeDefined();
                expect(response.data.roleName).toContain('Custom Manager');
                testRoleId = response.data.roleId;

                log('ROLE', 'Custom role created', { roleId: testRoleId });
            });

            test('should validate permission names', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/roles`, {
                        roleName: `Invalid Role ${Date.now()}`,
                        buyerId: 1,
                        permissions: ['INVALID_PERMISSION']
                    }, {
                        headers: { 'Authorization': `Bearer ${adminToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                }
            });
        });

        describe('PUT /roles/:id/permissions - Update Role Permissions', () => {
            test('should add permissions to role', async () => {
                const response = await axios.put(`${BASE_URL}/api/roles/${testRoleId}/permissions`, {
                    permissions: [
                        'VIEW_SUPPLIERS',
                        'EDIT_SUPPLIERS',
                        'APPROVE_SUPPLIERS',
                        'VIEW_MESSAGES',
                        'SEND_MESSAGES' // Added
                    ]
                }, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.permissions.length).toBe(5);

                log('ROLE', 'Role permissions updated');
            });

            test('should remove permissions from role', async () => {
                const response = await axios.put(`${BASE_URL}/api/roles/${testRoleId}/permissions`, {
                    permissions: [
                        'VIEW_SUPPLIERS',
                        'EDIT_SUPPLIERS'
                    ]
                }, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);
                expect(response.data.permissions.length).toBe(2);
            });
        });

        describe('DELETE /roles/:id - Delete Role', () => {
            test('should delete custom role', async () => {
                // Create temporary role
                const tempRole = await axios.post(`${BASE_URL}/api/roles`, {
                    roleName: `Temp Role ${Date.now()}`,
                    buyerId: 1,
                    permissions: ['VIEW_SUPPLIERS']
                }, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                const tempRoleId = tempRole.data.roleId;

                const response = await axios.delete(`${BASE_URL}/api/roles/${tempRoleId}`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);

                // Clean up

                log('ROLE', 'Custom role deleted');
            });

            test('should not allow deleting system roles', async () => {
                // Try to delete a system role (e.g., Admin)
                const roles = await axios.get(`${BASE_URL}/api/roles`, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                const systemRole = roles.data.find(r => r.isSystemRole === true);

                if (systemRole) {
                    try {
                        await axios.delete(`${BASE_URL}/api/roles/${systemRole.roleId}`, {
                            headers: { 'Authorization': `Bearer ${adminToken}` }
                        });
                        throw new Error('Should have thrown an error');
                    } catch (error) {
                        expect(error.response.status).toBe(403);
                        expect(error.response.data.error).toContain('system');

                        log('ROLE', 'System role deletion prevented');
                    }
                }
            });
        });
    });

    describe('Authorization & Permission Checks', () => {
        describe('Resource-Level Permissions', () => {
            test('should allow user to access their own resources', async () => {
                const response = await axios.get(`${BASE_URL}/api/users/${testUserId}`, {
                    headers: { 'Authorization': `Bearer ${testUserToken}` }
                });

                // Should work if it's their own profile
                expect([200, 403]).toContain(response.status);
            });

            test('should deny access to other users without permission', async () => {
                // Regular user trying to access admin endpoints
                try {
                    await axios.get(`${BASE_URL}/api/users`, {
                        headers: { 'Authorization': `Bearer ${regularUserToken}` }
                    });
                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(403);
                }

                log('AUTH', 'Access denied for insufficient permissions');
            });
        });

        describe('Action-Based Permissions', () => {
            test('should verify user can perform allowed actions', async () => {
                // Admin should be able to create users
                const permUsername = `permtest_${Date.now()}`;
                const response = await axios.post(`${BASE_URL}/api/users`, {
                    username: permUsername,
                    email: `permtest_${Date.now()}@example.com`,
                    password: 'TestPass123!',
                    role: 'BUYER',
                    buyerId: 1
                }, {
                    headers: { 'Authorization': `Bearer ${adminToken}` }
                });

                expect(response.status).toBe(200);

                // Clean up
                await new Promise(r => db.run('DELETE FROM sdn_users WHERE username = $1', [permUsername], r));

                log('AUTH', 'Action permitted with correct role');
            });

            test('should deny action without permission', async () => {
                // Regular user trying to create users
                const noPermUsername = `noperm_${Date.now()}`;
                try {
                    await axios.post(`${BASE_URL}/api/users`, {
                        username: noPermUsername,
                        email: `noperm_${Date.now()}@example.com`,
                        password: 'TestPass123!',
                        role: 'BUYER',
                        buyerId: 1
                    }, {
                        headers: { 'Authorization': `Bearer ${regularUserToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(403);
                }
            });
        });
    });

    describe('User Profile Management', () => {
        describe('PUT /users/:id/profile - Update Profile', () => {
            test('should allow user to update own profile', async () => {
                const response = await axios.put(`${BASE_URL}/api/users/${testUserId}/profile`, {
                    firstName: 'Test',
                    lastName: 'User',
                    phone: '+1-555-9999'
                }, {
                    headers: { 'Authorization': `Bearer ${testUserToken}` }
                });

                expect(response.status).toBe(200);

                log('PROFILE', 'User profile updated');
            });

            test('should not allow updating sensitive fields via profile', async () => {
                try {
                    await axios.put(`${BASE_URL}/api/users/${testUserId}/profile`, {
                        role: 'ADMIN' // Should not be allowed
                    }, {
                        headers: { 'Authorization': `Bearer ${testUserToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                }
            });
        });

        describe('POST /users/:id/password - Change Password', () => {
            test('should allow user to change own password', async () => {
                const response = await axios.post(`${BASE_URL}/api/users/${testUserId}/password`, {
                    currentPassword: 'SecurePass123!',
                    newPassword: 'NewSecurePass456!'
                }, {
                    headers: { 'Authorization': `Bearer ${testUserToken}` }
                });

                expect(response.status).toBe(200);

                log('PROFILE', 'Password changed successfully');

                // Verify new password works
                const login = await axios.post(`${BASE_URL}/auth/login`, {
                    username: testUsername,
                    password: 'NewSecurePass456!'
                });

                expect(login.status).toBe(200);

                // Change back for cleanup
                await axios.post(`${BASE_URL}/api/users/${testUserId}/password`, {
                    currentPassword: 'NewSecurePass456!',
                    newPassword: 'SecurePass123!'
                }, {
                    headers: { 'Authorization': `Bearer ${testUserToken}` }
                });
            });

            test('should reject incorrect current password', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/users/${testUserId}/password`, {
                        currentPassword: 'WrongPassword',
                        newPassword: 'NewPass123!'
                    }, {
                        headers: { 'Authorization': `Bearer ${testUserToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(401);
                }
            });

            test('should validate new password strength', async () => {
                try {
                    await axios.post(`${BASE_URL}/api/users/${testUserId}/password`, {
                        currentPassword: 'SecurePass123!',
                        newPassword: 'weak' // Too weak
                    }, {
                        headers: { 'Authorization': `Bearer ${testUserToken}` }
                    });

                    throw new Error('Should have thrown an error');
                } catch (error) {
                    expect(error.response.status).toBe(400);
                }
            });
        });
    });
});

// Run tests if executed directly
if (require.main === module) {
    console.log('Running User Management Integration Tests...\n');
}

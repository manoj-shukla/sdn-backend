/**
 * Bulk Operations Tests
 *
 * Test Scenarios:
 * 1. Bulk invite suppliers
 * 2. Bulk add suppliers from ERP
 * 3. Bulk document upload
 * 4. Bulk user creation
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const db = require('../../config/database');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8083';
const SECRET_KEY = process.env.JWT_SECRET || "sdn-tech-super-secret-key";

// Helper: Generate unique test data
function generateUnique(base) {
    return `${base}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

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
            subRole: user.subRole || user.subrole || user.SUBROLE,
            buyerId: user.buyerId || user.buyerid || user.BUYERID,
            supplierId: user.supplierId || user.supplierid || user.SUPPLIERID
        },
        SECRET_KEY,
        { expiresIn: '1h' }
    );
}

describe('Bulk Operations Tests', () => {
    let buyerId;
    let buyerAdminToken;
    let testFilePath;
    let supplierId;
    let testUsername;
    let testBuyerName;

    beforeAll(async () => {
        try {
            // Generate unique test data
            testBuyerName = generateUnique('Bulk Operations Buyer');
            testUsername = generateUnique('bulk_buyer_admin');
            const testEmail = generateUnique('bulkadmin');

            // Create test buyer
            const buyerResult = await query(
                'INSERT INTO buyers (buyerName, email) VALUES ($1, $2) RETURNING buyerId',
                [testBuyerName, `${testEmail}@example.com`]
            );
            buyerId = buyerResult.rows[0].buyerid;

            // Create buyer admin user
            const passwordHash = await require('bcryptjs').hash('BuyerAdmin123!', 10);
            const userResult = await query(
                `INSERT INTO sdn_users (username, password, email, role, buyerId, subRole)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING userId`,
                [testUsername, passwordHash, `${testEmail}@example.com`, 'BUYER', buyerId, 'Buyer Admin']
            );

            buyerAdminToken = generateToken({
                userId: userResult.rows[0].userid,
                username: testUsername,
                role: 'BUYER',
                buyerId,
                subRole: 'Buyer Admin'
            });

            // Create a test supplier for document upload tests
            const supplierResult = await query(
                'INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus) VALUES ($1, $2, $3, $4, $5) RETURNING supplierId',
                [buyerId, 'Bulk Operations Supplier', 'LLC', 'US', 'ACTIVE']
            );
            supplierId = supplierResult.rows[0].supplierid;

            // Create template file for bulk upload
            testFilePath = path.join(__dirname, 'test-bulk-upload.csv');
            fs.writeFileSync(testFilePath,
                'Legal Name,Business Type,Country,Email,Phone\n' +
                'Bulk Supplier 1,LLC,US,bulk1@example.com,+1-555-0101\n' +
                'Bulk Supplier 2,Corporation,UK,bulk2@example.com,+44-20-1234\n' +
                'Bulk Supplier 3,Sole Proprietorship,CA,bulk3@example.com,+1-800-555-0100\n'
            );

            log('SETUP', 'Test data created', { buyerId });

        } catch (err) {
            log('SETUP', 'Setup failed', { error: err.message });
        }
    });

    afterAll(async () => {
        try {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
            await query('DELETE FROM sdn_users WHERE username IN ($1, $2, $3, $4, $5)', ['bulkuser1', 'bulkuser2', 'bulkuser3', 'bulkuser4', 'bulkuser5']);
            await query('DELETE FROM suppliers WHERE legalName LIKE $1', [`Bulk Supplier%`]);
            await query('DELETE FROM invitations WHERE buyerId = $1', [buyerId]);
            await query('DELETE FROM sdn_users WHERE username = $1', [testUsername]);
            await query('DELETE FROM buyers WHERE buyerName = $1', [testBuyerName]);
            log('CLEANUP', 'Test data deleted');
        } catch (err) {
            log('CLEANUP', 'Cleanup failed', { error: err.message });
        }
    });

    describe('Bulk Invite Suppliers', () => {
        test('should send multiple invitations', async () => {
            const invitations = [
                { email: generateUnique('invite1') + '@example.com', companyName: 'Invite Supplier 1' },
                { email: generateUnique('invite2') + '@example.com', companyName: 'Invite Supplier 2' },
                { email: generateUnique('invite3') + '@example.com', companyName: 'Invite Supplier 3' }
            ];

            const response = await axios.post(`${BASE_URL}/api/invitations/bulk`,
                { invitations },
                { headers: { 'Authorization': `Bearer ${buyerAdminToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('invitations');
            expect(response.data.invitations.length).toBe(3);

            // Verify invitations were created in database
            const invites = await query('SELECT * FROM invitations WHERE email IN ($1, $2, $3)', ['invite1@example.com', 'invite2@example.com', 'invite3@example.com']
            );

            expect(invites.rows.length).toBe(3);

            log('BULK_INVITE', 'Sent multiple invitations', {
                count: response.data.invitations.length
            });
        });

        test('should handle duplicate emails in bulk invite', async () => {
            const invitations = [
                { email: 'duplicate@example.com', companyName: 'Test' },
                { email: 'duplicate@example.com', companyName: 'Test 2' },
                { email: 'unique@example.com', companyName: 'Unique' }
            ];

            const response = await axios.post(`${BASE_URL}/api/invitations/bulk`,
                { invitations },
                { headers: { Authorization: `Bearer ${buyerAdminToken}` } }
            );

            expect(response.status).toBe(200);
            // Should handle duplicates gracefully
            expect(response.data).toHaveProperty('summary');

            log('BULK_INVITE', 'Handled duplicates', response.data.summary);
        });

        test('should validate all email addresses before sending', async () => {
            const invalidInvitations = [
                { email: 'invalid-email', companyName: 'Test' },
                { email: 'test@', companyName: 'Test' },
                { email: 'valid@example.com', companyName: 'Valid' }
            ];

            const response = await axios.post(`${BASE_URL}/api/invitations/bulk`,
                { invitations: invalidInvitations },
                { headers: { Authorization: `Bearer ${buyerAdminToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('errors');
            expect(response.data.errors.length).toBeGreaterThan(0);

            log('BULK_INVITE', 'Validated emails', {
                errorCount: response.data.errors.length
            });
        });

        test('should track bulk invitation progress', async () => {
            const invitations = [
                { email: 'progress1@example.com', companyName: 'Progress 1' },
                { email: 'progress2@example.com', companyName: 'Progress 2' },
                { email: 'progress3@example.com', companyName: 'Progress 3' },
                { email: 'progress4@example.com', companyName: 'Progress 4' }
            ];

            const response = await axios.post(`${BASE_URL}/api/invitations/bulk`,
                { invitations },
                { headers: { Authorization: `Bearer ${buyerAdminToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('batchId');
            expect(response.data).toHaveProperty('total');

            log('BULK_INVITE', 'Tracked progress', {
                batchId: response.data.batchId,
                total: response.data.total
            });
        });
    });

    describe('Bulk Add Suppliers from ERP', () => {
        test('should import suppliers from CSV file', async () => {
            const form = new FormData();
            form.append('file', fs.createReadStream(testFilePath));

            const response = await axios.post(`${BASE_URL}/api/suppliers/bulk-upload`,
                form,
                {
                    headers: {
                        'Authorization': `Bearer ${buyerAdminToken}`,
                        ...form.getHeaders()
                    }
                }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('imported');
            expect(response.data.imported).toBeGreaterThan(0);

            log('BULK_ERP', 'Imported suppliers from CSV', {
                imported: response.data.imported,
                failed: response.data.failed || 0
            });
        });

        test('should validate CSV format and data types', async () => {
            // Create invalid CSV
            const invalidFilePath = path.join(__dirname, 'test-invalid.csv');
            fs.writeFileSync(invalidFilePath,
                'InvalidHeader,InvalidData,InvalidCountry\n' +
                'Test,LLC,INVALID,data@test.com,+1234567890\n'
            );

            const form = new FormData();
            form.append('file', fs.createReadStream(invalidFilePath));

            const response = await axios.post(`${BASE_URL}/api/suppliers/bulk-upload`,
                form,
                {
                    headers: {
                        'Authorization': `Bearer ${buyerAdminToken}`,
                        ...form.getHeaders()
                    }
                }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('errors');
            expect(response.data.errors.length).toBeGreaterThan(0);

            // Cleanup
            fs.unlinkSync(invalidFilePath);

            log('BULK_ERP', 'Validated CSV format', {
                errorCount: response.data.errors.length
            });
        });

        test('should handle duplicate records in ERP import', async () => {
            // Create existing supplier
            await query(`INSERT INTO suppliers (buyerId, legalName, businessType, country, approvalStatus)
                 VALUES($1, $2, $3, $4, $5)`, [buyerId, 'Duplicate Supplier', 'LLC', 'US', 'ACTIVE']
            );

            // Import CSV with duplicate
            const duplicateFilePath = path.join(__dirname, 'test-duplicate.csv');
            fs.writeFileSync(duplicateFilePath,
                'Legal Name,Business Type,Country,Email\n' +
                'Duplicate Supplier,LLC,US,dup@example.com,+1234567890\n'
            );

            const form = new FormData();
            form.append('file', fs.createReadStream(duplicateFilePath));

            const response = await axios.post(`${BASE_URL}/api/suppliers/bulk-upload`,
                form,
                {
                    headers: {
                        'Authorization': `Bearer ${buyerAdminToken}`,
                        ...form.getHeaders()
                    }
                }
            );

            expect(response.status).toBe(200);
            // Should either skip or update existing records
            expect(response.data).toHaveProperty('duplicates');

            // Cleanup
            fs.unlinkSync(duplicateFilePath);

            log('BULK_ERP', 'Handled duplicates', response.data);
        });

        test('should track import progress and provide status', async () => {
            const form = new FormData();
            form.append('file', fs.createReadStream(testFilePath));

            const response = await axios.post(`${BASE_URL}/api/suppliers/bulk-upload`,
                form,
                {
                    headers: {
                        'Authorization': `Bearer ${buyerAdminToken}`,
                        ...form.getHeaders()
                    }
                }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('jobId');
            expect(response.data).toHaveProperty('status');

            // Poll for status
            const jobId = response.data.jobId;
            let completed = false;
            let attempts = 0;

            while (!completed && attempts < 10) {
                await new Promise(resolve => setTimeout(resolve, 500));
                const statusResponse = await axios.get(`${BASE_URL}/api/suppliers/bulk-upload/${jobId}`,
                    { headers: { Authorization: `Bearer ${buyerAdminToken}` } }
                );

                if (statusResponse.data.status === 'completed' || statusResponse.data.status === 'failed') {
                    completed = true;
                    expect(['completed', 'failed']).toContain(statusResponse.data.status);
                }

                attempts++;
            }

            log('BULK_ERP', 'Import job completed', { attempts });
        });
    });

    describe('Bulk Document Upload', () => {
        test('should upload multiple documents for validation', async () => {
            // Create multiple test files
            const doc1Path = path.join(__dirname, 'test-doc1.pdf');
            const doc2Path = path.join(__dirname, 'test-doc2.pdf');
            const doc3Path = path.join(__dirname, 'test-doc3.pdf');

            fs.writeFileSync(doc1Path, 'Test document 1');
            fs.writeFileSync(doc2Path, 'Test document 2');
            fs.writeFileSync(doc3Path, 'Test document 3');

            const form = new FormData();
            form.append('documents', fs.createReadStream(doc1Path));
            form.append('documents', fs.createReadStream(doc2Path));
            form.append('documents', fs.createReadStream(doc3Path));
            form.append('supplierId', supplierId.toString());

            const response = await axios.post(`${BASE_URL}/api/documents/bulk-upload`,
                form,
                {
                    headers: {
                        'Authorization': `Bearer ${buyerAdminToken}`,
                        ...form.getHeaders()
                    }
                }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('uploaded');
            expect(response.data.uploaded).toBeGreaterThanOrEqual(3);

            // Cleanup
            [doc1Path, doc2Path, doc3Path].forEach(f => {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            });

            log('BULK_DOCUMENTS', 'Uploaded multiple documents', {
                uploaded: response.data.uploaded
            });
        });

        test('should validate document types in bulk upload', async () => {
            // Create files with invalid extensions
            const invalidDocPath = path.join(__dirname, 'test-invalid.txt');
            fs.writeFileSync(invalidDocPath, 'Invalid document');

            const form = new FormData();
            form.append('documents', fs.createReadStream(invalidDocPath));
            form.append('supplierId', supplierId.toString());

            try {
                const response = await axios.post(`${BASE_URL}/api/documents/bulk-upload`,
                    form,
                    {
                        headers: {
                            'Authorization': `Bearer ${buyerAdminToken}`,
                            ...form.getHeaders()
                        }
                    }
                );
                expect(response.status).toBe(400);
            } catch (error) {
                expect(error.response.status).toBe(400);
                expect(error.response.data).toHaveProperty('error');
            }

            // Cleanup
            fs.unlinkSync(invalidDocPath);
        });

        test('should enforce file size limits', async () => {
            // Create a file larger than limit (assuming 10MB limit)
            const largeFilePath = path.join(__dirname, 'test-large.pdf');
            const buffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
            fs.writeFileSync(largeFilePath, buffer);

            const form = new FormData();
            form.append('documents', fs.createReadStream(largeFilePath));
            form.append('supplierId', supplierId.toString());

            try {
                const response = await axios.post(`${BASE_URL}/api/documents/bulk-upload`,
                    form,
                    {
                        headers: {
                            'Authorization': `Bearer ${buyerAdminToken}`,
                            ...form.getHeaders()
                        },
                        maxContentLength: 12 * 1024 * 1024
                    }
                );

                // Should reject file
                expect([400, 413]).toContain(response.status);

                log('BULK_DOCUMENTS', 'Enforced file size limit', { status: response.status });

            } catch (error) {
                expect([400, 413]).toContain(error.response.status);
            } finally {
                // Cleanup
                fs.unlinkSync(largeFilePath);
            }
        });
    });

    describe('Bulk User Creation', () => {
        test('should create multiple users at once', async () => {
            const users = [
                { username: 'bulkuser1', password: 'Password1!', email: 'bulkuser1@example.com', role: 'BUYER', buyerId },
                { username: 'bulkuser2', password: 'Password2!', email: 'bulkuser2@example.com', role: 'BUYER', buyerId },
                { username: 'bulkuser3', password: 'Password3!', email: 'bulkuser3@example.com', role: 'BUYER', buyerId }
            ];

            const response = await axios.post(`${BASE_URL}/api/users/bulk`,
                { users },
                { headers: { Authorization: `Bearer ${buyerAdminToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('created');
            expect(response.data.created).toBe(3);

            // Verify users were created
            const createdUsers = await query('SELECT * FROM sdn_users WHERE username IN ($1, $2, $3)', ['bulkuser1', 'bulkuser2', 'bulkuser3']
            );

            expect(createdUsers.rows.length).toBe(3);

            log('BULK_USERS', 'Created multiple users', {
                created: response.data.created
            });
        });

        test('should validate all users before bulk creation', async () => {
            const users = [
                { username: 'invalid user!', password: 'Pass1!', email: 'invalid', role: 'BUYER', buyerId },
                { username: 'bulkuser4', password: 'weak', email: 'bulkuser4@example.com', role: 'BUYER', buyerId },
                { username: 'bulkuser5', password: 'Password5!', email: 'bulkuser5@example.com', role: 'BUYER', buyerId }
            ];

            const response = await axios.post(`${BASE_URL}/api/users/bulk`,
                { users },
                { headers: { Authorization: `Bearer ${buyerAdminToken}` } }
            );

            expect(response.status).toBe(200);
            expect(response.data).toHaveProperty('errors');
            expect(response.data.errors.length).toBe(2); // invalid user! and weak password

            log('BULK_USERS', 'Validated before creation', {
                errorCount: response.data.errors.length
            });
        });

        test('should hash passwords for all users in bulk creation', async () => {
            const users = [
                { username: 'hashuser1', password: 'Password1!', email: 'hashuser1@example.com', role: 'BUYER', buyerId },
                { username: 'hashuser2', password: 'Password2!', email: 'hashuser2@example.com', role: 'BUYER', buyerId },
                { username: 'hashuser3', password: 'Password3!', email: 'hashuser3@example.com', role: 'BUYER', buyerId }
            ];

            const response = await axios.post(`${BASE_URL}/api/users/bulk`,
                { users },
                { headers: { Authorization: `Bearer ${buyerAdminToken}` } }
            );

            expect(response.status).toBe(200);

            // Verify passwords are hashed (not plain text)
            const createdUsers = await query('SELECT password FROM sdn_users WHERE username IN ($1, $2, $3)', ['hashuser1', 'hashuser2', 'hashuser3']
            );

            createdUsers.rows.forEach(user => {
                expect(user.password).not.toBe('Password1!');
                expect(user.password).not.toBe('Password2!');
                expect(user.password).not.toBe('Password3!');
                // Check if bcrypt hash (starts with $1a$ or $2b$)
                expect(user.password).toMatch(/^\$2[ab]\$/);
            });

            log('BULK_USERS', 'Passwords hashed correctly');

            // Cleanup
            await query('DELETE FROM sdn_users WHERE username IN ($1, $2, $3)', ['hashuser1', 'hashuser2', 'hashuser3']);
        });
    });
});

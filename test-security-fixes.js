/**
 * Quick verification script for RBAC security fixes
 * Run with: node test-security-fixes.js
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');

const BASE_URL = 'http://localhost:8083';
const SECRET_KEY = "sdn-tech-super-secret-key";

function generateToken(user) {
    return jwt.sign(user, SECRET_KEY, { expiresIn: '1h' });
}

async function testSupplierAccessControl() {
    console.log('\n=== Testing Supplier Access Control ===\n');

    // Create test tokens
    const supplier1Token = generateToken({
        userId: 999,
        username: 'test_supplier1',
        role: 'SUPPLIER',
        supplierId: 999
    });

    const supplier2Token = generateToken({
        userId: 1000,
        username: 'test_supplier2',
        role: 'SUPPLIER',
        supplierId: 1000
    });

    // Test 1: Supplier 1 trying to access Supplier 2
    console.log('Test 1: Supplier 1 accessing Supplier 2 (should be 403/404)...');
    try {
        const response = await axios.get(`${BASE_URL}/api/suppliers/1000`, {
            headers: { 'Authorization': `Bearer ${supplier1Token}` }
        });
        console.log(`❌ FAIL: Request succeeded with status ${response.status}`);
        console.log(`   Expected: 403 or 404`);
    } catch (error) {
        const status = error.response?.status;
        if (status === 403 || status === 404) {
            console.log(`✅ PASS: Received status ${status} (access blocked)`);
        } else if (status === 401) {
            console.log(`⚠️  WARN: Received 401 (authentication issue, not RBAC)`);
        } else {
            console.log(`❌ FAIL: Received status ${status}`);
        }
    }

    // Test 2: Supplier 1 accessing their own data (should work)
    console.log('\nTest 2: Supplier 1 accessing their own data (should be 200)...');
    try {
        const response = await axios.get(`${BASE_URL}/api/suppliers/999`, {
            headers: { 'Authorization': `Bearer ${supplier1Token}` }
        });
        if (response.status === 200) {
            console.log(`✅ PASS: Access granted to own data`);
        } else {
            console.log(`❌ FAIL: Received status ${response.status}`);
        }
    } catch (error) {
        console.log(`⚠️  WARN: Request failed - supplier 999 may not exist`);
    }

    // Test 3: Supplier 1 trying to access Supplier 2's documents
    console.log('\nTest 3: Supplier 1 accessing Supplier 2 documents (should be 403)...');
    try {
        const response = await axios.get(`${BASE_URL}/api/suppliers/1000/documents`, {
            headers: { 'Authorization': `Bearer ${supplier1Token}` }
        });
        console.log(`❌ FAIL: Request succeeded with status ${response.status}`);
    } catch (error) {
        const status = error.response?.status;
        if (status === 403) {
            console.log(`✅ PASS: Received status ${status} (access blocked)`);
        } else if (status === 401) {
            console.log(`⚠️  WARN: Received 401 (authentication issue)`);
        } else {
            console.log(`Status: ${status}`);
        }
    }
}

async function testBuyerCircleAccessControl() {
    console.log('\n\n=== Testing Buyer Circle Access Control ===\n');

    const buyer1Token = generateToken({
        userId: 2001,
        username: 'test_buyer1',
        role: 'BUYER',
        buyerId: 101
    });

    const buyer2Token = generateToken({
        userId: 2002,
        username: 'test_buyer2',
        role: 'BUYER',
        buyerId: 102
    });

    // Test 4: Buyer 1 trying to access Buyer 2's circles
    console.log('Test 4: Buyer 1 accessing Buyer 2 circles (should be 403)...');
    try {
        const response = await axios.get(`${BASE_URL}/api/circles/buyer/102`, {
            headers: { 'Authorization': `Bearer ${buyer1Token}` }
        });
        console.log(`❌ FAIL: Request succeeded with status ${response.status}`);
    } catch (error) {
        const status = error.response?.status;
        if (status === 403) {
            console.log(`✅ PASS: Received status ${status} (access blocked)`);
        } else if (status === 401) {
            console.log(`⚠️  WARN: Received 401 (authentication issue)`);
        } else {
            console.log(`Status: ${status}`);
        }
    }
}

async function main() {
    console.log('🔒 RBAC Security Fixes Verification');
    console.log('=====================================\n');

    try {
        await testSupplierAccessControl();
        await testBuyerCircleAccessControl();

        console.log('\n\n=== Summary ===');
        console.log('If tests show 401 errors, the server might not be running.');
        console.log('Start the server with: npm start');
        console.log('Then run: node test-security-fixes.js\n');
    } catch (error) {
        console.error('\n❌ Error running tests:', error.message);
        console.log('Make sure the backend server is running on port 8080\n');
    }
}

main();

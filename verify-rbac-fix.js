/**
 * Quick test to verify RBAC fixes are working
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:8083';

// Use a real token from the test setup
const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjMwNiwidXNlcm5hbWUiOiJyYmFjX3N1cHBsaWVyMV9tMTR4NzZocGciLCJyb2xlIjoiU1VQUExJUiIsInN1cHBsaWVySWQiOjQ1NywiYnV5ZXJJZCI6bnVsbCwiaWF0IjoxNzQwNTk4MzAyLCJleHAiOjE3NDA2ODQ3MDJ9.test';

async function testSupplierAccess() {
    console.log('Testing Supplier Access Control...\n');

    // Test 1: Try to access a different supplier
    console.log('Test 1: Supplier 457 accessing Supplier 458...');
    try {
        const response = await axios.get(`${BASE_URL}/api/suppliers/458`, {
            headers: { 'Authorization': `Bearer ${testToken}` }
        });
        console.log(`❌ FAIL: Request succeeded with status ${response.status}`);
        console.log(`   Data:`, JSON.stringify(response.data).substring(0, 200));
    } catch (error) {
        console.log(`Request failed. Error:`, error.message);
        if (error.response) {
            console.log(`   Status: ${error.response.status}`);
            console.log(`   Data:`, error.response.data);
        } else {
            console.log(`   No response object - might be network error`);
        }
    }

    console.log('\n');

    // Test 2: Try to access own documents (should work if supplier 457 exists)
    console.log('Test 2: Supplier 457 accessing their own documents...');
    try {
        const response = await axios.get(`${BASE_URL}/api/suppliers/457/documents`, {
            headers: { 'Authorization': `Bearer ${testToken}` }
        });
        console.log(`✓ Status: ${response.status}`);
        console.log(`   Document count: ${Array.isArray(response.data) ? response.data.length : 'N/A'}`);
    } catch (error) {
        console.log(`❌ Request failed:`, error.message);
        if (error.response) {
            console.log(`   Status: ${error.response.status}`);
        }
    }

    console.log('\n');

    // Test 3: Try to access different supplier's documents
    console.log('Test 3: Supplier 457 accessing Supplier 458 documents...');
    try {
        const response = await axios.get(`${BASE_URL}/api/suppliers/458/documents`, {
            headers: { 'Authorization': `Bearer ${testToken}` }
        });
        console.log(`❌ FAIL: Request succeeded with status ${response.status}`);
    } catch (error) {
        console.log(`Request failed:`, error.message);
        if (error.response) {
            console.log(`   Status: ${error.response.status}`);
            console.log(`   This is expected if RBAC is working!`);
        }
    }
}

testSupplierAccess().catch(console.error);

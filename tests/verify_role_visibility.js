require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const BASE_URL = 'http://localhost:8083/api';
const SECRET_KEY = "sdn-tech-super-secret-key";

const generateToken = (user) => jwt.sign(user, SECRET_KEY, { expiresIn: '1h' });

function log(step, msg, data) {
    console.log(`[${step}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

async function runTest() {
    log("START", "🚀 Starting Verification Test (Safe Mode)...");
    const timestamp = Date.now();
    const legalName = `Safe_Supplier_${timestamp}`;
    let supplierId;

    try {
        // 1. Setup
        const adminToken = generateToken({ userId: 999, role: 'ADMIN', subRole: 'Admin', buyerId: 1 });
        const createRes = await axios.post(`${BASE_URL}/suppliers`, {
            legalName, businessType: 'Corporation', country: 'TestLand', isGstRegistered: false
        }, { headers: { 'Authorization': `Bearer ${adminToken}` } });
        supplierId = createRes.data.supplierId;
        log("SETUP", `Created Supplier ${supplierId}`);

        await axios.post(`${BASE_URL}/suppliers/${supplierId}/reviews/submit`, {}, { headers: { 'Authorization': `Bearer ${adminToken}` } });

        for (const s of ['PROFILE', 'DOCUMENTS', 'FINANCE']) {
            await axios.post(`${BASE_URL}/suppliers/${supplierId}/reviews/decide`,
                { decision: 'APPROVE', section: s, comments: 'ok' },
                { headers: { 'Authorization': `Bearer ${adminToken}` } }
            );
        }
        log("SETUP", "Supplier Approved.");

        // 2. Trigger Change Request
        const supplierToken = generateToken({ userId: 888, role: 'SUPPLIER', supplierId: supplierId });
        // Trigger changes for Finance (bank), Compliance (legalName), Procurement (website)
        await axios.put(`${BASE_URL}/suppliers/${supplierId}`, {
            legalName: `Updated_Legal_${timestamp}`,
            bankName: `Updated_Bank_${timestamp}`,
            website: `www.updated-${timestamp}.com`
        }, { headers: { 'Authorization': `Bearer ${supplierToken}` } });
        log("ACTION", "Change Request Triggered.");

        // 3. Verify Visibility & Actionability
        const allExpectedItems = ['bankName', 'legalName', 'website'].sort();

        const checkRole = async (roleName, subRole, actionableFields) => {
            log("VERIFY", `Checking ${roleName}...`);
            const token = generateToken({ userId: 100 + Math.floor(Math.random() * 100), role: 'BUYER', subRole: subRole, buyerId: 1 });

            // LIST VIEW
            const res = await axios.get(`${BASE_URL}/change-requests/pending`, { headers: { 'Authorization': `Bearer ${token}` } });
            const req = res.data.find(r => r.supplierId === supplierId);
            if (!req) throw new Error(`${roleName} cannot see the request!`);

            const visible = req.items.map(i => i.fieldName).sort();
            const actionable = req.items.filter(i => i.isActionable).map(i => i.fieldName).sort();

            // Assert Visibility (ALL)
            const missingVis = allExpectedItems.filter(f => !visible.includes(f));
            if (missingVis.length > 0) throw new Error(`${roleName} missing visibility for: ${missingVis.join(', ')}`);

            // Assert Actionability (Specific)
            const missingAct = actionableFields.filter(f => !actionable.includes(f));
            const extraAct = actionable.filter(f => !actionableFields.includes(f));
            if (missingAct.length > 0 || extraAct.length > 0) throw new Error(`${roleName} has wrong actions. Expected: [${actionableFields}], Got: [${actionable}]`);

            log("SUCCESS", `${roleName} List View OK.`);

            // DETAILS VIEW
            const detailRes = await axios.get(`${BASE_URL}/change-requests/${req.requestId}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const detVisible = detailRes.data.items.map(i => i.fieldName).sort();
            const detActionable = detailRes.data.items.filter(i => i.isActionable).map(i => i.fieldName).sort();

            const missDetVis = allExpectedItems.filter(f => !detVisible.includes(f));
            if (missDetVis.length > 0) throw new Error(`${roleName} details missing visibility for: ${missDetVis}`);

            const missDetAct = actionableFields.filter(f => !detActionable.includes(f));
            const extraDetAct = detActionable.filter(f => !actionableFields.includes(f));
            if (missDetAct.length > 0 || extraDetAct.length > 0) throw new Error(`${roleName} details actions wrong. Expected: [${actionableFields}], Got: [${detActionable}]`);

            log("SUCCESS", `${roleName} Details View OK.`);
        };

        await checkRole('FINANCE', 'Finance Manager', ['bankName']);
        await checkRole('COMPLIANCE', 'Compliance Officer', ['legalName']);
        await checkRole('PROCUREMENT', 'Procurement', ['website']);

        log("DONE", "All Role Verifications Passed!");

    } catch (e) {
        log("ERROR", e.message);
        if (e.response) log("ERROR_DATA", e.response.data);
    } finally {
        if (supplierId && db.run) {
            await new Promise(r => db.run("DELETE FROM supplier_change_items WHERE requestId IN (SELECT requestId FROM supplier_change_requests WHERE supplierId = ?)", [supplierId], r));
            await new Promise(r => db.run("DELETE FROM supplier_change_requests WHERE supplierId = ?", [supplierId], r));
            await new Promise(r => db.run("DELETE FROM suppliers WHERE supplierId = ?", [supplierId], r));
            log("CLEANUP", "Done.");
        }
        // Force header flush?
        setTimeout(() => process.exit(0), 1000);
    }
}

runTest();

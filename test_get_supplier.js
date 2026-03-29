const db = require('./config/database');
const SupplierService = require('./services/SupplierService');

async function testGetSupplier() {
    try {
        console.log("Testing SupplierService.getSupplierById(5843)...");
        // Mock user as admin to bypass security
        const user = { userId: 1, role: 'ADMIN' };
        const result = await SupplierService.getSupplierById(5843, user);

        console.log("API Result Keys:", Object.keys(result));
        console.log("Result Sanitized:", JSON.stringify({
            legalname: result.legalname,
            legalName: result.legalName,
            businesstype: result.businesstype,
            businessType: result.businessType,
            country: result.country
        }, null, 2));

        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

testGetSupplier();

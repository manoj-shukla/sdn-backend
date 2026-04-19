const SupplierService = require('./services/SupplierService');

async function testFetch() {
    console.log('--- Testing Supplier Detail Fetch (ID: 65) ---');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const mockAdmin = {
        userId: 1,
        username: 'admin',
        role: 'ADMIN',
        buyerId: null,
        supplierId: null
    };

    try {
        const result = await SupplierService.getSupplierById(65, mockAdmin);
        console.log('Fetch Result Keys:', Object.keys(result));
        console.log('Legal Name:', result.legalName);
        console.log('Documents Count:', result.documents ? result.documents.length : 0);
        console.log('Contacts Count:', result.contacts ? result.contacts.length : 0);
        console.log('Addresses Count:', result.addresses ? result.addresses.length : 0);
        
        if (result.documents && result.documents.length > 0) {
            console.log('First Document:', result.documents[0]);
        }
    } catch (e) {
        console.error('Fetch Failed:', e);
    }

    process.exit(0);
}

testFetch();

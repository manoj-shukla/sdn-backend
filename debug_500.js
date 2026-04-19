const SupplierService = require('./services/SupplierService');

async function debug500() {
    console.log('--- Debugging 500 Error for Supplier 6265 ---');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Mock User (Admin)
    const mockUser = {
        userId: 1,
        role: 'ADMIN',
        buyerId: 1
    };

    try {
        const result = await SupplierService.getSupplierById(6265, mockUser);
        console.log('Result:', result ? 'Success' : 'NotFound');
    } catch (err) {
        console.error('CRASH DETECTED:', err.message);
        console.error(err.stack);
    }
    process.exit(0);
}

debug500();

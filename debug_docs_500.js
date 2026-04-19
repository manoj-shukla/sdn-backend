const DocumentService = require('./services/DocumentService');

async function debugDocuments500() {
    console.log('--- Debugging 500 Error for Supplier Documents 6265 ---');
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        const result = await DocumentService.getSupplierDocuments(6265);
        console.log('Result Success. Count:', result.length);
    } catch (err) {
        console.error('CRASH DETECTED:', err.message);
        console.error(err.stack);
    }
    process.exit(0);
}

debugDocuments500();

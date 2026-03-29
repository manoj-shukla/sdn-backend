const SupplierService = require('./services/SupplierService');

async function testSupplier() {
    try {
        const sup = await SupplierService.getSupplierById(5877);
        console.log("Supplier 5877:", sup);
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}
testSupplier();

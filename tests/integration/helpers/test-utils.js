/**
 * Test Utilities
 * Helper functions for integration tests
 */

// Generate unique username for testing
function generateUsername(base = 'testuser') {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `${base}_${timestamp}_${random}`;
}

// Generate unique email for testing
function generateEmail(base = 'test') {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `${base}_${timestamp}_${random}@example.com`;
}

// Generate unique supplier name
function generateSupplierName(base = 'Test Supplier') {
    const timestamp = Date.now();
    return `${base} ${timestamp}`;
}

// Generate unique buyer name
function generateBuyerName(base = 'Test Buyer') {
    const timestamp = Date.now();
    return `${base} ${timestamp}`;
}

// Create a cleanup helper that uses unique IDs
function createCleanupHelper(db) {
    const cleanupIds = {
        users: [],
        suppliers: [],
        buyers: [],
        buyers: []
    };

    return {
        addUser: (id) => cleanupIds.sdn_users.push(id),
        addSupplier: (id) => cleanupIds.suppliers.push(id),
        addBuyer: (id) => cleanupIds.buyers.push(id),
        addCircle: (id) => cleanupIds.circles.push(id),

        async cleanup() {
            const queries = [];

            if (cleanupIds.sdn_users.length > 0) {
                queries.push(
                    db.run(`DELETE FROM user_supplier_memberships WHERE userId IN (${cleanupIds.sdn_users.join(',')})`)
                );
                queries.push(
                    db.run(`DELETE FROM sdn_users WHERE userId IN (${cleanupIds.sdn_users.join(',')})`)
                );
            }

            if (cleanupIds.suppliers.length > 0) {
                queries.push(
                    db.run(`DELETE FROM suppliers WHERE supplierId IN (${cleanupIds.suppliers.join(',')})`)
                );
            }

            if (cleanupIds.buyers.length > 0) {
                queries.push(
                    db.run(`DELETE FROM buyers WHERE buyerId IN (${cleanupIds.buyers.join(',')})`)
                );
            }

            if (cleanupIds.circles.length > 0) {
                queries.push(
                    db.run(`DELETE FROM circle_members WHERE circleId IN (${cleanupIds.circles.join(',')})`)
                );
                queries.push(
                    db.run(`DELETE FROM circles WHERE circleId IN (${cleanupIds.circles.join(',')})`)
                );
            }

            await Promise.all(queries);

            // Reset for next test
            cleanupIds.users = [];
            cleanupIds.suppliers = [];
            cleanupIds.buyers = [];
            cleanupIds.circles = [];
        }
    };
}

module.exports = {
    generateUsername,
    generateEmail,
    generateSupplierName,
    generateBuyerName,
    createCleanupHelper
};

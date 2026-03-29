const db = require('../config/database');

console.log("🔍 Diagnostic: Checking Suppliers & Change Requests...");

// 1. List Suppliers
db.all("SELECT supplierId, legalName, approvalStatus, buyerId, profileStatus FROM suppliers", [], (err, suppliers) => {
    if (err) return console.error("❌ Failed to list suppliers:", err);
    console.log("\n--- SUPPLIERS ---");
    console.log(JSON.stringify(suppliers, null, 2));

    // 2. List Change Requests
    db.all("SELECT requestId, supplierId, status, buyerId FROM supplier_change_requests", [], (err, requests) => {
        if (err) return console.error("❌ Failed to list requests:", err);
        console.log("\n--- CHANGE REQUESTS ---");
        console.log(JSON.stringify(requests, null, 2));

        // 3. List Change Items
        db.all("SELECT itemId, requestId, fieldName, status FROM supplier_change_items", [], (err, items) => {
            if (err) return console.error("❌ Failed to list items:", err);
            console.log("\n--- CHANGE ITEMS ---");
            console.log(JSON.stringify(items, null, 2));
        });
    });
});

setTimeout(() => { }, 5000);

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../config/database');

const fs = require('fs');
const path = require('path');
const OUTPUT_FILE = path.resolve(__dirname, 'diag_output.log');

function log(msg) {
    console.log(msg);
    fs.appendFileSync(OUTPUT_FILE, msg + '\n');
}

// Clear previous log
fs.writeFileSync(OUTPUT_FILE, '');
log("🔍 Diagnostic Started...");

async function run() {
    try {
        const suppliers = await new Promise((resolve, reject) => {
            db.all("SELECT supplierId, legalName, approvalStatus, buyerId FROM suppliers", [], (err, rows) => err ? reject(err) : resolve(rows));
        });
        log("\n--- SUPPLIERS ---");
        log(JSON.stringify(suppliers, null, 2));

        const requestData = await new Promise((resolve, reject) => {
            db.all(`
                SELECT r.requestId, r.supplierId, r.status, r.buyerId, count(i.itemId) as itemCount
                FROM supplier_change_requests r
                LEFT JOIN supplier_change_items i ON r.requestId = i.requestId
                GROUP BY r.requestId
            `, [], (err, rows) => err ? reject(err) : resolve(rows));
        });
        log("\n--- CHANGE REQUESTS ---");
        log(JSON.stringify(requestData, null, 2));

    } catch (e) {
        log("ERROR: " + e.stack);
    }
}

// PG Wrapper init might be async
setTimeout(() => {
    run().then(() => {
        console.log("Done.");
        process.exit(0);
    });
}, 1000);

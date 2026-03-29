require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const db = require('../config/database');
const fs = require('fs');
const OUT = require('path').resolve(__dirname, 'danish_check.log');

fs.writeFileSync(OUT, '');
function log(msg) { fs.appendFileSync(OUT, msg + '\n'); }

setTimeout(async () => {
    try {
        // Find Danish supplier
        const suppliers = await new Promise((res, rej) => {
            db.all("SELECT supplierId, legalName, approvalStatus, buyerId FROM suppliers WHERE legalName LIKE '%anish%'", [], (e, r) => e ? rej(e) : res(r));
        });
        log("=== SUPPLIERS matching 'danish' ===");
        log(JSON.stringify(suppliers, null, 2));

        if (suppliers.length === 0) {
            // Try all suppliers
            const all = await new Promise((res, rej) => {
                db.all("SELECT supplierId, legalName, approvalStatus FROM suppliers ORDER BY supplierId DESC LIMIT 10", [], (e, r) => e ? rej(e) : res(r));
            });
            log("\n=== RECENT SUPPLIERS (no 'danish' match) ===");
            log(JSON.stringify(all, null, 2));
        }

        for (const s of suppliers) {
            const sid = s.supplierid || s.supplierId;

            // Change Requests
            const crs = await new Promise((res, rej) => {
                db.all(`SELECT r.requestId, r.status, r.buyerId, i.fieldName, i.oldValue, i.newValue, i.status as itemStatus
                    FROM supplier_change_requests r
                    LEFT JOIN supplier_change_items i ON r.requestId = i.requestId
                    WHERE r.supplierId = ?`, [sid], (e, r) => e ? rej(e) : res(r));
            });
            log(`\n=== CHANGE REQUESTS for supplier ${sid} (${s.legalname || s.legalName}) ===`);
            log(JSON.stringify(crs, null, 2));

            // Documents
            const docs = await new Promise((res, rej) => {
                db.all("SELECT documentId, documentType, documentName, verificationStatus, isActive FROM documents WHERE supplierId = ?", [sid], (e, r) => e ? rej(e) : res(r));
            });
            log(`\n=== DOCUMENTS for supplier ${sid} ===`);
            log(JSON.stringify(docs, null, 2));
        }

        log("\nDone.");
    } catch (e) {
        log("ERROR: " + e.stack);
    }
    process.exit(0);
}, 1500);

const db = require('./config/database');

console.log("--- Supplier Change Requests ---");
db.all("SELECT * FROM supplier_change_requests", (err, rows) => {
    if (err) console.error(err);
    else console.table(rows);

    console.log("\n--- Supplier Change Items ---");
    db.all("SELECT itemId, requestId, fieldName, status, changeCategory FROM supplier_change_items", (err, rows) => {
        if (err) console.error(err);
        else console.table(rows);
    });
});

const db = require('./config/database');

db.all("SELECT supplierId, legalName, businessType, country FROM suppliers ORDER BY supplierId DESC LIMIT 10", [], (err, rows) => {
    if (err) {
        console.error("DB Error:", err);
    } else {
        console.table(rows);
    }
    process.exit(0);
});

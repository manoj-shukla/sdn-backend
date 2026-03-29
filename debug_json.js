const db = require('./config/database');

db.all("SELECT itemId, newValue FROM supplier_change_items WHERE itemId IN (45, 46, 47)", (err, rows) => {
    if (err) console.error(err);
    else {
        rows.forEach(row => {
            console.log(`--- Item ${row.itemId} ---`);
            console.log(row.newValue);
            try {
                JSON.parse(row.newValue);
                console.log("JSON Valid: YES");
            } catch (e) {
                console.log("JSON Valid: NO", e.message);
            }
        });
    }
});

const db = require('./config/database');

async function checkEmptyFields() {
    try {
        const query = `
            SELECT supplierid, legalname, businesstype, country
            FROM suppliers 
            WHERE legalname IS NULL OR legalname = '' 
               OR businesstype IS NULL OR businesstype = ''
               OR country IS NULL OR country = ''
            LIMIT 10
        `;
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Error:", err);
                process.exit(1);
            }
            console.log("Suppliers with empty fields:");
            console.log(JSON.stringify(rows, null, 2));
            process.exit(0);
        });
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

checkEmptyFields();

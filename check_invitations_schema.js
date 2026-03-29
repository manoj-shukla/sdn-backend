const db = require('./config/database');

async function checkInvitationsSchema() {
    try {
        const query = `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'invitations'
        `;
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Error:", err);
                process.exit(1);
            }
            console.log("Invitations Table Columns:");
            console.log(JSON.stringify(rows, null, 2));
            process.exit(0);
        });
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

checkInvitationsSchema();

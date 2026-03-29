const db = require('./config/database');

async function checkRecentInvitations() {
    try {
        const query = `
            SELECT invitationid, email, legalname, country, suppliertype, status
            FROM invitations 
            ORDER BY createdat DESC 
            LIMIT 5
        `;
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Error:", err);
                process.exit(1);
            }
            console.log("Recent Invitations:");
            console.log(JSON.stringify(rows, null, 2));
            process.exit(0);
        });
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

checkRecentInvitations();

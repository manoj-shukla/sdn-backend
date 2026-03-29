const db = require('./config/database');
const InvitationService = require('./services/InvitationService');

setTimeout(() => {
    db.all("SELECT invitationid, email, status, invitationtoken, expiresat FROM invitations WHERE status = 'PENDING' ORDER BY createdat DESC LIMIT 5", [], (err, rows) => {
        if (err) console.error(err);
        else console.log("DB Rows:", rows);

        if (rows && rows.length > 0) {
            console.log("\nTesting Service verifyToken for last token:", rows[0].invitationtoken);
            InvitationService.verifyToken(rows[0].invitationtoken)
                .then(res => console.log("verifyToken Success:", res))
                .catch(e => console.error("verifyToken Error:", e.message))
                .finally(() => process.exit(0));
        } else {
            console.log("No rows found.");
            process.exit(0);
        }
    });
}, 1500);

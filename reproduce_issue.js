const db = require('./config/database');
const InvitationService = require('./services/InvitationService');
const AuthService = require('./services/AuthService');

async function reproduce() {
    try {
        const testEmail = `test_${Date.now()}@example.com`;
        const testPassword = "Password123!";
        console.log(`Step 1: Creating invitation for ${testEmail}...`);

        let invite;
        try {
            invite = await InvitationService.createInvitation({
                email: testEmail,
                legalName: "Test Company Ltd",
                country: "India",
                supplierType: "Enterprise",
                buyerId: 1
            }, { role: 'ADMIN', userId: 0, username: 'admin' });
        } catch (e) {
            console.error("Create Invitation Failed:", e);
            process.exit(1);
        }

        console.log(`Invite created: ${invite.token}`);

        console.log("Step 2: Accepting invitation...");
        let loginResult;
        try {
            loginResult = await InvitationService.processAcceptance(invite.token, {
                companyName: "Accepted Company Ltd",
                password: testPassword,
                businessType: "SME",
                country: "Maldives"
            });
        } catch (e) {
            console.error("Process Acceptance Failed:", e);
            process.exit(1);
        }

        const supplierId = loginResult.user.supplierId;
        console.log(`Accepted successfully. SupplierID: ${supplierId}`);

        console.log("Step 3: Verifying supplier record...");
        db.get("SELECT * FROM suppliers WHERE supplierid = ?", [supplierId], (err, row) => {
            if (err) {
                console.error("Fetch Supplier Failed:", err);
                process.exit(1);
            }
            console.log("Supplier Record in DB:");
            console.log(JSON.stringify({
                legalname: row.legalname,
                businesstype: row.businesstype,
                country: row.country,
                approvalstatus: row.approvalstatus
            }, null, 2));
            process.exit(0);
        });

    } catch (e) {
        console.error("Reproduction Error:", e);
        process.exit(1);
    }
}

reproduce();

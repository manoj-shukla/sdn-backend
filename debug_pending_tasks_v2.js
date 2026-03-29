const db = require('./config/database');
const WorkflowService = require('./services/WorkflowService');

async function debug() {
    // We'll look for the most recent buyer or supplier
    db.get("SELECT buyerid FROM buyers ORDER BY createdat DESC LIMIT 1", [], async (err, buyer) => {
        if (err || !buyer) {
            console.error("Buyer not found", err);
            process.exit(1);
        }
        const buyerId = buyer.buyerid;
        console.log("Checking for Buyer ID:", buyerId);

        db.get("SELECT userid, role, subrole FROM users WHERE buyerid = ? AND role = 'BUYER' LIMIT 1", [buyerId], async (err, user) => {
            if (err || !user) {
                console.log("No user found for this buyer, checking all pending tasks for this buyer...");
            } else {
                console.log("Found User:", user);
                // We'll manually set the subRole to 'Single Level Approver' for testing if it's not set
                const testUser = {
                    userId: user.userid,
                    role: user.role,
                    subRole: 'Single Level Approver',
                    buyerId: buyerId
                };
                try {
                    const tasks = await WorkflowService.getPendingTasks(testUser);
                    console.log(`Pending Tasks for Single Level Approver (Buyer ${buyerId}):`, tasks.length);
                    console.log("Tasks:", JSON.stringify(tasks, null, 2));
                } catch (e) {
                    console.error(e);
                }
            }

            // Raw debug of step_instances for this buyer
            db.all(`
                SELECT si.*, br.rolename, w.buyerid as w_buyerid, wi.status as wi_status
                FROM step_instances si
                LEFT JOIN buyer_roles br ON si.assignedroleid = br.roleid
                JOIN workflow_instances wi ON si.instanceid = wi.instanceid
                JOIN workflows w ON wi.workflowtemplateid = w.workflowid
                WHERE w.buyerid = ?
            `, [buyerId], (err, rows) => {
                console.log(`All Step Instances for Buyer ${buyerId}:`, JSON.stringify(rows, null, 2));
                process.exit(0);
            });
        });
    });
}

debug();

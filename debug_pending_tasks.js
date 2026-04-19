const db = require('./config/database');
const WorkflowService = require('./services/WorkflowService');

async function debug() {
    const userId = 1; // Assuming Test User ID is 1
    const userRole = 'BUYER';

    db.get("SELECT role, subrole, buyerid FROM sdn_users WHERE userid = ?", [userId], async (err, user) => {
        if (err) {
            console.error("User not found", err);
            process.exit(1);
        }
        console.log("Current User in DB:", user);

        try {
            const tasks = await WorkflowService.getPendingTasks({ userId, role: user.role, subRole: user.subrole, buyerId: user.buyerid });
            console.log("Pending Tasks Count:", tasks.length);
            console.log("Tasks:", JSON.stringify(tasks, null, 2));

            // Debug the raw step_instances
            db.all(`
                SELECT si.*, br.rolename, w.buyerid as w_buyerid
                FROM step_instances si
                LEFT JOIN buyer_roles br ON si.assignedroleid = br.roleid
                JOIN workflow_instances wi ON si.instanceid = wi.instanceid
                JOIN workflows w ON wi.workflowtemplateid = w.workflowid
                WHERE si.status = 'PENDING'
            `, [], (err, rows) => {
                console.log("Raw Pending Step Instances:", JSON.stringify(rows, null, 2));
                process.exit(0);
            });
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    });
}

debug();

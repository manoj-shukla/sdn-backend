const WorkflowService = require('./services/WorkflowService');
const db = require('./config/database');

async function testTasks() {
    console.log('--- Testing Pending Tasks Fetch ---');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Simulate a Buyer Admin user (User ID 1 is usually the admin)
    const mockUser = {
        userId: 1,
        role: 'BUYER',
        subRole: 'Admin',
        buyerId: 1
    };

    try {
        const tasks = await WorkflowService.getPendingTasks(mockUser);
        console.log(`Success! Found ${tasks.length} pending tasks.`);
        if (tasks.length > 0) {
            console.log('Sample Task Structure:', JSON.stringify(tasks[0], null, 2));
        }
    } catch (err) {
        console.error('Fetch Failed:', err.message);
    }
    process.exit(0);
}

testTasks();

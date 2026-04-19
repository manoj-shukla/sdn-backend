const db = require('./config/database');

async function auditAll() {
    console.log('--- ALL TABLES AND COLUMNS ---');
    await new Promise(resolve => setTimeout(resolve, 2000));

    db.all("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name", [], (err, rows) => {
        const tables = {};
        rows.forEach(r => {
            if (!tables[r.table_name]) tables[r.table_name] = [];
            tables[r.table_name].push(r.column_name);
        });
        console.log(JSON.stringify(tables, null, 2));
        process.exit(0);
    });
}

auditAll();

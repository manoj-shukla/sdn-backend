const db = require('./config/database');

async function diagnose() {
    console.log('--- DB Diagnosis ---');
    
    // Give the database wrapper a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check table names
    db.all("SELECT table_name FROM information_schema.tables WHERE table_schema='public'", [], (err, tables) => {
        if (err) console.error('Error checking tables:', err);
        else {
            console.log('Tables:', tables.map(t => t.table_name).join(', '));
        }

        // Check columns of documents table
        db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'documents'", [], (err, columns) => {
            if (err) console.error('Error checking documents columns:', err);
            else {
                console.log('Documents Columns:', columns.map(c => c.column_name));
            }

            // Identify E2E users
            db.all("SELECT buyerId, buyerName FROM buyers WHERE buyerName ILIKE '%e2e%' OR buyerCode ILIKE '%e2e%'", [], (err, e2eBuyers) => {
                console.log('E2E Buyers count:', e2eBuyers?.length || 0);
                
                db.all("SELECT supplierId, legalName FROM suppliers WHERE legalName ILIKE '%e2e%'", [], (err, e2eSuppliers) => {
                    console.log('E2E Suppliers count:', e2eSuppliers?.length || 0);
                    
                    process.exit(0);
                });
            });
        });
    });
}

diagnose();

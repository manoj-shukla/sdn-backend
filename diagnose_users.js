const db = require('./config/database');

async function diagnose() {
    console.log('--- DB Diagnosis ---');
    
    // Give the database wrapper a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    db.all('SELECT role, count(*) FROM users GROUP BY role', [], (err, rows) => {
        if (err) console.error('Error fetching user counts:', err);
        else {
            console.log('User counts by role:', rows);
        }
        
        db.all('SELECT count(*) FROM buyers', [], (err, rows) => {
            if (err) console.error('Error fetching buyer count:', err);
            else console.log('Total buyers:', rows[0].count);
            
            db.all('SELECT count(*) FROM suppliers', [], (err, rows) => {
                if (err) console.error('Error fetching supplier count:', err);
                else console.log('Total suppliers:', rows[0].count);
                
                // Detailed check
                db.all('SELECT buyerId, buyerName, email FROM buyers', [], (err, buyers) => {
                    db.all('SELECT supplierId, legalName, approvalStatus FROM suppliers', [], (err, suppliers) => {
                        db.all('SELECT username, email, role, buyerId, supplierId FROM users', [], (err, users) => {
                            
                            const missingBuyers = (buyers || []).filter(b => !(users || []).some(u => u.buyerid === b.buyerid));
                            const missingSuppliers = (suppliers || []).filter(s => !(users || []).some(u => u.supplierid === s.supplierid));
                            
                            console.log(`\nFound ${missingBuyers.length} buyers missing from users table.`);
                            console.log(`Found ${missingSuppliers.length} suppliers missing from users table.`);
                            
                            if (missingBuyers.length > 0) {
                                console.log('Missing Buyers:', missingBuyers.map(b => `${b.buyername} (ID: ${b.buyerid})`).join(', '));
                            }
                            if (missingSuppliers.length > 0) {
                                console.log('Missing Suppliers:', missingSuppliers.map(s => `${s.legalname} (ID: ${s.supplierid})`).join(', '));
                            }
                            
                            process.exit(0);
                        });
                    });
                });
            });
        });
    });
}

diagnose();

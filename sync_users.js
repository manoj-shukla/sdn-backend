const db = require('./config/database');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;
const DEFAULT_BUYER_PASSWORD = 'Buyer@123!';
const DEFAULT_SUPPLIER_PASSWORD = 'Supplier@123!';

async function sync() {
    console.log('--- Starting User Synchronization ---');

    // Give the database wrapper a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    const buyerHash = await bcrypt.hash(DEFAULT_BUYER_PASSWORD, SALT_ROUNDS);
    const supplierHash = await bcrypt.hash(DEFAULT_SUPPLIER_PASSWORD, SALT_ROUNDS);

    // 1. Sync Buyers
    console.log('\nSynchronizing Buyers...');
    await new Promise((resolve) => {
        db.all('SELECT buyerId, buyerName, buyerCode, email, isActive FROM buyers', [], async (err, buyers) => {
            if (err) {
                console.error('Error fetching buyers:', err);
                return resolve();
            }

            for (const buyer of buyers) {
                const username = (buyer.buyercode || buyer.buyername || `buyer_${buyer.buyerid}`)
                    .toLowerCase()
                    .replace(/\s+/g, '_')
                    .replace(/[^a-z0-9_@.-]/g, '');

                await new Promise((res) => {
                    db.get('SELECT userId FROM sdn_users WHERE buyerId = $1 OR username = $2', [buyer.buyerid, username], (err, user) => {
                        if (!user) {
                            db.run(
                                'INSERT INTO sdn_users (username, password, email, role, subRole, buyerId, isActive, mustChangePassword) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                                [username, buyerHash, buyer.email, 'BUYER', 'Admin', buyer.buyerid, buyer.isactive ?? true, true],
                                (err) => {
                                    if (err) console.error(`  ❌ Failed to create user for buyer ${buyer.buyername}:`, err.message);
                                    else console.log(`  ✅ Created user for buyer: ${buyer.buyername} (${username})`);
                                    res();
                                }
                            );
                        } else {
                            console.log(`  ℹ️ User already exists for buyer: ${buyer.buyername}`);
                            res();
                        }
                    });
                });
            }
            resolve();
        });
    });

    // 2. Sync Suppliers
    console.log('\nSynchronizing Suppliers...');
    await new Promise((resolve) => {
        db.all('SELECT supplierId, legalName, isActive, buyerId FROM suppliers', [], async (err, suppliers) => {
            if (err) {
                console.error('Error fetching suppliers:', err);
                return resolve();
            }

            for (const supplier of suppliers) {
                // Try to find email from invitations
                const email = await new Promise((res) => {
                    db.get('SELECT email FROM invitations WHERE supplierId = $1 AND status = \'ACCEPTED\' ORDER BY acceptedAt DESC LIMIT 1', [supplier.supplierid], (err, inv) => {
                        res(inv?.email || `supplier_${supplier.supplierid}@placeholder.local`);
                    });
                });

                const username = email;

                await new Promise((res) => {
                    db.get('SELECT userId FROM sdn_users WHERE supplierId = $1 OR username = $2', [supplier.supplierid, username], (err, user) => {
                        if (!user) {
                            db.run(
                                'INSERT INTO sdn_users (username, password, email, role, supplierId, buyerId, isActive, mustChangePassword) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                                [username, supplierHash, email, 'SUPPLIER', supplier.supplierid, supplier.buyerid || null, supplier.isactive ?? true, true],
                                (err) => {
                                    if (err) console.error(`  ❌ Failed to create user for supplier ${supplier.legalname}:`, err.message);
                                    else console.log(`  ✅ Created user for supplier: ${supplier.legalname} (${username})`);
                                    res();
                                }
                            );
                        } else {
                            console.log(`  ℹ️ User already exists for supplier: ${supplier.legalname}`);
                            res();
                        }
                    });
                });
            }
            resolve();
        });
    });

    console.log('\n--- Synchronization Complete ---');
    process.exit(0);
}

sync();

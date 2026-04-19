const db = require('../config/database');

async function cleanupE2E() {
    console.log('--- Cleaning Up E2E Data ---');
    
    // Give the database wrapper a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
        // 1. Get IDs of E2E Buyers and Suppliers
        const e2eBuyers = await new Promise((resolve, reject) => {
            db.all("SELECT buyerId FROM buyers WHERE buyerName ILIKE '%e2e%' OR buyerCode ILIKE '%e2e%'", [], (err, rows) => {
                if (err) reject(err); else resolve(rows.map(r => r.buyerid || r.buyerId));
            });
        });

        const e2eSuppliers = await new Promise((resolve, reject) => {
            db.all("SELECT supplierId FROM suppliers WHERE legalName ILIKE '%e2e%'", [], (err, rows) => {
                if (err) reject(err); else resolve(rows.map(r => r.supplierid || r.supplierId));
            });
        });

        console.log(`Found ${e2eBuyers.length} E2E Buyers and ${e2eSuppliers.length} E2E Suppliers.`);

        if (e2eBuyers.length === 0 && e2eSuppliers.length === 0) {
            console.log('Nothing to clean up.');
            process.exit(0);
        }

        const buyerIds = e2eBuyers.join(',');
        const supplierIds = e2eSuppliers.join(',');

        // 2. Cascade delete records. order is important for FKs.
        const deleteSequentially = async (statements) => {
            for (const sql of statements) {
                await new Promise((resolve) => {
                    db.run(sql, [], (err) => {
                        if (err) console.error(`Failed: ${sql.substring(0, 50)}... -> ${err.message}`);
                        else console.log(`Executed: ${sql.substring(0, 50)}...`);
                        resolve();
                    });
                });
            }
        };

        const cleanupStatements = [];

        if (supplierIds) {
            cleanupStatements.push(
                `DELETE FROM invoices WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM orders WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM documents WHERE supplierid IN (${supplierIds})`, // Note lowercase 'supplierid' as just renamed
                `DELETE FROM reviews WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM messages WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM contacts WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM addresses WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM circle_members WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM step_instances WHERE instanceId IN (SELECT instanceId FROM workflow_instances WHERE supplierId IN (${supplierIds}))`,
                `DELETE FROM workflow_instances WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM supplier_change_items WHERE requestId IN (SELECT requestId FROM supplier_change_requests WHERE supplierId IN (${supplierIds}))`,
                `DELETE FROM supplier_change_requests WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM supplier_audit_logs WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM invitations WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM users WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM sdn_users WHERE supplierId IN (${supplierIds})`,
                `DELETE FROM suppliers WHERE supplierId IN (${supplierIds})`
            );
        }

        if (buyerIds) {
            cleanupStatements.push(
                `DELETE FROM invoices WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM orders WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM messages WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM reviews WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM workflow_steps WHERE workflowId IN (SELECT workflowId FROM workflows WHERE buyerId IN (${buyerIds}))`,
                `DELETE FROM workflows WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM buyer_roles WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM circles WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM instructions WHERE buyerId IN (${buyerIds})`, // If exists
                `DELETE FROM country_risk_rules WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM invitations WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM users WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM sdn_users WHERE buyerId IN (${buyerIds})`,
                `DELETE FROM buyers WHERE buyerId IN (${buyerIds})`
            );
        }

        await deleteSequentially(cleanupStatements);
        console.log('--- Cleanup Complete ---');

    } catch (error) {
        console.error('Cleanup failed:', error);
    } finally {
        process.exit(0);
    }
}

cleanupE2E();

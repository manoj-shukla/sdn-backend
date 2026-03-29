const db = require('../config/database');

const classifications = [
    { fieldName: 'legalName', category: 'MAJOR' },
    { fieldName: 'businessType', category: 'MAJOR' },
    { fieldName: 'taxId', category: 'MAJOR' },
    { fieldName: 'bankName', category: 'MAJOR' },
    { fieldName: 'accountNumber', category: 'MAJOR' },
    { fieldName: 'routingNumber', category: 'MAJOR' },
    { fieldName: 'gstin', category: 'MAJOR' },
    { fieldName: 'website', category: 'MINOR' },
    { fieldName: 'description', category: 'MINOR' },
    { fieldName: 'addressLine1', category: 'MAJOR' },
    { fieldName: 'city', category: 'MAJOR' },
    { fieldName: 'country', category: 'MAJOR' },
    { fieldName: 'postalCode', category: 'MAJOR' }
];

console.log("Seeding Field Classifications...");

const runSeeder = async () => {
    // 1. Create Table
    await new Promise((resolve) => {
        db.run(`CREATE TABLE IF NOT EXISTS field_change_classification (
            id SERIAL PRIMARY KEY,
            fieldName TEXT UNIQUE NOT NULL,
            category TEXT CHECK(category IN ('MAJOR', 'MINOR')) DEFAULT 'MINOR',
            updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error("Error creating table:", err);
            else console.log("Table verified/created.");
            resolve();
        });
    });

    // 2. Insert Data
    let pending = classifications.length;
    if (pending === 0) {
        process.exit(0);
    }

    classifications.forEach(item => {
        db.run(
            "INSERT INTO field_change_classification (fieldName, category) VALUES ($1, $2) ON CONFLICT (fieldName) DO UPDATE SET category = EXCLUDED.category",
            [item.fieldName, item.category],
            (err) => {
                if (err) console.error(`Failed to seed ${item.fieldName}:`, err.message);
                else console.log(`Seeded ${item.fieldName} as ${item.category}`);

                pending--;
                if (pending === 0) {
                    console.log("Seeding complete.");
                    setTimeout(() => process.exit(0), 1000); // Give time for logs/queue to clear
                }
            }
        );
    });
};

// Wait for DB init if necessary (wrapper usually inits on require, but connection might take a moment)
setTimeout(runSeeder, 1000);

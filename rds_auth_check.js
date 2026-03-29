const { Signer } = require('@aws-sdk/rds-signer');
const { Client } = require('pg');
require('dotenv').config();

async function runDiagnostics() {
    console.log('--- RDS Connection Diagnostics ---');

    // 1. Check Credentials & Environment
    const host = process.env.PGHOST;
    const user = process.env.PGUSER;
    const dbName = process.env.PGDATABASE;
    const region = process.env.AWS_REGION || 'us-east-1';
    const port = parseInt(process.env.PGPORT || '5432');

    console.log(`Target: ${host}:${port}`);
    console.log(`User  : ${user}`);
    console.log(`Region: ${region}`);
    console.log(`DB Name: ${dbName}`);
    console.log(`IAM Auth Enabled: ${process.env.ENABLE_IAM_AUTH}`);

    // 2. Check AWS Caller Identity (Skipped - SDK not installed)

    // 3. Test IAM Token Generation
    let token;
    try {
        const signer = new Signer({
            region: region,
            hostname: host,
            port: port,
            username: user,
        });
        token = await signer.getAuthToken();
        console.log('✅ IAM Token generated successfully (Length: ' + token.length + ')');
    } catch (err) {
        console.error('❌ IAM Token generation failed:', err.message);
    }

    // 4. Test Connection with IAM
    if (token) {
        console.log('\n--- Testing IAM Connection ---');
        const client = new Client({
            host: host,
            port: port,
            user: user,
            database: dbName,
            password: token,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000 // 5 second timeout
        });

        try {
            await client.connect();
            console.log('✅ SUCCESS: Connected to RDS using IAM!');
            await client.end();
        } catch (err) {
            console.error('❌ IAM Connection Failed:', err.message);
            if (err.message.includes('PAM authentication failed')) {
                console.log('\n💡 Tip: This usually means the user "' + user + '" has not been granted the "rds_iam" role in Postgres.');
                console.log('   Run: GRANT rds_iam TO ' + user + ';');
            }
        }
    }

    // 5. Test Connection with Password (if available)
    const password = process.env.PGPASSWORD;
    if (password && password !== 'Token Placeholder' && !password.includes('Token')) {
        console.log('\n--- Testing Password Connection ---');
        const client = new Client({
            host: host,
            port: port,
            user: user,
            database: dbName,
            password: password,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000 // 5 second timeout
        });

        try {
            await client.connect();
            console.log('✅ SUCCESS: Connected to RDS using Password!');
            await client.end();
        } catch (err) {
            console.error('❌ Password Connection Failed:', err.message);
        }
    } else {
        console.log('\nℹ️ No standard password found in .env (PGPASSWORD). Skipping password test.');
    }
}

runDiagnostics().catch(console.error);

console.log("Smoke Test: NodeJS is running.");
try {
    const fs = require('fs');
    const path = require('path');
    const db = require('../config/database');
    console.log("Smoke Test: DB Import Successful");
} catch (e) {
    console.error("Smoke Test Error:", e.message);
}

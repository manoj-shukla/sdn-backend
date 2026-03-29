const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'tests/integration');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));

let totalFixed = 0;

files.forEach(file => {
    const filePath = path.join(testDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    const original = content;

    // Fix SQL placeholders from ? to $1, $2, etc.
    // This replaces patterns like 'VALUES (?, ?, ?)' with 'VALUES ($1, $2, $3)'
    function replacePlaceholders(sql) {
        let count = 0;
        return sql.replace(/\?/g, () => {
            count++;
            return `$${count}`;
        });
    }

    // Find and replace SQL queries in query() and run() calls
    content = content.replace(
        /(query|run)\s*\(\s*['"`]([^'"`]*?)['"`]\s*,\s*\[([^\]]*)\]/g,
        (match, method, sql, params) => {
            // Only replace if there are ? placeholders
            if (sql.includes('?')) {
                const fixedSql = sql.replace(/\?/g, () => {
                    const num = (sql.match(/\?/g) || []).length;
                    // We need to count positionally
                    let count = 0;
                    return sql.replace(/\?/g, () => `$${++count}`);
                });
                // Actually, we need to be smarter - count ? in the original sql
                let placeholders = (sql.match(/\?/g) || []).length;
                let newSql = sql;
                for (let i = 1; i <= placeholders; i++) {
                    newSql = newSql.replace(/\?/, `$${i}`);
                }
                return `${method}('${newSql}', [${params}]`;
            }
            return match;
        }
    );

    // Simpler approach: replace all SQL strings containing ?
    content = content.replace(
        /'([^']*?\?[^']*)'/g,
        (match) => {
            if (!match.includes('?')) return match;
            let count = 0;
            return match.replace(/\?/g, () => `$${++count}`);
        }
    );

    // Same for double quotes
    content = content.replace(
        /"([^"]*\?[^"]*)"/g,
        (match) => {
            if (!match.includes('?')) return match;
            let count = 0;
            return match.replace(/\?/g, () => `$${++count}`);
        }
    );

    // Also fix template literals
    content = content.replace(
        /`([^`]*\?[^`]*)`/g,
        (match) => {
            if (!match.includes('?')) return match;
            let count = 0;
            return match.replace(/\?/g, () => `$${++count}`);
        }
    );

    if (content !== original) {
        fs.writeFileSync(filePath, content);
        console.log(`✅ Fixed: ${file}`);
        totalFixed++;
    } else {
        console.log(`⏭️  No changes: ${file}`);
    }
});

console.log(`\n📊 Total files fixed: ${totalFixed}/${files.length}`);

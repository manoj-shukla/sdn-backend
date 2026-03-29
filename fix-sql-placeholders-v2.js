const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'tests/integration');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));

files.forEach(file => {
    const filePath = path.join(testDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // First, revert the bad replacements (items$1.length -> items.length)
    content = content.replace(/(\w+)\$1\.length/g, '$1.length');
    content = content.replace(/(\w+)\$1\./g, '$1.');

    // Now properly fix SQL placeholders only in query/run/db.run calls
    // Pattern 1: query('SELECT ... WHERE x = ?', [val])
    // Pattern 2: db.run('DELETE ... WHERE id = ?', [id])

    const fixSqlPlaceholders = (str) => {
        // Count ? and replace with $1, $2, etc.
        const count = (str.match(/\?/g) || []).length;
        let result = str;
        for (let i = 1; i <= count; i++) {
            result = result.replace(/\?/, `$${i}`);
        }
        return result;
    };

    // Fix query('...', [...]) calls
    content = content.replace(
        /query\(['"`]([^'"`]*?)['"`]\s*,\s*\[/g,
        (match, sql) => {
            if (sql.includes('?')) {
                return `query('${fixSqlPlaceholders(sql)}', [`;
            }
            return match;
        }
    );

    // Fix db.run('...', [...]) and run('...', [...]) calls
    content = content.replace(
        /(db\.)?run\(['"`]([^'"`]*?)['"`]\s*,\s*\[/g,
        (match, prefix, sql) => {
            if (sql.includes('?')) {
                const fixed = fixSqlPlaceholders(sql);
                return `${prefix || ''}run('${fixed}', [`;
            }
            return match;
        }
    );

    // Fix standalone SQL strings in INSERT/SELECT patterns
    // Be very careful - only fix patterns that look like SQL
    content = content.replace(
        /'([^']*\?(?:[^']|\?)*?)'/g,
        (match) => {
            // Only fix if it looks like SQL (contains SELECT, INSERT, UPDATE, DELETE, VALUES, WHERE)
            const sql = match;
            if (/SELECT|INSERT|UPDATE|DELETE|VALUES|WHERE/.test(sql)) {
                return `'${fixSqlPlaceholders(sql.slice(1, -1))}'`;
            }
            return match;
        }
    );

    fs.writeFileSync(filePath, content);
    console.log(`✅ Fixed: ${file}`);
});

console.log(`\n📊 Fixed ${files.length} files`);

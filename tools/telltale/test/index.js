'use strict';
// Entry point so `node --test tools/telltale/test/` works on every Node version:
// the runner resolves the directory to this file, which loads every *.test.js in-process.
const fs = require('fs');
const path = require('path');
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) require(path.join(__dirname, f));
// rule fixture tests live in test/rules/ (diagnosis-cause-rules)
const rulesDir = path.join(__dirname, 'rules');
if (fs.existsSync(rulesDir)) for (const f of fs.readdirSync(rulesDir).filter((n) => n.endsWith('.test.js')).sort()) require(path.join(rulesDir, f));

const fs=require('node:fs'),path=require('node:path');
module.exports=['core-schema.sql','bot-schema.sql','agent-binding-schema.sql','role-schema.sql','workspace-schema.sql'].map(name=>fs.readFileSync(path.join(__dirname,'../../scripts/historical-schema',name),'utf8')).join('\n');

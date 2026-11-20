#!/usr/bin/env node
// Read-only review for the image-version upgrade. Never executes DDL or changes files.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
function inspect(filename) {
  const absolute = path.resolve(filename);
  if (fs.lstatSync(absolute).isSymbolicLink()) throw Error('Refusing a symbolic-link database');
  const db = new Database(absolute, {readonly:true,fileMustExist:true});
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'image_%'").all().map(row=>row.name).sort();
    if (JSON.stringify(tables)!==JSON.stringify(['image_assets','image_conversations','image_tasks'])) throw Error('Expected the three-table image schema; review other schemas separately');
    const columns = db.prepare('PRAGMA table_info(image_assets)').all().map(row=>row.name);
    const required=['root_asset_id','version_number','ready_at','max_version_number','deleted_at','cleanup_state','cleanup_error'];
    const rows=db.prepare('SELECT * FROM image_assets ORDER BY task_id,created_at,id').all();
    const current=required.every(name=>columns.includes(name));
    return {
      schema:current?'versioned':'requires-explicit-upgrade',
      missingColumns:required.filter(name=>!columns.includes(name)),
      assetCount:rows.length,
      rowDigest:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      proposals:rows.filter(row=>row.availability==='ready' && !row.source_asset_id && ['reference','output'].includes(row.role)).map(row=>({
        assetId:row.id,taskId:row.task_id,kind:row.role==='reference'?'uploaded-original':'generated-result',
        rootAssetId:current?row.root_asset_id:row.id,versionNumber:current?row.version_number:0,
        readyAt:current?row.ready_at:null,
        mapping:current?'existing':'independent-series-pending-approval',
      })),
      note:'No writes performed. Historical creation time is not a proven completion time. Independent-series mapping preserves every result without guessing its original; approve or revise this mapping before a migration script is prepared. Existing Pi files and image files are unaffected.',
    };
  } finally { db.close(); }
}
module.exports={inspect};
if(require.main===module){
  try {
    if(process.argv.length!==3)throw Error('Usage: node scripts/image-version-preflight.cjs DATABASE (read-only)');
    console.log(JSON.stringify(inspect(process.argv[2]),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}

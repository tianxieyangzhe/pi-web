import Database from 'better-sqlite3';
type SchemaObject={name:string;type:string;sql:string|null};
// SQLite quotes the table name after ALTER TABLE ... RENAME TO. This is the same schema.
const normalize=(sql:string|null)=>(sql??'').replace(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/,'CREATE TABLE $1').replace(/\s+/g,' ').trim();
export function matchesTargetSchema(db:Database.Database,targetSchema:string):boolean{
  const expected=new Database(':memory:');
  try{
    expected.exec(targetSchema);
    const query="SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'";
    const target=expected.prepare(query).all() as SchemaObject[],actual=db.prepare(query).all() as SchemaObject[];
    const byName=new Map(actual.map(row=>[row.name,row]));
    if(actual.length !== target.length)return false;
    return target.every(row=>{const found=byName.get(row.name);return found?.type===row.type&&normalize(found.sql)===normalize(row.sql);});
  }catch{return false;}finally{expected.close();}
}

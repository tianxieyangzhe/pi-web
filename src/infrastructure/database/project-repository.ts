import type Database from 'better-sqlite3';
import type {Project} from '@/domain/models';
import type {ProjectRepositoryPort} from '@/application/ports/catalog';
import {DomainError} from '@/domain/errors';
import {roleETag} from '@/domain/agent-definition';
import {entityId,now,type DatabaseRow} from './common';
function mapProject(row:DatabaseRow):Project{return {id:String(row.id),name:String(row.name),description:row.description as string|null,kind:row.kind as Project['kind'],rootPath:String(row.root_path),status:row.status as Project['status'],createdAt:String(row.created_at),updatedAt:String(row.updated_at)};}
export function createProjectRepository(db:Database.Database,assertWritable:()=>void=()=>{}):ProjectRepositoryPort{
 function translate(error:unknown):never{const code=(error as {code?:string}).code;if(code==='SQLITE_CONSTRAINT_UNIQUE')throw new DomainError('ROOT_PATH_CONFLICT','此独立项目目录已存在',409,true);if(code==='SQLITE_CONSTRAINT_FOREIGNKEY')throw new DomainError('PROJECT_REFERENCED','项目仍被历史记录引用',409,true);throw error;}
 const repository:ProjectRepositoryPort={
  list:()=> (db.prepare('SELECT * FROM projects ORDER BY status,name,id').all() as DatabaseRow[]).map(mapProject),
  get(id){const row=db.prepare('SELECT * FROM projects WHERE id=?').get(id) as DatabaseRow|undefined;return row?mapProject(row):null;},
  create(input){assertWritable();try{const id=entityId('project'),timestamp=now();db.prepare('INSERT INTO projects(id,name,description,kind,root_path,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,input.name,input.description,input.kind,input.rootPath,input.status,timestamp,timestamp);return this.get(id)!;}catch(error){return translate(error);}},
  update(id,patch,expected){assertWritable();try{return db.transaction(()=>{const current=this.get(id);if(!current)return null;if(expected&&roleETag(current)!==expected)throw new DomainError('WRITE_CONFLICT','项目已变化，请重新读取',409,true);if(patch.rootPath!==undefined&&patch.rootPath!==current.rootPath&&this.isInUse(id))throw new DomainError('PROJECT_REFERENCED','已有记录引用此项目目录',409,true);db.prepare('UPDATE projects SET name=?,description=?,kind=?,root_path=?,status=?,updated_at=? WHERE id=?').run(patch.name??current.name,patch.description===undefined?current.description:patch.description,patch.kind??current.kind,patch.rootPath??current.rootPath,patch.status??current.status,now(),id);return this.get(id);}).immediate();}catch(error){return translate(error);}},
  delete(id,expected){assertWritable();try{return db.transaction(()=>{const current=this.get(id);if(!current)return false;if(expected&&roleETag(current)!==expected)throw new DomainError('WRITE_CONFLICT','项目已变化，请重新读取',409,true);if(this.isInUse(id))throw new DomainError('PROJECT_REFERENCED','项目仍被历史记录引用',409,true);return db.prepare('DELETE FROM projects WHERE id=?').run(id).changes>0;}).immediate();}catch(error){return translate(error);}},
  isInUse(id){const tables=['sessions','agents','bot_projects','bot_conversation_projects','project_calls'];for(const name of tables){if(db.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'").get(name)&&db.prepare('SELECT 1 FROM '+name+' WHERE project_id=? LIMIT 1').get(id))return true;}return false;},
 };
 return repository;
}

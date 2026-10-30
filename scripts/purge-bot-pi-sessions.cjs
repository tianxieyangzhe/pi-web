#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const Database=require('better-sqlite3');

const projectRoot=path.resolve(__dirname,'..');
const requestedDataRoot=path.resolve(process.env.AI_WORKSPACE_DATA_ROOT||path.join(projectRoot,'.data')),
  dataRoot=fs.existsSync(requestedDataRoot)?fs.realpathSync(requestedDataRoot):requestedDataRoot;
function scanTree(directory,files=[]){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const fullPath=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw new Error(`发现符号链接，为避免越界删除已停止：${fullPath}`);
    if(entry.isDirectory())scanTree(fullPath,files);
    else if(entry.isFile())files.push({path:fullPath,size:fs.statSync(fullPath).size});
    else throw new Error(`发现非普通文件，已停止：${fullPath}`);
  }
  return files;
}
function inspectBackup(backupPath){
  backupPath=path.resolve(backupPath);
  const db=new Database(backupPath,{readonly:true,fileMustExist:true});
  try{
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bots'").get())throw new Error('备份中没有 bots 表，未处理文件。');
    const ids=db.prepare('SELECT id FROM bots ORDER BY id').all().map(row=>String(row.id)),directories=[];
    for(const botId of ids){
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(botId))throw new Error(`Bot ID 含不安全路径字符：${botId}`);
      const botsRoot=path.join(dataRoot,'bots'),botRoot=path.resolve(botsRoot,botId),sessionPath=path.join(botRoot,'pi-sessions');
      if(!sessionPath.startsWith(path.join(dataRoot,'bots')+path.sep))throw new Error('Pi Session 路径越出应用 Bot 数据根目录。');
      if(!fs.existsSync(sessionPath))continue;
      if(fs.lstatSync(botsRoot).isSymbolicLink()||fs.lstatSync(botRoot).isSymbolicLink())throw new Error(`Bot 数据路径包含符号链接：${botRoot}`);
      const info=fs.lstatSync(sessionPath);
      if(info.isSymbolicLink()||!info.isDirectory())throw new Error(`Pi Session 路径不是普通目录：${sessionPath}`);
      const real=fs.realpathSync(sessionPath);if(real!==sessionPath)throw new Error(`Pi Session 路径包含符号链接或别名：${sessionPath}`);
      const files=scanTree(sessionPath);
      directories.push({botId,path:sessionPath,fileCount:files.length,totalBytes:files.reduce((sum,file)=>sum+file.size,0),files:files.map(file=>({path:path.relative(sessionPath,file.path),size:file.size}))});
    }
    return {backupPath,dataRoot,botIds:ids,piSessionDirectories:directories,totalFiles:directories.reduce((sum,item)=>sum+item.fileCount,0),totalBytes:directories.reduce((sum,item)=>sum+item.totalBytes,0)};
  }finally{db.close();}
}
function ensureNoOpenHandles(plan){
  for(const directory of plan.piSessionDirectories)for(const file of directory.files){
    const result=spawnSync('lsof',['-t',path.join(directory.path,file.path)],{encoding:'utf8',timeout:10000});
    if(result.error||result.status!==1&&result.status!==0)throw new Error('无法确认 Bot Pi transcript 文件是否仍被打开；已中止清理。');
    if(result.status===0&&result.stdout.trim())throw new Error(`Pi transcript 仍有打开连接（PID ${result.stdout.trim()}）：${path.join(directory.path,file.path)}`);
  }
}
async function applyPurge(backupPath,plan=inspectBackup(backupPath),options={}){
  if(options.checkOffline!==false)ensureNoOpenHandles(plan);
  if(!plan.totalFiles)return {applied:true,backupArchive:null,removedDirectories:[],removedFiles:0,totalBytes:0};
  const backupArchive=`${plan.backupPath}.bot-pi-history.bak`;
  if(fs.existsSync(backupArchive))throw new Error(`Pi 历史备份目录已存在，拒绝覆盖：${backupArchive}`);
  fs.mkdirSync(backupArchive,{recursive:false});
  try{
    for(const directory of plan.piSessionDirectories){
      const destination=path.join(backupArchive,directory.botId,'pi-sessions');
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.cpSync(directory.path,destination,{recursive:true,errorOnExist:true,force:false,dereference:false});
      const copied=scanTree(destination),copiedBytes=copied.reduce((sum,file)=>sum+file.size,0);
      if(copied.length!==directory.fileCount||copiedBytes!==directory.totalBytes)throw new Error(`Pi 历史备份核验失败：${directory.botId}`);
    }
    for(const directory of plan.piSessionDirectories)fs.rmSync(directory.path,{recursive:true,force:false});
    for(const directory of plan.piSessionDirectories)if(fs.existsSync(directory.path))throw new Error(`Pi Session 目录未清理：${directory.path}`);
    return {applied:true,backupArchive,removedDirectories:plan.piSessionDirectories.map(item=>item.path),removedFiles:plan.totalFiles,totalBytes:plan.totalBytes};
  }catch(error){
    throw new Error(`${error instanceof Error?error.message:String(error)}。已保留备份目录：${backupArchive}`);
  }
}
async function main(){
  const args=process.argv.slice(2),apply=args.includes('--apply'),backupPath=args.find(value=>value!=='--apply');
  if(!backupPath)throw new Error('Usage: node scripts/purge-bot-pi-sessions.cjs <pre-reset-database-backup> [--apply]');
  const plan=inspectBackup(backupPath);
  if(!apply){console.log(JSON.stringify({mode:'preview',warning:'只清理该数据库备份中列出的 Bot ID 对应的应用管理 pi-sessions 目录；workspace 和项目 Session 历史不变。',...plan},null,2));return;}
  console.log(JSON.stringify(await applyPurge(backupPath,plan),null,2));
}
if(require.main===module)main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
module.exports={inspectBackup,applyPurge};

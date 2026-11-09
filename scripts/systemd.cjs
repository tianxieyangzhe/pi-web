#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const help=`Usage: node scripts/systemd.cjs <render|install> [options]
  --system           System unit in /etc/systemd/system (default: user unit)
  --user NAME        Required with --system; non-root service account
  --app-dir PATH     Repository root (default: script's parent directory)
  --node PATH        Absolute Node executable (default: current Node)
  --port NUMBER      Listen port (default: 3000)
  --host ADDRESS     Listen address (default: 0.0.0.0)
  --name NAME        Unit name without .service (default: ai-workspace)
  --force            Allow install to replace a different existing unit
Install reloads systemd only; it does not build, enable, start or restart the app.
`;
function parse(argv){
 const options={command:argv[0],system:false,user:null,appDir:path.resolve(__dirname,'..'),node:process.execPath,port:'3000',host:'0.0.0.0',name:'ai-workspace',force:false};
 if(!['render','install'].includes(options.command))throw Error(help);
 const fields={'--user':'user','--app-dir':'appDir','--node':'node','--port':'port','--host':'host','--name':'name'};
 for(let i=1;i<argv.length;i++){const arg=argv[i];if(arg==='--system')options.system=true;else if(arg==='--force')options.force=true;else if(fields[arg]){const value=argv[++i];if(!value||value.startsWith('--'))throw Error(`Missing value for ${arg}`);options[fields[arg]]=value;}else throw Error(`Unknown option: ${arg}`);}
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.name))throw Error('Invalid service name');
 if(!/^\d{1,5}$/.test(options.port)||Number(options.port)<1||Number(options.port)>65535)throw Error('Invalid port');options.port=String(Number(options.port));
 if(!/^[a-zA-Z0-9.:[\]_-]+$/.test(options.host)||options.host.startsWith('-'))throw Error('Invalid host');
 if(!path.isAbsolute(options.appDir)||!path.isAbsolute(options.node))throw Error('--app-dir and --node must be absolute paths');
 if(options.system&&(!options.user||options.user==='root'||! /^[a-zA-Z_][a-zA-Z0-9_-]*\$?$/.test(options.user)))throw Error('--system requires --user with a non-root service account');
 if(!options.system&&options.user)throw Error('--user is only valid with --system');
 for(const value of Object.values(options))if(typeof value==='string'&&/[\x00-\x1f\x7f]/.test(value))throw Error('Control characters are not allowed');
 return options;
}
// systemd expands % specifiers in strings and $ variables in ExecStart arguments.
function quote(value,exec=false){return '"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/%/g,'%%').replace(/\$/g,exec?'$$$$':'$')+'"';}
function render(options,account,environmentPath=process.env.PATH??'/usr/local/bin:/usr/bin:/bin'){
 if(!account.home||!path.isAbsolute(account.home)||/[\x00-\x1f\x7f]/.test(account.home)||/[\x00-\x1f\x7f]/.test(environmentPath))throw Error('Invalid account home or PATH');
 const env={NODE_ENV:'production',INIT_CWD:options.appDir,HOME:account.home,NODE_BINARY:options.node,APP_HOST:options.host,PORT:options.port,PATH:[path.dirname(options.node),environmentPath,'/usr/local/bin:/usr/bin:/bin'].filter(Boolean).join(':')};
 return `[Unit]\nDescription=AI Workspace Next.js server\nAfter=network.target\nStartLimitIntervalSec=60\nStartLimitBurst=5\n\n[Service]\nType=simple\n${options.system?`User=${options.user}\n`:''}WorkingDirectory=${quote(options.appDir)}\n${Object.entries(env).map(([key,value])=>'Environment='+quote(key+'='+value)).join('\n')}\nExecStart=/bin/bash ${quote(path.join(options.appDir,'scripts/start-systemd.sh'),true)}\nRestart=on-failure\nRestartSec=5\nKillSignal=SIGTERM\nKillMode=control-group\nTimeoutStopSec=120\nUMask=0077\nStandardOutput=journal\nStandardError=journal\n\n[Install]\nWantedBy=${options.system?'multi-user.target':'default.target'}\n`;
}
function accountFor(options){
 if(!options.system){const account=os.userInfo();if(account.uid===0)throw Error('For a system service use --system --user NAME; do not run a user service as root');return {home:account.homedir};}
 const fields=execFileSync('getent',['passwd',options.user],{encoding:'utf8'}).trim().split(':');if(fields.length!==7||fields[0]!==options.user||fields[2]==='0')throw Error('Service account not found or is root');return {home:fields[5]};
}
function install(options,unit,account){
 if(process.platform!=='linux')throw Error('Installation requires Linux with systemd; render can be used to inspect the unit');
 if(options.system&&process.getuid()!==0)throw Error('System unit installation requires root; run this command with sudo');
 fs.accessSync(options.node,fs.constants.X_OK);fs.accessSync(path.join(options.appDir,'scripts/start-systemd.sh'),fs.constants.R_OK);
 const folder=options.system?'/etc/systemd/system':path.join(process.env.XDG_CONFIG_HOME||path.join(account.home,'.config'),'systemd/user');
 const target=path.join(folder,options.name+'.service');let existing;try{existing=fs.readFileSync(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(existing!==undefined&&existing!==unit&&!options.force)throw Error(`${target} already exists with different content; review render output and use --force to replace it`);
 fs.mkdirSync(folder,{recursive:true});const temporary=target+'.'+process.pid+'.tmp';try{fs.writeFileSync(temporary,unit,{mode:0o644,flag:'wx'});fs.renameSync(temporary,target);}finally{try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
 execFileSync('systemctl',[...(options.system?[]:['--user']),'daemon-reload'],{stdio:'inherit'});
 console.log(`Installed ${target}\nNot started. Run: systemctl ${options.system?'':'--user '}enable --now ${options.name}.service`);
}
if(require.main===module){try{if(process.argv.slice(2).includes('--help')){console.log(help);}else{const options=parse(process.argv.slice(2)),account=accountFor(options),unit=render(options,account);if(options.command==='render')process.stdout.write(unit);else install(options,unit,account);}}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={parse,quote,render,install};

import{mkdirSync,writeFileSync,readFileSync,openSync,readSync,closeSync,existsSync,rmdirSync}from'node:fs';import{resolve,join}from'node:path';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';import{docker,stack}from'./docker.mjs';
export function sha(file){const hash=createHash('sha256'),fd=openSync(file,'r'),chunk=Buffer.alloc(1024*1024);try{let n;while((n=readSync(fd,chunk,0,chunk.length,null))>0)hash.update(chunk.subarray(0,n));return hash.digest('hex');}finally{closeSync(fd);}}
export const factTables=['products','groups','orders','payments','refunds','fulfillment_orders','shipments','notifications','admin_operation_logs','media_assets'];
export function facts(s){const data={};for(const name of factTables){const sql=`SELECT json_build_object('count',count(*),'digest',md5(coalesce(string_agg(rowtext,E'\\n' ORDER BY rowtext),''))) FROM (SELECT row_to_json(t)::text rowtext FROM ${name} t) x`;data[name]=JSON.parse(s.exec('postgres','psql','-U',s.env.POSTGRES_USER,'-d',s.env.POSTGRES_DB,'-At','-c',sql).trim());}return data;}
export function mediaFiles(s){return s.run('run','--rm','--no-deps','--entrypoint','sh','api','-c',"cd /var/lib/pindian/media && find . -type f -exec sha256sum '{}' ';' | sort").trim();}
export function backup({project,envFile,output,rehearsal=false}){
 const root=resolve('backup'),dir=resolve(output);if(!dir.startsWith(root+'/')&&!dir.startsWith(root+'\\'))throw Error('备份目录必须在workspace/backup内');if(existsSync(dir))throw Error('备份输出已存在，不能覆盖');
 const s=stack(project,envFile,{rehearsal});const running=s.run('ps','--services','--status','running').trim().split(/\s+/).filter(x=>['api','worker',...(rehearsal?['simulator']:[])].includes(x));
 mkdirSync(dir,{recursive:true});const lock=join(root,'.'+project+'.lock');try{mkdirSync(lock);}catch{throw Error('源项目已有备份在执行');}
 try{if(running.length)s.run('stop',...running);
 const dump=join(dir,'database.dump');let fd=openSync(dump,'wx');try{docker([...s.args,'exec','-T','postgres','pg_dump','-U',s.env.POSTGRES_USER,'-d',s.env.POSTGRES_DB,'--format=custom','--no-owner','--no-acl'],{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
 const media=join(dir,'media.tar');fd=openSync(media,'wx');try{docker([...s.args,'run','--rm','--no-deps','--entrypoint','tar','api','-C','/var/lib/pindian/media','-cf','-','.'],{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
 const files={'database.dump':sha(dump),'media.tar':sha(media)};
 if(rehearsal){const channel=join(dir,'simulator.tar');fd=openSync(channel,'wx');try{docker([...s.args,'run','--rm','--no-deps','--entrypoint','tar','simulator','-C','/state','-cf','-','.'],{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}files['simulator.tar']=sha(channel);}
 const m={version:1,sourceProject:project,createdAt:new Date().toISOString(),files,facts:facts(s),mediaFiles:mediaFiles(s),migrations:s.exec('postgres','psql','-U',s.env.POSTGRES_USER,'-d',s.env.POSTGRES_DB,'-At','-c','SELECT name FROM schema_migrations ORDER BY name').trim().split(/\r?\n/)};
 writeFileSync(join(dir,'manifest.json'),JSON.stringify(m,null,2)+'\n');return m;
 }finally{try{if(running.length)s.run('start',...running);}finally{rmdirSync(lock);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[project,envFile,output,mode]=process.argv.slice(2);try{backup({project,envFile,output,rehearsal:mode==='rehearsal'});console.log('数据库与媒体备份完成，清单不含密钥；请保护备份中的业务数据。');}catch(e){console.error(e.message);process.exitCode=1;}}

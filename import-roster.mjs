import {DatabaseSync} from 'node:sqlite';import {readFileSync,mkdirSync} from 'node:fs';import {dirname} from 'node:path';import {randomBytes,scryptSync} from 'node:crypto';import {schema} from './server.mjs';
if(process.env.DEMO==='1')throw Error('Import prohibited in demo mode');
const path=process.env.DB_PATH;if(!path||!process.argv[2])throw Error('Set DB_PATH and provide local roster file.');
const names=readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
if(!names.length||names.some(x=>x.length<2||x.length>100)||new Set(names).size!==names.length)throw Error('Check roster file.');
mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);schema(db);const insert=db.prepare('INSERT INTO students VALUES(?,?,?)');const check=db.prepare('SELECT id FROM students WHERE name=?');const results=[];
db.exec('BEGIN');try{for(const name of names){if(check.get(name))continue;const id=randomBytes(12).toString('hex'),pin=randomBytes(5).toString('hex'),salt=randomBytes(16).toString('hex');insert.run(id,name,salt+':'+scryptSync(pin,salt,32).toString('hex'));results.push({name,pin})}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}finally{db.close()}for(const x of results)console.log(x.name+' — '+x.pin);console.log('Added: '+results.length);

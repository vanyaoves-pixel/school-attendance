import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const tz='Asia/Almaty';
export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function shift(d,n){const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)}
export function weekStart(d){const day=new Date(d+'T12:00:00Z').getUTCDay();return shift(d,-((day+6)%7))}
export function validDate(x){return typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x}
export const days=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)+1;
const reasons=['По болезни','Семейные обстоятельства','Посещение врача','Соревнования / мероприятие','Другое'];
export function cleanup(db,d=today()){return db.prepare('DELETE FROM absences WHERE end_date < ?').run(weekStart(d)).changes}
export function schema(db){db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,pin TEXT NOT NULL); CREATE TABLE IF NOT EXISTS absences(student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,start_date TEXT NOT NULL,end_date TEXT NOT NULL,reason TEXT NOT NULL,note TEXT NOT NULL,uncertain INTEGER NOT NULL,updated_at TEXT NOT NULL);")}
export function current(db,d=today()){return db.prepare('SELECT s.id,s.name,a.start_date,a.end_date,a.reason,a.note,a.uncertain FROM absences a JOIN students s ON s.id=a.student_id WHERE a.start_date<=? AND a.end_date>=? ORDER BY s.name').all(d,d).map(x=>({...x,days:days(x.start_date,x.end_date)}))}
export function saveAbsence(db,id,d,end,reason,note,uncertain){if(!validDate(end)||end<d||end>shift(d,90))throw Error('Укажите дату окончания в пределах 90 дней.');if(!reasons.includes(reason))throw Error('Выберите причину.'); const prev=db.prepare('SELECT * FROM absences WHERE student_id=?').get(id);const start=prev&&prev.end_date>=shift(d,-1)&&prev.start_date<=d?prev.start_date:d;db.prepare("INSERT INTO absences VALUES(?,?,?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET start_date=excluded.start_date,end_date=excluded.end_date,reason=excluded.reason,note=excluded.note,uncertain=excluded.uncertain,updated_at=excluded.updated_at").run(id,start,end,reason,note,uncertain?1:0,new Date().toISOString());return {start,end,days:days(start,end)}}
export function returned(db,id,d=today()){const a=db.prepare('SELECT * FROM absences WHERE student_id=?').get(id);if(!a||a.end_date<d)return;if(a.start_date>=d)db.prepare('DELETE FROM absences WHERE student_id=?').run(id);else db.prepare('UPDATE absences SET end_date=?,uncertain=0 WHERE student_id=?').run(shift(d,-1),id)}
const hash=(p,s=randomBytes(16).toString('hex'))=>s+':'+scryptSync(p,s,32).toString('hex');
function match(p,h){try{const [s]=h.split(':');return timingSafeEqual(Buffer.from(hash(p,s)),Buffer.from(h))}catch{return false}}
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
function start(){
 const demo=process.env.DEMO==='1';const teacher=process.env.TEACHER_PASSWORD||(demo?'demo-teacher-2026':'');const classCode=process.env.CLASS_CODE||(demo?'demo-class-2026':'');if(teacher.length<(demo?6:12)||classCode.length<10)throw Error('Set TEACHER_PASSWORD (12+) and CLASS_CODE (10+) or DEMO=1 for local testing.');
 const path=process.env.DB_PATH||join(root,'data','attendance.sqlite');mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);schema(db);
 if(demo&&!db.prepare('SELECT count(*) AS n FROM students').get().n){for(let i=1;i<=23;i++)db.prepare('INSERT INTO students VALUES(?,?,?)').run(randomBytes(12).toString('hex'),'Ученик '+String(i).padStart(2,'0'),hash('12345678'))}
 const sessions=new Map(),limits=new Map();const cookieName='attendance_session';
 const send=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data))};
 const issue=(res,role)=>{const id=randomBytes(32).toString('hex');sessions.set(id,{role,exp:Date.now()+8*3600000});send(res,200,{ok:true},{'Set-Cookie':cookieName+'='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+(demo?'':'; Secure')})};
 function session(req){const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);const s=sessions.get(id);return s&&s.exp>Date.now()?s:null}
 function rate(req,key,max){const ip=req.socket.remoteAddress;const k=ip+':'+key;const now=Date.now();let r=limits.get(k);if(!r||r.until<now){r={n:0,until:now+60000};limits.set(k,r)}return ++r.n<=max}
 async function body(req){let str='';for await(const ch of req){str+=ch;if(str.length>16000)throw Error('Слишком большой запрос.')}return JSON.parse(str||'{}')}
 const assets={'/':['index.html','text/html'], '/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
 const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");const p=new URL(req.url,'http://localhost').pathname;const m=req.method;try{
 if(m==='GET'&&assets[p]){const [f,type]=assets[p];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});return res.end(readFileSync(join(root,'public',f)))}
 if(m==='GET'&&p==='/health')return send(res,200,{ok:true});
 if(!p.startsWith('/api/'))return send(res,404,{error:'Не найдено'});
 const d=today();cleanup(db,d);
 if(m==='POST'&&!String(req.headers['content-type']).startsWith('application/json'))return send(res,415,{error:'Неверный формат'});
 if(m==='POST'&&['/api/parent-login','/api/teacher-login'].includes(p)){if(!rate(req,'login',5))return send(res,429,{error:'Повторите через минуту.'});const b=await body(req);const role=p.includes('teacher')?'teacher':'parent';if(!equal(b.password,role==='teacher'?teacher:classCode))return send(res,401,{error:'Неверный код доступа.'});return issue(res,role)}
 const s=session(req)||(demo?{role:'parent'}:null);if(m==='GET'&&p==='/api/session')return send(res,200,{role:s?.role||null,today:d,demo,openParent:demo});
 if(!s)return send(res,401,{error:'Войдите в систему.'});
 if(m==='POST'&&p==='/api/logout'){const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);sessions.delete(id);return send(res,200,{ok:true},{'Set-Cookie':cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})}
 if(m==='GET'&&p==='/api/students')return send(res,200,{students:db.prepare('SELECT id,name FROM students ORDER BY name').all(),today:d});
 if(m==='POST'&&['/api/absence','/api/returned'].includes(p)){if(!rate(req,'submit',30))return send(res,429,{error:'Повторите через минуту.'});const b=await body(req);const st=db.prepare('SELECT * FROM students WHERE id=?').get(String(b.id||''));if(!st||(s.role!=='teacher'&&!demo&&!match(String(b.pin||''),st.pin)))return send(res,403,{error:'Неверный личный код ученика.'});if(p.endsWith('returned')){returned(db,st.id,d);return send(res,200,{ok:true})}const note=String(b.note||'').trim();if(note.length>300)return send(res,400,{error:'Пояснение не более 300 символов.'});const result=saveAbsence(db,st.id,d,b.end,b.reason,note,b.uncertain===true);return send(res,200,{ok:true,...result});}
 if(s.role!=='teacher')return send(res,403,{error:'Доступ только учителю.'});
 if(m==='GET'&&p==='/api/dashboard'){return send(res,200,{today:d,week:weekStart(d),total:db.prepare('SELECT count(*) AS n FROM students').get().n,absent:current(db,d)})}
 if(m==='POST'&&p==='/api/student-add'){const b=await body(req);const name=String(b.name||'').trim();if(name.length<2||name.length>100)throw Error('Проверьте имя.');if(demo&&!/^Ученик \d{1,3}$/.test(name))throw Error('Укажите вымышленное имя в формате Ученик 24.');const pin=randomBytes(5).toString('hex');const id=randomBytes(12).toString('hex');db.prepare('INSERT INTO students VALUES(?,?,?)').run(id,name,hash(pin));return send(res,200,{id,name,pin})}
 if(m==='POST'&&p==='/api/student-reset'){const b=await body(req);const pin=randomBytes(5).toString('hex');if(!db.prepare('UPDATE students SET pin=? WHERE id=?').run(hash(pin),String(b.id||'')).changes)return send(res,404,{error:'Ученик не найден.'});return send(res,200,{pin})}
 if(m==='POST'&&p==='/api/student-delete'){const b=await body(req);db.prepare('DELETE FROM students WHERE id=?').run(String(b.id||''));return send(res,200,{ok:true})}
 return send(res,404,{error:'Не найдено'});
 }catch(e){const msg=String(e.message||'');return send(res,400,{error:msg.startsWith('UNIQUE')?'Такое имя уже есть.':/^(Укажите|Выберите|Проверьте|Слишком)/.test(msg)?msg:'Не удалось выполнить запрос. Проверьте данные.'})}});
 cleanup(db);setInterval(()=>{try{cleanup(db);const now=Date.now();for(const [k,v] of sessions)if(v.exp<now)sessions.delete(k);for(const [k,v] of limits)if(v.until<now)limits.delete(k)}catch{console.error('Cleanup failed')}},60000).unref();
 server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Attendance ready'));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])start();

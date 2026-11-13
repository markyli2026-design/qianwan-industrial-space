import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataset=JSON.parse(fs.readFileSync(path.join(root,'server/generated/parcels.json'),'utf8'));
const stateDir=process.env.STATE_DIR||path.join(root,'server/state');
fs.mkdirSync(stateDir,{recursive:true});
const editsPath=path.join(stateDir,'edits.json');
let edits=fs.existsSync(editsPath)?JSON.parse(fs.readFileSync(editsPath,'utf8')):{};
const original=new Map(dataset.records.map(p=>[p.id,p]));
const merged=id=>({...original.get(id),...edits[id],provenance:{...original.get(id).provenance,...edits[id]?.provenance}});
const enums={
  zone:['','z1','z2','z3','z4','z5','z6'],supply:['已供','未供','批而未供','未登记'],
  built:['已形成','尚未形成','未登记'],approval:['未报','在批','已批','未登记'],
  forest:['不涉及','在办','已批','未登记'],sea:['不涉及','在办','已批','未登记'],
  availability:['可立即使用','仍在报批审核','未登记'],scattered:['是','否','未登记']
};
for(const key of ['power','water','road','drainage','gas','heating','telecom']) enums[key]=['已到达','未到达','未登记'];
const strings=['name','park','industry','direction','owner','use','phase'];
const allowed=new Set([...strings,...Object.keys(enums),'area','enterprises']);
function validate(changes,current) {
  if(!changes||typeof changes!=='object'||Array.isArray(changes)) throw new Error('无效更新');
  for(const [key,value] of Object.entries(changes)) {
    if(!allowed.has(key)) throw new Error('不支持修改字段 '+key);
    if(strings.includes(key)&&(typeof value!=='string'||value.length>500)) throw new Error('字段长度或类型错误 '+key);
    if(enums[key]&&!enums[key].includes(value)) throw new Error('状态值错误 '+key);
    if(key==='area'&&(!Number.isFinite(value)||value<=0)) throw new Error('面积必须大于0');
    if(key==='enterprises'&&value!==null) {
      if(!Array.isArray(value)||value.length>100) throw new Error('企业列表无效');
      for(const e of value) {
        if(!e||typeof e.name!=='string'||!e.name.trim()) throw new Error('企业名称不能为空');
        for(const [k,v] of Object.entries(e)) {
          if(!['name','code','industry','area','operating'].includes(k)||!['string','number'].includes(typeof v)||String(v).length>500) throw new Error('企业字段无效');
        }
      }
    }
  }
  const next={...current,...changes};
  if(!next.name.trim()||!next.use.trim()) throw new Error('坐落与用途不能为空');
  if(next.availability==='可立即使用'&&(next.supply!=='已供'||next.built!=='已形成'||next.approval==='在批'||next.forest==='在办'||next.sea==='在办')) throw new Error('可用性与基础状态冲突');
}
function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try {
    if(req.method==='GET'&&url.pathname==='/api/parcels') return json(res,200,{meta:dataset.meta,records:dataset.records.map(p=>merged(p.id))});
    if(req.method==='PUT'&&url.pathname.startsWith('/api/parcels/')) {
      const id=decodeURIComponent(url.pathname.slice('/api/parcels/'.length));
      if(!original.has(id)) return json(res,404,{error:'宗地不存在'});
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`) return json(res,403,{error:'请求来源不匹配'});
      let body='';
      for await (const chunk of req) {
        body+=chunk;
        if(Buffer.byteLength(body)>200000) return json(res,413,{error:'请求过大'});
      }
      const {revision,changes}=JSON.parse(body);
      const current=merged(id);
      if(revision!==current.revision) return json(res,409,{error:'记录已被其他窗口更新，请刷新后重试'});
      validate(changes,current);
      const patch={...edits[id],...changes,revision:current.revision+1,updatedAt:new Date().toISOString(),provenance:{...edits[id]?.provenance}};
      for(const key of Object.keys(changes)) patch.provenance[key]='人工维护';
      if('area' in changes) {patch.actualArea=changes.area*2000/3;patch.provenance.actualArea='人工维护';}
      const nextEdits={...edits,[id]:patch};
      const temp=editsPath+'.tmp';
      fs.writeFileSync(temp,JSON.stringify(nextEdits));
      fs.renameSync(temp,editsPath);
      edits=nextEdits;
      return json(res,200,merged(id));
    }
    if(req.method!=='GET') return json(res,405,{error:'请求方法不支持'});
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const publicDir=path.join(root,'public');
    const file=path.resolve(publicDir,'.'+relative);
    if(!file.startsWith(publicDir+path.sep)||!mime[path.extname(file)]||!fs.existsSync(file)) return json(res,404,{error:'未找到文件'});
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]+'; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    fs.createReadStream(file).pipe(res);
  } catch(error) {json(res,error instanceof SyntaxError?400:422,{error:error.message});}
});
const port=Number(process.env.PORT||43880);
server.listen(port,'127.0.0.1',()=>console.log('系统已启动 http://127.0.0.1:'+port));

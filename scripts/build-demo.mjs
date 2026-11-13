import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {area,bbox,featureCollection} from '@turf/turf';

// The public build never reads the private shapefile, generated dataset or edits.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist');
await fs.mkdir(path.join(out,'vendor'),{recursive:true});
const files=['app.js','bootstrap.js','map.js','basemap-light.json','styles.css','theme.css','system.css'];
for(const file of files)await fs.copyFile(path.join(root,'public',file),path.join(out,file));
for(const [source,target] of [['maplibre-gl/dist/maplibre-gl.js','maplibre-gl.js'],['maplibre-gl/dist/maplibre-gl.css','maplibre-gl.css'],['@turf/turf/turf.min.js','turf.min.js']])await fs.copyFile(path.join(root,'node_modules',source),path.join(out,'vendor',target));
const names=['智能汽车','新材料','电子信息','人工智能与机器人','航空航天','高端装备'];
const dirs=['整车及三电系统','电子信息材料','第三代半导体','机器人核心部件','低空飞行器','数控机床'];
const colors=['#2464cf','#ac7134','#407da7','#7569ac','#388793','#548373'];
const supplies=['已供','批而未供','未供','未登记'];
const clusters=names.map((name,i)=>({name,goal:String((6-i)*100),unit:'模拟产值',directions:[dirs[i]],entities:'模拟企业 '+(i+1),platform:'模拟创新平台 '+(i+1)}));
const zones=names.map((industry,i)=>({id:'z'+(i+1),name:'模拟产业区块 '+(i+1),area:'10',unit:'平方公里（模拟）',color:colors[i],industries:[industry],summary:'仅用于演示产业区块浏览与宗地选址，不代表正式规划。',parks:[['模拟产业园 '+(i+1),[]]],projects:[]}));
const statuses={supply:supplies,built:['已形成','尚未形成','未登记'],approval:['未报','在批','已批','未登记'],forest:['不涉及','在办','已批','未登记'],sea:['不涉及','在办','已批','未登记'],availability:['可立即使用','仍在报批审核','未登记'],scattered:['是','否','未登记'],water:['已到达','未到达','未登记']};
const records=[];
for(let group=0;group<6;group++)for(let i=0;i<24;i++){
  const n=group*24+i+1;
  const x=121.17+(group%3)*.048+(i%6)*.0045;
  const y=30.29+Math.floor(group/3)*.035+Math.floor(i/6)*.006;
  const w=.0025+(i%3)*.0004,h=.003+(i%2)*.0005;
  const geometry={type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]};
  const actualArea=area({type:'Feature',geometry,properties:{}});
  const supply=i%4===0?'未供':'已供',built=i%5===0?'尚未形成':'已形成',approval=i%7===0?'在批':'已批';
  const p={id:'DEMO-'+n,revision:0,geometry,bounds:[x,y,x+w,y+h],center:[x+w/2,y+h/2],raw:{说明:'全部为模拟生成'},name:'模拟产业地块 '+String(n).padStart(3,'0'),owner:'模拟权利人 '+n,use:'工业用地',actualUse:'工业用地',actualArea,area:actualArea*3/2000,supply,suppliedArea:actualArea,registeredArea:actualArea,ledger:'DEMO-'+n,unitCode:'模拟单元-'+n,completion:null,floorRatio:'1.5 / 1.2（模拟）',zone:zones[group].id,park:zones[group].parks[0][0],industry:names[group],direction:dirs[group],built,approval,forest:'不涉及',sea:'不涉及',scattered:'否',water:i%4?'已到达':'未到达',power:i%3?'已到达':'未到达',road:'已到达',drainage:'已到达',gas:'未登记',heating:'未登记',telecom:'已到达',phase:'模拟阶段',enterprises:[{name:'模拟经营企业 '+n,code:'DEMO-'+n,industry:names[group],area:Number((actualArea*3/2000).toFixed(2)),operating:'是'}]};
  p.availability=approval==='在批'?'仍在报批审核':supply==='已供'&&built==='已形成'?'可立即使用':'未登记';
  p.provenance=Object.fromEntries(Object.keys(p).map(key=>[key,'模拟生成']));records.push(p);
}
const data={meta:{source:'程序生成的全模拟数据',demo:true,count:records.length,extent:bbox(featureCollection(records.map(p=>({type:'Feature',geometry:p.geometry,properties:{}}))))},records};
await fs.writeFile(path.join(out,'demo-data.json'),JSON.stringify(data));
const catalog={clusters,zones,supplies,statuses,supplyColors:{'已供':'#3675d1','批而未供':'#ac7134','未供':'#7569ac','未登记':'#6f7f96'}};
await fs.writeFile(path.join(out,'data.js'),Object.entries(catalog).map(([key,value])=>'const '+key+'='+JSON.stringify(value)+';').join('\n')+'\nlet initialParcels=[];let datasetMeta={};');
let html=await fs.readFile(path.join(root,'public/index.html'),'utf8');
html=html.replace('<title>','<title>公开演示 · ').replace('<script src="bootstrap.js"></script>','<script>window.PUBLIC_DEMO=true;</script>\n  <script src="bootstrap.js"></script>').replace('正在加载工业用地宗地数据…','正在加载模拟宗地…').replace('QIANWAN INDUSTRIAL SPACE','公开演示 · 全模拟数据');
await fs.writeFile(path.join(out,'index.html'),html);
await fs.writeFile(path.join(out,'.nojekyll'),'');
console.log('公开演示已构建：144 宗模拟矩形，未读取任何真实宗地数据。');

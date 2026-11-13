import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as shapefile from 'shapefile';
import {bbox, area, pointOnFeature} from '@turf/turf';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.access(path.join(root,'public/data.js')).catch(()=>fs.copyFile(path.join(root,'public/catalog-example.js'),path.join(root,'public/data.js')));
const source=path.resolve(root,'../data/前湾工业用地数据库');
const projection=await fs.readFile(source+'.prj','utf8');
if (!projection.includes('GCS_China_Geodetic_Coordinate_System_2000')) throw new Error('数据坐标系发生变化，请确认转换方式');
const collection=await shapefile.read(source+'.shp',source+'.dbf',{encoding:'utf-8'});
const positions=collection.features.map((f,index)=>({index,center:pointOnFeature(f).geometry.coordinates})).sort((a,b)=>b.center[1]-a.center[1]);
const simulatedGroups=new Map();
const half=Math.ceil(positions.length/2);
for(let row=0;row<2;row++) {
  const strip=positions.slice(row*half,(row+1)*half).sort((a,b)=>a.center[0]-b.center[0]);
  strip.forEach((p,i)=>simulatedGroups.set(p.index,row*3+Math.min(2,Math.floor(i*3/strip.length))));
}
const directions=['整车及三电系统','电子信息材料','第三代半导体','机器人核心部件','低空飞行器','数控机床'];
const industries=['智能汽车','新材料','电子信息','人工智能与机器人','航空航天','高端装备'];
const parks=['新能源汽车关键零部件产业园','前沿新材料创新园','数字经济产业园一期','海创战新园一期','空天产业园','高端装备制造产业平台'];
function clean(value) {
  if (value instanceof Date) return value.getFullYear()<1900?null:value.toISOString().slice(0,10);
  return value;
}
const records=collection.features.map((feature,index)=>{
  if (!feature.geometry||!['Polygon','MultiPolygon'].includes(feature.geometry.type)) throw new Error('无效宗地几何 '+index);
  const raw=Object.fromEntries(Object.entries(feature.properties).map(([k,v])=>[k,clean(v)]));
  const bounds=bbox(feature);
  if(bounds[0]<120||bounds[2]>123||bounds[1]<29||bounds[3]>31) throw new Error('宗地坐标超出预期范围');
  const center=pointOnFeature(feature).geometry.coordinates;
  // Simulated assignments are deterministic and explicitly tagged. They are not planning boundaries.
  const group=simulatedGroups.get(index);
  const provenance={};
  const record={id:'QW-'+raw.OBJECTID,revision:0,geometry:feature.geometry,bounds,center,raw};
  function put(key,value,kind) {record[key]=value;provenance[key]=kind;}
  function from(key,field,fallback) {
    const value=raw[field];
    const exists=value!==null&&value!==undefined&&value!=='';
    put(key,exists?value:fallback,exists?'原始台账':'模拟补充');
  }
  from('name','TDZL','模拟地块 '+raw.OBJECTID);
  from('owner','TDQLR','模拟权利人 '+raw.OBJECTID);
  from('use','PZYT','工业用地');
  from('actualUse','SJYT',record.use);
  const actualArea=raw.SJYDMJ>0?raw.SJYDMJ:area(feature);
  put('actualArea',actualArea,raw.SJYDMJ>0?'原始台账':'几何计算');
  put('area',actualArea*3/2000,provenance.actualArea);
  put('supply',raw.SFGD==='是'?'已供':raw.SFGD==='否'?'未供':'未登记','原始台账');
  for(const [key,field] of Object.entries({suppliedArea:'GYMJ',registeredArea:'DJMJ',ledger:'DKSYH',unitCode:'BDCDYDM',completion:'SJJGSJ'})) {
    put(key,raw[field],raw[field]?'原始台账':'未登记');
  }
  put('floorRatio',[raw.GHRJL||'未登记',raw.SJRJL||'未登记'].join(' / '),'原始台账');
  const mocks={
    zone:'z'+(group+1),park:parks[group],industry:industries[group],direction:directions[group],
    built:index%4?'已形成':'尚未形成',approval:index%9===0?'在批':'已批',
    forest:index%17===0?'在办':'不涉及',sea:index%19===0?'在办':'不涉及',
    scattered:record.area<15?'是':'否',water:index%5?'已到达':'未到达',power:index%6?'已到达':'未到达',
    road:'已到达',drainage:index%3?'已到达':'未到达',gas:'未登记',heating:'未登记',telecom:'已到达',
    phase:index%9===0?'已组卷':'',enterprises:[{name:'模拟经营企业 '+raw.OBJECTID,code:'模拟编号-'+raw.OBJECTID,industry:industries[group],area:Number(record.area.toFixed(2)),operating:'是'}]
  };
  for(const [key,value] of Object.entries(mocks)) put(key,value,'模拟补充');
  const pending=record.approval==='在批'||record.forest==='在办'||record.sea==='在办';
  put('availability',pending?'仍在报批审核':record.supply==='已供'&&record.built==='已形成'?'可立即使用':'未登记','模拟补充');
  record.provenance=provenance;
  return record;
});
if(new Set(records.map(p=>p.id)).size!==records.length) throw new Error('宗地标识重复');
const dataset={
  meta:{source:'前湾工业用地数据库.shp / .dbf',count:records.length,crs:'CGCS2000 经纬度（EPSG:4490）',displayCrs:'按经纬度加载至 MapLibre Web Mercator，未做 GCJ-02 偏移',extent:bbox(collection),generatedAt:new Date().toISOString()},
  records
};
await fs.mkdir(path.join(root,'server/generated'),{recursive:true});
await fs.writeFile(path.join(root,'server/generated/parcels.json'),JSON.stringify(dataset));
await fs.mkdir(path.join(root,'public/vendor'),{recursive:true});
for(const [file,target] of [
  ['maplibre-gl/dist/maplibre-gl.js','maplibre-gl.js'],
  ['maplibre-gl/dist/maplibre-gl.css','maplibre-gl.css'],
  ['@turf/turf/turf.min.js','turf.min.js']
]) await fs.copyFile(path.join(root,'node_modules',file),path.join(root,'public/vendor',target));
console.log(JSON.stringify({count:records.length,extent:dataset.meta.extent,polygons:records.filter(p=>p.geometry.type==='Polygon').length,multiPolygons:records.filter(p=>p.geometry.type==='MultiPolygon').length},null,2));

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import * as shapefile from 'shapefile';

test('全部宗地边界及原始属性按台账导入，模拟归属明确可用',async()=>{
  const original=await shapefile.read('../data/前湾工业用地数据库.shp','../data/前湾工业用地数据库.dbf',{encoding:'utf-8'});
  const dataset=JSON.parse(await fs.readFile('server/generated/parcels.json','utf8'));
  assert.equal(dataset.records.length,original.features.length);
  assert.equal(new Set(dataset.records.map(p=>p.id)).size,original.features.length);
  assert.equal(new Set(dataset.records.map(p=>p.zone)).size,6);
  for(let i=0;i<dataset.records.length;i++) {
    const p=dataset.records[i],f=original.features[i];
    assert.deepEqual(p.geometry,f.geometry);
    assert.equal(p.owner,f.properties.TDQLR);
    assert.equal(p.ledger,f.properties.DKSYH);
    assert.equal(p.use,f.properties.PZYT);
    if(f.properties.SJYDMJ>0) assert.equal(p.actualArea,f.properties.SJYDMJ);
    assert.equal(p.supply,f.properties.SFGD==='是'?'已供':'未供');
    assert.equal(p.provenance.zone,'模拟补充');
    assert.equal(p.provenance.supply,'原始台账');
  }
});

test('维护持久化、版本冲突与几何保护',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qianwan-api-test-'));
  let child;
  const base='http://127.0.0.1:43881';
  async function start() {
    child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:'43881',STATE_DIR:dir},stdio:'pipe'});
    await new Promise((resolve,reject)=>{
      child.stdout.once('data',resolve);
      child.once('error',reject);
      child.once('exit',code=>reject(new Error('服务退出 '+code)));
    });
  }
  async function stop() {
    const done=new Promise(resolve=>child.once('exit',resolve));
    child.kill();
    await done;
  }
  async function update(id,revision,changes) {
    return fetch(base+'/api/parcels/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,changes})});
  }
  try {
    await start();
    const {records}=await (await fetch(base+'/api/parcels')).json();
    const first=records[0];
    const response=await update(first.id,0,{name:'持久化验证地块'});
    assert.equal(response.status,200);
    const updated=await response.json();
    assert.equal(updated.revision,1);
    assert.equal(updated.provenance.name,'人工维护');
    assert.deepEqual(updated.geometry,first.geometry);
    assert.equal((await update(first.id,0,{name:'冲突修改'})).status,409);
    assert.equal((await update(first.id,1,{geometry:{type:'Point',coordinates:[0,0]}})).status,422);
    assert.equal((await update(first.id,1,{area:-1})).status,422);
    await stop();
    await start();
    const reload=await (await fetch(base+'/api/parcels')).json();
    assert.equal(reload.records[0].name,'持久化验证地块');
    assert.equal(reload.records[0].raw.TDZL,first.raw.TDZL);
  } finally {
    if(child&&child.exitCode===null) await stop();
    await fs.rm(dir,{recursive:true,force:true});
  }
});

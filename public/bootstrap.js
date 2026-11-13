async function startSystem() {
  try {
    const response=await fetch(window.PUBLIC_DEMO?'./demo-data.json':'/api/parcels');
    if(!response.ok) throw new Error('宗地接口加载失败');
    const dataset=await response.json();
    initialParcels=dataset.records;
    datasetMeta=dataset.meta;
    const script=document.createElement('script');
    script.src='app.js';
    document.body.append(script);
  } catch(error) {
    const app=document.getElementById('app');
    app.innerHTML='<div class="loading-screen"><p></p><button class="btn">重新加载</button></div>';
    app.querySelector('p').textContent=error.message;
    app.querySelector('button').onclick=()=>location.reload();
  }
}
startSystem();

function sourceNotice(p) {
  if(window.PUBLIC_DEMO)return '<div class="source-notice">公开演示：宗地边界、面积、企业、区块归属与配套均为模拟生成，不代表真实地块或规划成果。</div>';
  const labels={name:'土地坐落',owner:'权利人',area:'实际面积',actualArea:'实际面积（㎡）',zone:'所属区块',park:'园区',industry:'产业集群',direction:'二级方向',supply:'供应',built:'建设界面',approval:'农转用',forest:'用林',sea:'用海',availability:'可用性',enterprises:'地上企业',water:'用水',power:'用电'};
  const fields=Object.entries(p.provenance).map(([key,source])=>'<tr><td>'+esc(labels[key]||key)+'</td><td>'+esc(source)+'</td></tr>').join('');
  const raw=Object.entries(p.raw).map(([key,value])=>'<tr><td>'+esc(key)+'</td><td>'+esc(missing(value))+'</td></tr>').join('');
  return '<div class="source-notice">边界与台账属性来自工业用地数据库。缺失的区块、产业、园区、审批、企业和配套字段使用模拟补充。</div>'+
    '<details class="source-disclosure"><summary>字段来源</summary><table class="source-table"><tbody>'+fields+'</tbody></table></details>'+
    '<details class="source-disclosure"><summary>原始台账字段</summary><table class="source-table"><tbody>'+raw+'</tbody></table></details>';
}

async function persistParcel(values,enterprises) {
  if(window.PUBLIC_DEMO){toast('公开演示版不提供数据维护');return;}
  const current=parcels.find(p=>p.id===state.editor);
  const proposed={...values,area:Number(values.area),enterprises};
  const changes=Object.fromEntries(Object.entries(proposed).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(current[key])));
  if(!Object.keys(changes).length){toast('没有需要保存的修改');return;}
  const button=document.querySelector('#edit-form button[type=submit]');
  button.disabled=true;button.textContent='正在保存…';
  try {
    const response=await fetch('/api/parcels/'+encodeURIComponent(current.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision,changes})});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error);
    parcels=parcels.map(p=>p.id===result.id?result:p);
    render();toast('宗地已保存到本地服务');
  } catch(error) {
    toast(error.message);
    button.disabled=false;button.textContent='保存宗地';
  }
}

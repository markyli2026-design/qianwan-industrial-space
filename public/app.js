const pages = {
  planning:['产业规划与分布','十五五产业体系与重点产业区块'],
  land:['土地家底与资规状态','按区块、园区或产业查看宗地台账与资规状态'],
  selection:['选址与周边配套','组合条件筛选宗地，查看配套设施与到达情况'],
  admin:['数据管理','维护宗地属性、企业关系、资规状态与配套到达情况']
};
const state = {
  page:'planning',planType:'zone',planId:'z1',park:'',selected:initialParcels[0]?.id||'',editor:initialParcels[0]?.id||'',
  scope:{zone:'',park:'',industry:'',direction:''},filters:{},statTab:'supply',stat:'',
  detailTab:'base',facilityType:'',layers:{parks:false,spatial:false,history:false,facilities:true},
  basemap:'light',layerMenu:false,extraFilters:false,planningMore:'',zoom:1,pan:[0,0],
  panels:{left:innerWidth>880,right:innerWidth>880,results:true},panelScroll:{left:0,right:0,results:0},
  filterDraft:null
};

let parcels=structuredClone(initialParcels);
let lastPage;
let toastTimer;
let mapObserver;

function esc(value) {
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

const zoneName=id=>zones.find(z=>z.id===id)?.name||'未登记';
const format=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
const missing=v=>v===undefined||v===null||v===''?'未登记':v;
const dot=color=>'<i class="dot" style="--zone:'+color+'"></i>';
const options=(values,value)=>values.map(entry=>{
  const [id,name]=Array.isArray(entry)?entry:[entry,entry];
  return '<option value="'+esc(id)+'" '+(id===value?'selected':'')+'>'+esc(name)+'</option>';
}).join('');
const field=(label,body)=>'<label class="field">'+label+body+'</label>';
const select=(label,name,values,value='',any='全部')=>field(label,'<select name="'+name+'">'+options(any===null?values:[['',any],...values],value)+'</select>');
const input=(label,name,value='',type='text',attrs='')=>field(label,'<input type="'+type+'" name="'+name+'" value="'+esc(value)+'" '+attrs+'>');
const detail=rows=>'<dl class="data-list">'+rows.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(missing(v))+'</dd>').join('')+'</dl>';
const section=(body,cls='')=>'<section class="pane-section '+cls+'">'+body+'</section>';
const title=(s,note='')=>'<h2 class="pane-title">'+s+'</h2>'+(note?'<p class="pane-kicker">'+note+'</p>':'');
const action=(name,value,label,cls='btn')=>'<button type="button" class="'+cls+'" data-action="'+name+'" data-value="'+esc(value)+'">'+label+'</button>';
const zoneOptions=zones.map(z=>[z.id,z.name]);
const parkOptions=[...new Set([...zones.flatMap(z=>z.parks.map(p=>p[0])),...initialParcels.map(p=>p.park)])];
const industryOptions=clusters.map(c=>c.name);
const directionOptions=industry=>clusters.filter(c=>!industry||c.name===industry).flatMap(c=>c.directions);
const planningScope=()=>state.planType==='cluster'?{industry:state.planId,direction:state.planDirection||''}:{zone:state.planId,park:state.planType==='park'?state.park:''};

function matches(p, filters) {
  for (const [key,value] of Object.entries(filters)) {
    if (!value) continue;
    if(key==='query'){if(![p.name,p.owner,p.ledger,p.id].some(v=>String(v||'').includes(value.trim())))return false;continue;}
    if (key==='min') { if (p.area==null||p.area<Number(value)) return false; }
    else if (key==='max') { if (p.area==null||p.area>Number(value)) return false; }
    else if (key==='connections') { if (p.power!=='已到达'||p.water!=='已到达') return false; }
    else if (key==='use'&&value==='工业用地') { if (!p.use.startsWith('工业用地')) return false; }
    else if (p[key]!==value) return false;
  }
  return true;
}

const approvalBuckets = [
  ['农转用已批',p=>p.approval==='已批'],['农转用在批',p=>p.approval==='在批'],
  ['用林在办或已批',p=>['在办','已批'].includes(p.forest)],['用海在办或已批',p=>['在办','已批'].includes(p.sea)],
  ['未登记',p=>[p.approval,p.forest,p.sea].includes('未登记')]
];

function buckets() {
  return state.statTab==='approval'?approvalBuckets:statuses[state.statTab].map(s=>[s,p=>p[state.statTab]===s]);
}

function visibleParcels() {
  if (state.page==='selection') return parcels.filter(p=>matches(p,state.filters));
  if (state.page!=='land') return parcels;
  const bucket=buckets().find(([label])=>label===state.stat);
  return parcels.filter(p=>matches(p,state.scope)&&(!bucket||bucket[1](p)));
}

function renderHeader() {
  const navigation=document.getElementById('navigation');
  navigation.innerHTML=Object.keys(pages).slice(0,3).map((key,i)=>'<button type="button" class="nav-button '+(key===state.page?'active':'')+'" data-action="page" data-value="'+key+'" '+(key===state.page?'aria-current="page"':'')+'><span class="nav-num">0'+(i+1)+'</span>'+['产业规划','土地家底','企业选址'][i]+'</button>').join('');
  const admin=document.getElementById('admin-link');
  admin.dataset.action='page';
  admin.dataset.value=state.page==='admin'?'planning':'admin';
  admin.innerHTML=state.page==='admin'?'← 返回展示':'<span aria-hidden="true">⚙</span> 数据管理';
  admin.hidden=!!window.PUBLIC_DEMO;
}

function adminHeader() {
  const [heading,sub]=pages.admin;
  return '<div class="page-head"><div><h1>'+heading+'</h1><p class="head-note">'+sub+'</p></div>'+action('page','land','查看展示结果 →')+'</div>';
}

function planLeft() {
  if(window.PUBLIC_DEMO)return section(title('模拟产业体系','以下指标仅用于功能演示'))+'<div class="cluster-list">'+clusters.map(c=>action('cluster',c.name,esc(c.name)+'<span class="metric">'+c.goal+' 亿（模拟）</span>','cluster-btn '+(state.planType==='cluster'&&state.planId===c.name?'active':''))).join('')+'</div>';
  const groups=[[0,1,'两千亿级'],[1,2,'千亿级'],[2,5,'五百亿级'],[5,9,'百亿级'],[9,10,'未来产业']];
  const list=groups.map(([a,b,label])=>'<div class="group-label">'+label+'</div>'+clusters.slice(a,b).map(c=>
    action('cluster',c.name,esc(c.name)+'<span class="metric">'+(c.goal==='X'?'X':c.goal+' 亿')+'</span><span class="arr">›</span>','cluster-btn '+(state.planType==='cluster'&&state.planId===c.name?'active':''))
  ).join('')).join('');
  const extras=typeof planningExtras==='undefined'?[]:planningExtras;
  return section(title('制造业体系','对标浙江省「415X」制造业集群')+'<div class="intro-num">1134X</div><p class="pane-kicker">2030 年集群目标 · 亿元</p>')+
    '<div class="cluster-list">'+list+'</div>'+section(extras.map(([key,label,copy])=>action('planning-more',key,label+'<span>'+ (state.planningMore===key?'⌄':'›')+'</span>','plain-toggle')+(state.planningMore===key?'<p class="body-small">'+copy+'</p>':'')).join(''));
}

function planRight() {
  if (state.planType==='cluster') {
    const c=clusters.find(c=>c.name===state.planId);
    return section('<div class="eyebrow">1134X 制造业体系</div><h2>'+esc(c.name)+'</h2>'+(c.goal==='X'?'<div class="big-number">X</div>':'<div class="big-number">'+c.goal+'<small>亿元</small></div><p class="detail-sub">2030 年'+c.unit+'目标</p>'),'detail-lead')+
      section(title('二级产业方向','选择方向后可按该条件查看土地')+'<div class="tags">'+c.directions.map(d=>action('direction',d,esc(d),'tag '+(state.planDirection===d?'active':''))).join('')+'</div>')+
      section(title('代表企业与承载平台')+'<p class="detail-copy">'+(c.entities?'<strong>企业</strong>　'+esc(c.entities)+'<br>':'')+'<strong>载体</strong>　'+esc(c.platform)+'</p>')+
      '<div class="sticky-actions">'+action('scope-land','', '查看关联宗地 <span>→</span>','btn primary full')+'</div>';
  }
  const z=zones.find(z=>z.id===state.planId);
  if (state.planType==='park') {
    return section('<div class="eyebrow">特色园区与平台</div><h2>'+esc(state.park)+'</h2><p class="detail-sub">'+esc(z.name)+'</p>','detail-lead')+
      section(title('所属区块')+'<p class="detail-copy">'+esc(z.summary)+'</p>')+
      '<div class="sticky-actions">'+action('scope-land','','查看园区宗地 <span>→</span>','btn primary full')+action('zone',z.id,'返回区块')+'</div>';
  }
  const projects=z.projects.map(([name,info,desc])=>'<details class="project"><summary>'+esc(name)+'</summary><small>'+esc(info)+'</small><p>'+esc(desc)+'</p></details>').join('');
  return section('<div class="eyebrow">十五五重点区块 · 宗地归属为模拟</div><h2>'+esc(z.name)+'</h2><p class="detail-sub">规划面积</p><div class="big-number">'+z.area+'<small>'+z.unit+'</small></div>','detail-lead')+
    section(title('主导产业')+'<p class="detail-copy">'+esc(z.summary)+'</p><div class="tags">'+z.industries.map(s=>action('cluster',s,esc(s),'tag')).join('')+'</div>')+
    (projects?section(title('重点项目')+projects):'')+
    (z.parks.length?section(title('园区与平台')+z.parks.map(([name])=>'<button class="zone-btn" data-action="park" data-zone="'+z.id+'" data-value="'+esc(name)+'">'+dot(z.color)+esc(name)+'</button>').join('')):'')+
    '<div class="sticky-actions">'+action('scope-land','','查看区块宗地 <span>→</span>','btn primary full')+'</div>';
}

function scopeFields(values) {
  return input('搜索坐落、权利人或索引号','query',values.query||'')+select('十五五区块','zone',zoneOptions,values.zone)+
    select('产业园区','park',parkOptions,values.park)+
    select('产业集群','industry',industryOptions,values.industry)+
    select('二级方向','direction',directionOptions(values.industry),values.direction);
}

function landLeft() {
  const source=parcels.filter(p=>matches(p,state.scope));
  const tabs=[['supply','供应'],['approval','审批'],['built','建设界面']];
  return section(title('范围与统计')+
    '<div class="status-grid"><div><div class="stat-num">'+source.length+'<small>宗</small></div><div class="stat-label">当前范围宗地</div></div><div><div class="stat-num">'+format(source.reduce((n,p)=>n+(p.area||0),0))+'<small>亩</small></div><div class="stat-label">实际用地面积</div></div></div>'+
    '<div class="stats-tabs">'+tabs.map(([key,label])=>action('stats-tab',key,label,'tab '+(key===state.statTab?'active':''))).join('')+'</div>'+
    buckets().map(([label,test])=>action('stats',label,(state.statTab==='supply'?dot(supplyColors[label]):'')+'<span style="flex:1">'+label+'</span><b>'+source.filter(test).length+' 宗</b>','stat-row '+(state.stat===label?'active':''))).join('')+
    (state.statTab==='approval'?'<p class="pane-kicker">审批分档可重叠</p>':''))+
    section(title('查看范围')+'<form id="scope-form" class="filter-form" style="margin-top:10px">'+scopeFields(state.scope)+action('clear-scope','','清空范围','small-btn')+'</form>')+
    '<div class="sticky-actions">'+action('open-selection','','按当前范围筛地 →','btn primary full')+'</div>';
}

function selectionLeft() {
  const f=state.filterDraft||state.filters;
  return section('<div class="filter-intro"><p class="pane-kicker">当前匹配 <strong>'+visibleParcels().length+'</strong> 宗</p>'+action('example','','载入选址示例','small-btn')+'</div>'+
    '<form id="filter-form" class="filter-form" style="margin-top:12px">'+scopeFields(f)+
    '<div class="two-col">'+input('最小面积（亩）','min',f.min,'number','min="0" step="any"')+input('最大面积（亩）','max',f.max,'number','min="0" step="any"')+'</div>'+
    select('批准用途','use',['工业用地','工业用地（M1）','工业用地（M2）'],f.use)+
    select('供应状态','supply',supplies,f.supply)+select('可用性','availability',statuses.availability,f.availability)+
    '<details class="more-filters" '+(state.extraFilters?'open':'')+'><summary>审批、建设与形态</summary><div class="stack">'+
    select('农转用','approval',statuses.approval,f.approval)+select('用林','forest',statuses.forest,f.forest)+select('用海','sea',statuses.sea,f.sea)+
    select('建设界面','built',statuses.built,f.built)+select('零星用地','scattered',statuses.scattered,f.scattered)+'</div></details>'+
    '<label class="check-row"><input type="checkbox" name="connections" value="yes" '+(f.connections?'checked':'')+'>用电和用水均已到达</label>'+
    '<div class="two-col"><button class="btn primary" type="submit">应用筛选</button>'+action('clear-filters','','重置')+'</div></form>');
}

function parcelBase(p) {
  return detail([['所属区块',zoneName(p.zone)],['所在园区',p.park],['产业方向',[p.industry,p.direction].filter(Boolean).join(' / ')],['批准用途',p.use],['实际用途',p.actualUse],['权利人',p.owner],['实际面积（㎡）',p.actualArea?format(p.actualArea):'约 '+format(p.area*2000/3)],['供应面积（㎡）',p.suppliedArea&&format(p.suppliedArea)],['登记面积（㎡）',p.registeredArea&&format(p.registeredArea)],['地块索引号',p.ledger],['不动产单元代码',p.unitCode],['容积率（规 / 实）',p.floorRatio],['实际竣工',p.completion]]);
}

function parcelStatus(p) {
  return detail([['供应',p.supply],['农转用',p.approval],['办理环节',p.phase],['用林',p.forest],['用海',p.sea],['建设界面',p.built],['零星用地',p.scattered],['可用性',p.availability],['用电到达',p.power],['用水到达',p.water],['道路到达',p.road],['排水到达',p.drainage],['燃气到达',p.gas],['热力到达',p.heating],['通信到达',p.telecom]]);
}

function parcelEnterprises(p) {
  if (!p.enterprises?.length) return '<p class="body-small">'+(p.enterprises?'暂无关联企业':'地上企业未登记')+'</p>';
  return p.enterprises.map(e=>'<div class="project"><strong>'+esc(e.name)+'</strong>'+detail([['信用代码',e.code],['产业方向',e.industry],['用地或租赁面积',e.area?e.area+' 亩':''],['在此经营',e.operating]])+'</div>').join('');
}

function parcelFacilities(p) {
  const nearbyItems=nearby(p);
  const names=[...new Set(nearbyItems.map(f=>f.type))];
  const rows=names.map(type=>{
    const items=nearbyItems.filter(f=>f.type===type);
    const nearest=items[0];
    const dist=nearest.distance>=1000?(nearest.distance/1000).toFixed(2)+' km':Math.round(nearest.distance)+' m';
    return action('facility',type,'<span>'+dot(nearest.color)+' '+type+(type==='道路'?'':' · '+items.length+' 处')+'<small>'+esc(nearest.name)+'</small></span><b>'+dist+'</b>','facility-row '+(state.facilityType===type?'active':''));
  }).join('');
  return section(title('周边设施（模拟）','按模拟设施坐标计算 · 距宗地边界 2.6 km')+(rows||'<p class="detail-copy">演示范围内暂无配套数据</p>'))+
    section(title('配套到达情况')+'<div style="margin-top:10px">'+detail([['用电',p.power],['用水',p.water],['道路',p.road]])+'</div>');
}

function parcelRight() {
  const p=visibleParcels().find(p=>p.id===state.selected);
  if (!p) return '<div class="empty">在地图或清单中选择宗地</div>';
  const tabs=[['base','基本属性'],['status','资规状态'],['companies','地上企业']];
  if (state.page==='selection') tabs.unshift(['facilities','周边']);
  const menu='<div class="detail-tabs">'+tabs.map(([key,label])=>action('detail-tab',key,label,'tab '+(key===state.detailTab?'active':''))).join('')+'</div>';
  const panel={base:parcelBase,status:parcelStatus,companies:parcelEnterprises}[state.detailTab];
  return section('<div class="eyebrow">宗地详情 · '+p.id+'</div><h2>'+esc(p.name)+'</h2><p class="detail-sub">'+esc(zoneName(p.zone))+' · '+esc(missing(p.industry))+'</p><div class="big-number">'+format(p.area)+'<small>亩</small></div><div class="tags"><span class="tag">'+esc(p.supply)+'</span><span class="tag">'+esc(p.availability)+'</span></div>','detail-lead')+
    section(menu)+(panel?section(panel(p)):parcelFacilities(p))+section(sourceNotice(p))+
    (state.page==='land'?'<div class="sticky-actions">'+action('parcel-selection',p.id,'查看宗地周边 <span>→</span>','btn primary full')+'</div>':'');
}

function resultTable(data) {
  const cols=['宗地坐落','实际面积','供应状态','可用性'];
  const rows=data.map(p=>{
    const cells=[format(p.area)+' 亩',p.supply,p.availability];
    return '<tr class="'+(p.id===state.editor?'selected':'')+'"><td>'+action('edit',p.id,esc(p.name),'table-link')+'</td>'+cells.map(s=>'<td>'+esc(missing(s))+'</td>').join('')+'</tr>';
  }).join('');
  return '<div class="table-scroll"><table><thead><tr>'+cols.map(s=>'<th scope="col">'+s+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table>'+(rows?'':'<p class="empty">没有符合条件的宗地，请调整筛选条件。</p>')+'</div>';
}

function panelToggle(key,label) {
  const open=state.panels[key];
  const icon=open?'−':key==='results'?'⌃':key==='left'?'›':'‹';
  const name=(open?'收起':'展开')+label;
  return '<button type="button" class="panel-toggle '+(open?'':'panel-reopen')+'" data-action="toggle-panel" data-value="'+key+'" aria-expanded="'+open+'" aria-controls="panel-'+key+'" aria-label="'+name+'" title="'+name+'">'+(open?'<span aria-hidden="true">'+icon+'</span>':label+' <span aria-hidden="true">'+icon+'</span>')+'</button>';
}

function sidePanel(key,label,content) {
  return '<div class="floating-panel '+key+'-float">'+(state.panels[key]?'':panelToggle(key,label))+
    '<aside id="panel-'+key+'" class="pane '+key+'-pane" '+(state.panels[key]?'':'hidden')+' aria-label="'+label+'"><div class="panel-bar"><span>'+label+'</span>'+panelToggle(key,label)+'</div>'+content+'</aside></div>';
}

function resultCards(data) {
  const cards=data.map(p=>{
    const active=p.id===state.selected;
    return '<li><button type="button" class="parcel-card '+(active?'selected':'')+'" data-action="parcel-list" data-value="'+p.id+'" aria-pressed="'+active+'">'+
      '<span class="card-main"><strong>'+esc(p.name)+'</strong><span class="card-area">'+format(p.area)+' <small>亩</small></span></span>'+
      '<span class="card-meta">'+esc(missing(p.park))+'</span>'+
      '<span class="card-tags"><span>'+dot(supplyColors[p.supply]||supplyColors['未登记'])+' '+esc(p.supply)+'</span><span>'+esc(missing(p.use))+'</span><span>建设界面 '+esc(p.built)+'</span></span>'+
      '<span class="card-meta">权利人 '+esc(missing(p.owner))+' · 地上企业 '+esc(p.enterprises?.length??'未登记')+'</span></button></li>';
  }).join('');
  const label='宗地清单';
  return '<div class="floating-panel results-float">'+(state.panels.results?'':panelToggle('results',label+' · '+data.length+' 宗'))+
    '<section id="panel-results" class="pane result-wrap" aria-label="'+label+'" '+(state.panels.results?'':'hidden')+'>'+
    '<div class="panel-bar"><h2>'+label+'</h2><span class="result-count">'+data.length+' 宗'+(state.stat&&state.page==='land'?' · '+esc(state.stat):'')+'</span>'+panelToggle('results',label)+'</div>'+
    '<div class="result-scroll" tabindex="0" aria-label="滚动查看宗地卡片">'+(cards?'<ul class="result-cards">'+cards+'</ul>':'<p class="empty">没有符合条件的宗地，请调整筛选条件。</p>')+'</div></section></div>';
}

function adminView() {
  const p=parcels.find(p=>p.id===state.editor)||parcels[0];
  const choices=[['supply','供应状态'],['built','建设界面'],['approval','农转用'],['forest','用林'],['sea','用海'],['availability','可用性（确认结果）'],['scattered','零星用地']];
  const connections=[['power','用电'],['water','用水'],['road','道路'],['drainage','排水'],['gas','燃气'],['heating','热力'],['telecom','通信']];
  const enterpriseRows=(p.enterprises||[]).map(e=>[e.name,e.code,e.industry,e.area,e.operating].join('｜')).join('\n');
  return '<div class="admin-work"><section class="pane admin-table"><div class="edit-title">'+title('宗地台账',parcels.length+' 宗工业用地 · 真实边界')+'</div>'+resultTable(parcels)+'</section>'+
    '<section class="pane"><div class="edit-title">'+title('编辑宗地 · '+p.id,'保存到本地服务，所有打开此系统的窗口均可读取')+'</div>'+
    '<form id="edit-form" class="edit-form"><h3>基本信息</h3><div class="two-col">'+input('土地坐落','name',p.name,'text','required')+input('实际用地面积（亩）','area',p.area,'number','required min="0.01" step="any"')+
    select('所属区块','zone',zoneOptions,p.zone,'未登记')+select('所在园区','park',parkOptions,p.park,'未登记')+
    select('产业集群','industry',industryOptions,p.industry,'未登记')+select('二级方向','direction',directionOptions(p.industry),p.direction,'未登记')+
    input('批准用途','use',p.use,'text','required')+input('土地权利人','owner',p.owner)+'</div>'+
    '<h3>资规状态</h3><div class="two-col">'+choices.map(([key,label])=>select(label,key,statuses[key],p[key],null)).join('')+input('农转用办理环节','phase',p.phase)+'</div>'+
    '<h3>配套到达</h3><div class="two-col">'+connections.map(([key,label])=>select(label,key,statuses.water,p[key],null)).join('')+'</div>'+
    '<h3>地上企业</h3>'+field('一行一条：企业名称｜统一社会信用代码｜行业｜面积（亩）｜在此经营','<textarea name="enterprises" placeholder="未登记">'+esc(enterpriseRows)+'</textarea>')+
    '<button type="submit" class="btn primary">保存宗地</button></form></section></div>';
}

function footer() {
  if(window.PUBLIC_DEMO)return '<footer class="footer"><span>公开演示 · 全模拟宗地</span><span>仅供功能体验</span></footer>';
  return '<footer class="footer"><span><i class="live-dot"></i> 工业用地数据库 · CGCS2000 经纬度</span><span>'+(state.page==='planning'?'规划口径 · 十五五纲要草案 r14':'工业用地台账 · 缺失字段模拟补充')+'</span></footer>';
}

function render() {
  const savedMap=document.querySelector('#maplibre-map');savedMap?.remove();
  const scrollAreas={left:'.left-pane',right:'.right-pane',results:'.result-scroll'};
  for (const [key,selector] of Object.entries(scrollAreas)) {
    const element=document.querySelector(selector);
    if (lastPage!==state.page) state.panelScroll[key]=0;
    else if (element?.getClientRects().length) state.panelScroll[key]=element.scrollTop;
  }
  renderHeader();
  let body;
  if (state.page==='admin') body=adminHeader()+adminView()+footer();
  else {
    const planning=state.page==='planning';
    const left=planning?planLeft():state.page==='land'?landLeft():selectionLeft();
    const right=planning?planRight():parcelRight();
    const classes=['workspace',!planning?'has-results':'',state.panels.left?'left-open':'',state.panels.right?'right-open':'',!planning&&state.panels.results?'results-open':''].join(' ');
    body='<div class="'+classes+'"><h1 class="visually-hidden">'+pages[state.page][0]+'</h1>'+mapStage()+
      sidePanel('left',planning?'产业体系':state.page==='land'?'土地统计':'筛选条件',left)+
      '<div class="right-stack">'+(planning?'':resultCards(visibleParcels()))+
      sidePanel('right',planning?'规划详情':'宗地详情',right)+'</div></div>';
  }
  document.getElementById('app').innerHTML=body;
  if(savedMap&&state.page!=='admin')document.querySelector('#maplibre-map').replaceWith(savedMap);
  if(state.page==='admin'&&landMap){landMap.remove();landMap=undefined;sourceSignature='';scopeSignature='';}
  for (const [key,selector] of Object.entries(scrollAreas)) {
    const element=document.querySelector(selector);
    if (element?.getClientRects().length) element.scrollTop=state.panelScroll[key];
  }
  lastPage=state.page;
  mapObserver?.disconnect();
  const stage=document.querySelector('#map-stage');
  if (stage) {
    paintMap();
    mapObserver=new ResizeObserver(paintMap);
    mapObserver.observe(stage);

  }
}

function toast(message) {
  const element=document.getElementById('toast');
  element.textContent=message;
  element.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>element.hidden=true,2400);
}

function selectVisible() {
  if (!visibleParcels().some(p=>p.id===state.selected)) state.selected=visibleParcels()[0]?.id||'';
  state.facilityType='';
}

function navigate(page) {
  if(window.PUBLIC_DEMO&&page==='admin')page='planning';
  if (!Object.hasOwn(pages,page)) return;
  if (state.page!==page) {
    state.page=page;
    state.detailTab=page==='selection'?'facilities':'base';
    state.layerMenu=false;
    state.zoom=1;
    state.pan=[0,0];
    selectVisible();
    window.scrollTo(0,0);
  }
  if (location.hash!=='#'+page) history.pushState(null,'','#'+page);
  render();
  if ((page==='land'||page==='selection')&&focusParcel(state.selected,true)) paintMap();
}

function showPanel(key) {
  state.panels[key]=true;
  if (innerWidth>880) return;
  if (key==='left') {
    state.panels.right=false;
    state.panels.results=false;
  } else {
    state.panels.left=false;
  }
}

const commands = {
  page:navigate,
  zone:value=>{state.planType='zone';state.planId=value;showPanel('right');},
  park:(value,btn)=>{state.planType='park';state.planId=btn.dataset.zone;state.park=value;state.layers.parks=true;showPanel('right');},
  cluster:value=>{state.planType='cluster';state.planId=value;state.planDirection='';showPanel('right');},
  direction:value=>{state.planDirection=state.planDirection===value?'':value;},
  'planning-more':value=>{state.planningMore=state.planningMore===value?'':value;},
  'scope-land':()=>{state.scope=planningScope();state.stat='';navigate('land');},
  'open-selection':()=>{state.filters={...state.scope};state.filterDraft=null;navigate('selection');},
  'parcel-selection':value=>{const p=parcels.find(p=>p.id===value);state.selected=value;state.filters={zone:p.zone};state.filterDraft=null;navigate('selection');focusParcel(value);paintMap();},
  example:()=>{state.filters={zone:'z1',use:'工业用地',supply:'已供',availability:'可立即使用',min:'50'};state.filterDraft=null;selectVisible();toast('已载入'+zoneName('z1')+'选址条件');},
  'stats-tab':value=>{state.statTab=value;state.stat='';selectVisible();},
  stats:value=>{state.stat=state.stat===value?'':value;selectVisible();},
  'clear-scope':()=>{state.scope={};state.stat='';selectVisible();},
  'clear-filters':()=>{state.filters={};state.filterDraft=null;selectVisible();},
  parcel:value=>{state.selected=value;state.facilityType='';showPanel('right');},
  'parcel-list':value=>{commands.parcel(value);},
  'toggle-panel':key=>{if(state.panels[key]) state.panels[key]=false;else showPanel(key);},
  'detail-tab':value=>{state.detailTab=value;},
  facility:value=>{state.facilityType=state.facilityType===value?'':value;state.detailTab='facilities';state.layers.facilities=true;},
  layers:()=>{state.layerMenu=!state.layerMenu;},
  basemap:value=>{if(['light','imagery'].includes(value))state.basemap=value;},
  zoom:value=>{
    if(value==='reset')fitRecords(parcels,12.5);
    else if(landMap)value==='in'?landMap.zoomIn():landMap.zoomOut();
  },
  edit:value=>{state.editor=value;}
};

document.addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');
  if (!button) return;
  const run=commands[button.dataset.action];
  if (!run) return;
  e.preventDefault();
  run(button.dataset.value,button);
  if (['page','scope-land','open-selection','parcel-selection'].includes(button.dataset.action)) return;
  render();
  if (button.dataset.action==='parcel-list') {
    focusParcel(button.dataset.value);
    paintMap();
  }
  if (button.dataset.action==='toggle-panel') document.querySelector('.panel-toggle[data-value="'+button.dataset.value+'"]:not([hidden])')?.focus({preventScroll:true});
});

document.addEventListener('input',e=>{
  if (e.target.form?.id==='filter-form') state.filterDraft=Object.fromEntries(new FormData(e.target.form));
});

document.addEventListener('change',e=>{
  const field=e.target;
  if (field.dataset.layer) {
    state.layers[field.dataset.layer]=field.checked;
    render();
    return;
  }
  const form=field.form;
  if (!form) return;
  if (field.name==='industry') {
    form.elements.direction.innerHTML=options([['',form.id==='edit-form'?'未登记':'全部'],...directionOptions(field.value)],'');
  }
  if (form.id==='filter-form') state.filterDraft=Object.fromEntries(new FormData(form));
  if (form.id==='scope-form') {
    state.scope=Object.fromEntries(new FormData(form));
    state.stat='';
    selectVisible();
    render();
  }
});

document.addEventListener('toggle',e=>{
  if (e.target.matches('.more-filters')) state.extraFilters=e.target.open;
},true);

document.addEventListener('submit',e=>{
  e.preventDefault();
  const values=Object.fromEntries(new FormData(e.target));
  if (e.target.id==='filter-form') {
    if (values.min&&values.max&&Number(values.min)>Number(values.max)) {
      toast('最大面积应大于或等于最小面积');
      return;
    }
    state.filters=values;
    state.filterDraft=null;
    selectVisible();
    render();
  }
  if (e.target.id==='edit-form') saveParcel(values);
});

async function saveParcel(values) {
  if (!values.name.trim()||!values.use.trim()) {toast('请填写土地坐落与批准用途');return;}
  if (values.availability==='可立即使用' && (values.supply!=='已供'||values.built!=='已形成'||values.approval==='在批'||values.forest==='在办'||values.sea==='在办')) {
    toast('请核对供应、建设界面和审批状态');
    return;
  }
  const enterpriseText=values.enterprises.trim();
  const enterprises=enterpriseText?enterpriseText.split(/\r?\n/).filter(s=>s.trim()).map(row=>{
    const [name,code,industry,area,operating]=row.split(/[|｜]/).map(v=>v.trim());
    return {name,code,industry,area:area!==''&&Number.isFinite(Number(area))?Number(area):area,operating};
  }):null;
  if (enterprises?.some(e=>!e.name)) {toast('每条企业记录须填写企业名称');return;}
  await persistParcel(values,enterprises);
}

function pageFromHash() {
  const hash=location.hash.slice(1);
  return Object.hasOwn(pages,hash)?hash:'planning';
}

window.addEventListener('popstate',()=>navigate(pageFromHash()));
window.addEventListener('hashchange',()=>navigate(pageFromHash()));
navigate(pageFromHash());

let landMap;
let mapMarkers=[];
let scopeSignature='';
let sourceSignature='';
let osmFailed=false;
let imageryFailed=false;
let appliedBasemap='';

function updateBasemap() {
  if(!landMap?.getLayer('parcel-fill')||appliedBasemap===state.basemap) return;
  const imagery=state.basemap==='imagery';
  if(imagery&&!landMap.getSource('imagery')) {
    landMap.addSource('imagery',{
      type:'raster',tileSize:256,maxzoom:19,
      tiles:['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution:'Imagery © <a href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" target="_blank" rel="noopener">Esri, Vantor, Earthstar Geographics, and the GIS User Community</a>'
    });
    landMap.addLayer({id:'imagery',type:'raster',source:'imagery',paint:{'raster-fade-duration':200}},'parcel-fill');
  }
  for(const layer of landMap.getStyle().layers) {
    if(layer.source==='osm')landMap.setLayoutProperty(layer.id,'visibility',imagery?'none':'visible');
  }
  if(landMap.getLayer('imagery'))landMap.setLayoutProperty('imagery','visibility',imagery?'visible':'none');
  landMap.setPaintProperty('parcel-fill','fill-opacity',imagery ? .18 : .36);
  landMap.setPaintProperty('parcel-outline','line-width',imagery?1.6:1);
  landMap.setPaintProperty('selected-parcel','line-color',imagery?'#ffe080':'#164fa2');
  appliedBasemap=state.basemap;
}

function mapStage() {
  const planning=state.page==='planning';
  const legend=planning?[[window.PUBLIC_DEMO?'模拟宗地 / 模拟区块':'真实宗地 / 模拟区块归属','#2464cf']]:Object.entries(supplyColors);
  const toggles=planning?[['parks','模拟园区标注']]:state.page==='selection'?[['facilities','模拟周边设施']]:[];
  return '<section id="map-stage" class="map-stage" aria-label="工业用地地图"><div id="maplibre-map"></div>'+
    '<div class="map-overlay map-top"><div class="map-badge">'+datasetMeta.count+' 宗 · 工业用地</div>'+
    '<div class="basemap-switch" role="group" aria-label="底图切换">'+[['light','浅色地图'],['imagery','卫星影像']].map(([key,label])=>'<button type="button" data-action="basemap" data-value="'+key+'" aria-pressed="'+(state.basemap===key)+'">'+label+'</button>').join('')+'</div>'+
    (toggles.length?'<div>'+action('layers','','▱　图层','map-layer')+'<div class="layer-panel" '+(state.layerMenu?'':'hidden')+'>'+toggles.map(([key,label])=>'<label><input type="checkbox" data-layer="'+key+'" '+(state.layers[key]?'checked':'')+'>'+label+'</label>').join('')+'</div></div>':'')+'</div>'+
    '<div class="map-overlay map-tools">'+[['in','放大地图','+'],['out','缩小地图','−'],['reset','查看全部宗地','⌖']].map(([key,label,icon])=>'<button class="map-btn" data-action="zoom" data-value="'+key+'" aria-label="'+label+'" title="'+label+'">'+icon+'</button>').join('')+'</div>'+
    '<div class="map-overlay map-legend">'+legend.map(([name,color])=>'<span>'+dot(color)+name+'</span>').join('')+'</div>'+
    '<span class="map-caption">'+(osmFailed&&state.basemap==='light'?'浅色底图暂时无法连接 · ':'')+(window.PUBLIC_DEMO?'公开演示 · 全部宗地及业务数据均为模拟':'真实宗地 · 缺失业务字段与周边设施使用模拟数据')+'</span></section>';
}

function nearby(p) {
  if(!p) return [];
  const [lng,lat]=p.center;
  const facilities=[
    {type:'供电',name:'模拟供电接点',xy:[lng+.006,lat+.003],color:'#7569ac',icon:'电'},
    {type:'供水',name:'模拟供水接点',xy:[lng-.004,lat-.005],color:'#407da7',icon:'水'},
    {type:'居住小区',name:'模拟居住组团',xy:[lng+.01,lat-.008],color:'#ac7134',icon:'居'},
    {type:'道路',name:'模拟配套道路',line:[[lng-.012,lat-.006],[lng+.012,lat-.006]],color:'#687f7b',icon:'路'}
  ];
  const boundary=turf.flatten(turf.polygonToLine(turf.feature(p.geometry))).features;
  return facilities.map(f=>{
    let distance=Infinity;
    for(const edge of boundary) {
      for(const xy of f.line||[f.xy]) distance=Math.min(distance,turf.nearestPointOnLine(edge,turf.point(xy),{units:'meters'}).properties.dist);
      if(f.line) {
        const road=turf.lineString(f.line);
        if(turf.lineIntersect(edge,road).features.length) distance=0;
        else for(const xy of edge.geometry.coordinates) distance=Math.min(distance,turf.nearestPointOnLine(road,turf.point(xy),{units:'meters'}).properties.dist);
      }
    }
    return {...f,distance};
  }).filter(f=>f.distance<=2600).sort((a,b)=>a.distance-b.distance);
}

function mapPadding() {
  const stage=document.getElementById('map-stage');
  if(!stage) return 35;
  const rect=stage.getBoundingClientRect();
  const left=document.querySelector('#panel-left')?.getBoundingClientRect();
  const right=document.querySelector('.right-stack')?.getBoundingClientRect();
  let l=left?.width?left.right-rect.left+20:30;
  let r=right?.width?rect.right-right.left+20:30;
  if(rect.width-l-r<180) {l=40;r=40;}
  return {top:65,bottom:65,left:l,right:r};
}

function fitRecords(records,maxZoom=16) {
  if(!landMap||!records.length) return;
  const bounds=new maplibregl.LngLatBounds();
  for(const p of records) {bounds.extend([p.bounds[0],p.bounds[1]]);bounds.extend([p.bounds[2],p.bounds[3]]);}
  landMap.fitBounds(bounds,{padding:mapPadding(),duration:450,maxZoom});
}

function focusParcel(id,onlyIfCovered=false) {
  const p=parcels.find(p=>p.id===id);
  if(!p||!landMap||onlyIfCovered) return false;
  fitRecords([p],17.5);
  return true;
}

function mapRecords() {
  if(state.page!=='planning') return visibleParcels();
  return state.planType==='cluster'?parcels.filter(p=>p.industry===state.planId):parcels;
}

function paintMap() {
  const container=document.getElementById('maplibre-map');
  if(!container) return;
  if(!landMap) {
    appliedBasemap='';osmFailed=false;imageryFailed=false;
    landMap=new maplibregl.Map({
      container,
      center:[121.24,30.31],zoom:11,
      attributionControl:false,
      style:'basemap-light.json'
    });
    landMap.addControl(new maplibregl.AttributionControl({compact:false}),'bottom-right');
    landMap.addControl(new maplibregl.ScaleControl({maxWidth:90,unit:'metric'}),'bottom-left');
    landMap.on('error',event=>{
      if(event.sourceId==='imagery'&&state.basemap==='imagery'&&!imageryFailed) {
        imageryFailed=true;
        toast('影像暂时无法连接，可切回浅色地图');
      }
      if(event.sourceId==='osm'&&!osmFailed) {
        osmFailed=true;
        const caption=document.querySelector('.map-caption');
        if(caption&&state.basemap==='light') caption.textContent='浅色底图暂时无法连接 · '+caption.textContent;
      }
    });
    // The parcel layers must be available even if the external basemap is slow or offline.
    landMap.once('style.load',()=>{
      landMap.addSource('parcels',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      landMap.addLayer({id:'parcel-fill',type:'fill',source:'parcels',paint:{'fill-color':['get','color'],'fill-opacity':.36}});
      landMap.addLayer({id:'parcel-outline',type:'line',source:'parcels',paint:{'line-color':['get','color'],'line-width':1}});
      landMap.addLayer({id:'selected-parcel',type:'line',source:'parcels',filter:['==',['get','id'],''],paint:{'line-color':'#164fa2','line-width':3.5}});
      landMap.addSource('facility-lines',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      landMap.addLayer({id:'facility-lines',type:'line',source:'facility-lines',paint:{'line-color':'#7a74a0','line-width':2,'line-dasharray':[2,2]}});
      landMap.on('click','parcel-fill',event=>{
        const p=parcels.find(p=>p.id===event.features[0].properties.id);
        if(!p) return;
        if(state.page==='planning') commands.zone(p.zone);
        else commands.parcel(p.id);
        render();
      });
      landMap.on('mouseenter','parcel-fill',()=>landMap.getCanvas().style.cursor='pointer');
      landMap.on('mouseleave','parcel-fill',()=>landMap.getCanvas().style.cursor='');
      updateMap();
      fitRecords(parcels,12.5);
    });
  } else {
    landMap.resize();
    updateMap();
  }
}

function updateMap() {
  if(!landMap?.getSource('parcels')) return;
  updateBasemap();
  const records=mapRecords();
  const signature=state.page+'|'+records.map(p=>p.id+':'+p.revision).join(',');
  if(signature!==sourceSignature) {
    const features=records.map(p=>({type:'Feature',id:p.id,geometry:p.geometry,properties:{id:p.id,color:state.page==='planning'?zones.find(z=>z.id===p.zone)?.color||'#6f7f96':supplyColors[p.supply]}}));
    landMap.getSource('parcels').setData({type:'FeatureCollection',features});
    sourceSignature=signature;
  }
  landMap.setFilter('selected-parcel',['==',['get','id'],state.page==='planning'?'':state.selected]);
  mapMarkers.forEach(marker=>marker.remove());
  mapMarkers=[];
  const lineFeatures=[];
  if(state.page==='planning') {
    for(const zone of zones) {
      const group=records.filter(p=>p.zone===zone.id);
      if(!group.length) continue;
      const coords=turf.center(turf.featureCollection(group.map(p=>turf.feature(p.geometry)))).geometry.coordinates;
      const button=document.createElement('button');
      button.className='map-tag '+(state.planId===zone.id?'selected':'');
      button.style.setProperty('--zone',zone.color);
      button.textContent=(state.layers.parks?group[0].park:zone.name)+' · 模拟归属';
      button.dataset.action=state.layers.parks?'park':'zone';
      button.dataset.value=state.layers.parks?group[0].park:zone.id;
      button.dataset.zone=zone.id;
      mapMarkers.push(new maplibregl.Marker({element:button}).setLngLat(coords).addTo(landMap));
    }
  }
  const active=records.find(p=>p.id===state.selected);
  if(active&&state.page==='selection'&&state.layers.facilities) {
    for(const f of nearby(active)) {
      if(state.facilityType&&state.facilityType!==f.type) continue;
      const button=document.createElement('button');
      button.className='facility-mark';button.style.setProperty('--zone',f.color);
      button.textContent=f.icon;button.title=f.name;
      button.dataset.action='facility';button.dataset.value=f.type;
      mapMarkers.push(new maplibregl.Marker({element:button}).setLngLat(f.xy||f.line[0]).addTo(landMap));
      if(f.line) lineFeatures.push(turf.lineString(f.line));
    }
  }
  landMap.getSource('facility-lines').setData({type:'FeatureCollection',features:lineFeatures});
  const nextScope=JSON.stringify([state.page,state.scope,state.filters,state.stat,state.planType,state.planId]);
  if(nextScope!==scopeSignature) {
    scopeSignature=nextScope;
    const target=state.page==='planning'&&state.planType==='zone'?records.filter(p=>p.zone===state.planId):records;
    fitRecords(target,14.5);
  }
}

(function (window, document) {
  'use strict';

  const colors = ['#59e8fa', '#a572ff', '#ffc856', '#ff657d', '#48f5ba', '#ff5ea8', '#65a3ff'];
  const baseAlgorithms = ['FCFS', 'SJF', 'SRTF', 'RR', 'Priority'];
  const algorithms = baseAlgorithms.flatMap((name)=>[name,`${name}+HNWF`]);
  let response = null;
  let selectedPid = 'P3';
  let activeAlgorithm = 'SRTF+HNWF';
  let fairnessBase = 'SRTF';
  let selectedMetric = 'legacy_jains_waiting_index';
  let metricAlgorithms = new Set(algorithms);
  let activeView = 'overview';
  let toastTimer = null;
  let playbackTime = 0;
  let playbackTimer = null;
  let playbackLastFrame = 0;
  let playbackSpeed = .5;
  let playbackRunning = false;
  const playbackUnitsPerSecond = 8;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
  const fmt = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits).replace(/\.0$/, '') : '—';
  const metric = (result, name) => window.FairnessData.metricValue(result, name);
  const isSupervised = (name) => String(name).endsWith('+HNWF') || name === 'HNWF';
  const baseName = (name) => name === 'HNWF' ? 'SRTF' : String(name).replace(/\+HNWF$/, '');
  const supervisedName = (name) => `${baseName(name)}+HNWF`;
  const hnwf = () => {
    if (!response || !response.results) return null;
    if (isSupervised(activeAlgorithm) && response.results[activeAlgorithm]) return response.results[activeAlgorithm];
    return response.results[supervisedName(activeAlgorithm)] || Object.entries(response.results).find(([name])=>isSupervised(name))?.[1] || null;
  };
  const activeResult = () => response && response.results ? (response.results[activeAlgorithm] || Object.values(response.results)[0]) : null;
  const selectedProcess = () => {
    const processes = hnwf() && hnwf().processes ? hnwf().processes : [];
    return processes.find((item) => item.pid === selectedPid) || processes[0] || null;
  };

  function demoResponse() {
    const metrics = {
      FCFS:[132.1,.718,2,268], SJF:[102.9,.576,4,272], SRTF:[102.8,.574,4,272],
      RR:[205,.899,0,275], Priority:[130.5,.672,2,279]
    };
    const processes = [
      ['P1',0,14,5,0,0,42,28,42,0,14,13.9,.2,14,0], ['P2',1,9,4,-1,2,35,25,34,1,9,8.8,-.2,18,0],
      ['P3',3,7,8,3,6,29,19,26,3,7,7.3,.3,24,0], ['P4',4,16,2,-3,1,48,28,44,0,16,15.3,-.7,32,1],
      ['P5',8,6,6,1,9,31,17,23,1,6,6.4,.4,19,0], ['P6',9,12,7,2,14,54,33,45,5,12,12.3,.3,31,1]
    ].map(([pid,arrival,burst,priority,nice,start,completion,waiting,turnaround,responseTime,actual,ideal,debt,gap,guards], index) => ({
      pid,arrival,burst,priority,nice,weight:[1024,1277,526,1991,820,655][index],start,completion,waiting,turnaround,response:responseTime,
      actual_service:actual,ideal_service:ideal,final_fairness_debt:debt,max_positive_debt:Math.max(.5,Math.abs(debt)+2.8),final_vruntime:8.1+index,
      max_service_gap:gap,preemptions:index%3,guard_activations:guards,state:'COMPLETED',slowdown:turnaround/burst
    }));
    const slices = [
      ['P1',0,8,'SRTF_FALLBACK'],['P2',8,14,'FAIRNESS_DEBT'],['P3',14,23,'FAIRNESS_DEBT'],['P6',23,29,'HARD_GUARD'],
      ['P4',29,35,'HARD_GUARD'],['P3',35,42,'FAIRNESS_DEBT'],['P5',42,49,'TEMPORARY_BOOST'],['P4',49,58,'FAIRNESS_DEBT'],['P6',58,64,'HARD_GUARD']
    ].map((item,index)=>({decision_id:index+1,pid:item[0],start:item[1],end:item[2],duration:item[2]-item[1],reason:item[3],protected:item[3]==='HARD_GUARD',context_switch_before:index>0}));
    const times = [0,10,20,30,40,50,60];
    const fairness_trace = times.map((time,tIndex)=>{const baseProposed=processes[(tIndex+1)%6].pid;const selected=processes[tIndex%6].pid;return {decision_id:tIndex+1,time,base_algorithm:'SRTF',base_proposed_pid:baseProposed,selected_pid:selected,overridden:baseProposed!==selected,reason:tIndex===4?'HARD_GUARD':tIndex%2?'ML_STARVATION_RISK':'ML_UNFAIRNESS_RISK',candidates:processes.map((process,pIndex)=>({
      pid:process.pid,remaining:Math.max(1,process.burst-tIndex),nice:process.nice,weight:process.weight,
      ideal_service:Number(Math.max(0,(tIndex*1.2)+(pIndex*.15)).toFixed(2)),actual_service:Number(Math.max(0,(tIndex*.9)+((pIndex+tIndex)%3)).toFixed(2)),
      fairness_debt:Number((Math.sin((tIndex+pIndex)*.8)*2.4+(pIndex===3?1.2:0)).toFixed(2)),vruntime:Number((tIndex*1.3+pIndex).toFixed(2)),
      service_gap:Math.min(32,Math.max(0,tIndex*5-pIndex*2)),boost:Math.min(4,Math.floor(tIndex/2)),guard_eligible:tIndex*5-pIndex*2>=32,
      starvation_probability:Number(Math.min(.98,.08+tIndex*.09+pIndex*.025).toFixed(3)),unfairness_probability:Number(Math.min(.96,.12+tIndex*.06+pIndex*.035).toFixed(3)),base_selected:process.pid===baseProposed
    }))}});
    const results = {};
    baseAlgorithms.forEach((name)=>{
      const values=metrics[name];
      results[name]={metrics:{avg_waiting_time:values[0],avg_turnaround_time:values[0]+18,avg_response_time:values[0]*.42,max_waiting_time:values[3],legacy_jains_waiting_index:values[1],legacy_starvation_count:values[2],context_switches:8},processes:[],slices:[],fairness_trace:[],guard_events:[],configuration:{policy:name}};
      const supervised=`${name}+HNWF`;
      results[supervised]={metrics:{avg_waiting_time:values[0]+8,avg_turnaround_time:values[0]+26,avg_response_time:values[0]*.38,max_waiting_time:values[3]-18,legacy_jains_waiting_index:Math.min(.98,values[1]+.12),legacy_starvation_count:Math.max(0,values[2]-2),weighted_service_fairness:.942,max_service_gap:32,p95_service_gap:22,guard_bound_violations:0,guard_activations:2,max_positive_debt:3.6,context_switches:18,fairness_overrides:8,ml_starvation_interventions:5,ml_unfairness_interventions:2},processes,slices,fairness_trace,guard_events:[{pid:'P4',trigger_time:42,observed_gap:32,gmax:32,resolved:true},{pid:'P6',trigger_time:57,observed_gap:31,gmax:32,resolved:true}],configuration:{policy:supervised,role:'fairness_supervisor',base_algorithm:name,gmax:32,protected_quantum:1,boost_interval:8,max_boost:4,debt_epsilon:.25,risk_model:'dual_logistic_regression'}};
    });
    return {status:'demo',source:'local_demo',workload:'normal',seed:0,process_count:6,trace_available:true,results};
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function setLive(isLive) {
    const pill = document.getElementById('live-pill');
    pill.classList.toggle('offline', !isLive);
    pill.querySelector('b').textContent = isLive ? 'LIVE' : 'DEMO';
  }

  function route(view) {
    const previousView = activeView;
    const updatePanels = () => {
      document.querySelectorAll('[data-view-panel]').forEach((panel)=>panel.classList.toggle('active',panel.dataset.viewPanel===view));
      document.querySelectorAll('[data-view]').forEach((button)=>button.classList.toggle('active',button.dataset.view===view));
    };
    if (document.startViewTransition && previousView !== view && !reducedMotion.matches) document.startViewTransition(updatePanels);
    else updatePanels();
    activeView = view;
    if (window.location.hash !== `#${view}`) history.replaceState(null,'',`#${view}`);
    window.SchedulerStore.setState({route:view});
  }

  function metricCard(label, value, sub, tone='') {
    return `<article class="metric-card ${tone}"><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(sub)}</span></article>`;
  }

  function renderKpis() {
    const result = hnwf();
    if (!result) {
      const baseline=activeResult();
      document.getElementById('overview-kpis').innerHTML=[metricCard('Supervisor','OFF','enable it in Simulation','violet'),metricCard('Average wait',`${fmt(metric(baseline,'avg_waiting_time'))} ms`,activeAlgorithm),metricCard('Starvation',fmt(metric(baseline,'legacy_starvation_count'),0),'baseline result','amber')].join('');
      document.getElementById('fairness-kpis').innerHTML=metricCard('Fairness supervisor','Disabled','enable comparison in Simulation','violet');
      return;
    }
    const policy=result.configuration?.policy||supervisedName(activeAlgorithm);
    document.getElementById('overview-kpis').innerHTML = [
      metricCard('Weighted fairness',fmt(metric(result,'weighted_service_fairness'),3),policy,'mint'),
      metricCard('Fairness overrides',fmt(metric(result,'fairness_overrides'),0),'base decisions adjusted'),
      metricCard('Max service gap',`${fmt(metric(result,'max_service_gap'))} ms`,`guard target ${result.configuration.gmax||32} ms`,'amber')
    ].join('');
  }

  function linePath(values,width,height,pad=38) {
    const finite=values.map(Number).filter(Number.isFinite); const min=Math.min(...finite),max=Math.max(...finite); const range=max-min||1;
    return values.map((value,index)=>{const x=pad+index*((width-pad*2)/Math.max(1,values.length-1));const y=height-pad-((Number(value)-min)/range)*(height-pad*2);return {x,y,value};});
  }
  function pathD(points){return points.map((point,index)=>`${index?'L':'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}

  function renderOverviewChart() {
    const host=document.getElementById('overview-chart');
    const definitions={
      avg_waiting_time:{label:'Average waiting time',unit:'ms',digits:1,better:'lower'},
      avg_turnaround_time:{label:'Average turnaround time',unit:'ms',digits:1,better:'lower'},
      avg_response_time:{label:'Average response time',unit:'ms',digits:1,better:'lower'},
      legacy_jains_waiting_index:{label:'Jain waiting-time fairness',unit:'',digits:3,better:'higher'},
      legacy_starvation_count:{label:'Starvation count',unit:'processes',digits:0,better:'lower'}
    };
    const definition=definitions[selectedMetric];
    const allRows=window.FairnessData.comparison(response,selectedMetric).filter(item=>item.available);
    const picker=document.getElementById('metric-algorithms');
    picker.innerHTML=allRows.map((row,index)=>`<button type="button" class="${metricAlgorithms.has(row.algorithm)?'active':''}" data-metric-algorithm="${esc(row.algorithm)}" style="--series-color:${colors[index%colors.length]}"><i></i>${esc(row.algorithm)}</button>`).join('');
    picker.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
      const name=button.dataset.metricAlgorithm;
      if(metricAlgorithms.has(name)&&metricAlgorithms.size>1)metricAlgorithms.delete(name);else metricAlgorithms.add(name);
      renderOverviewChart();
    }));
    const rows=allRows.filter(row=>metricAlgorithms.has(row.algorithm));
    if(!rows.length){host.innerHTML='<div class="chart-empty">Select at least one algorithm.</div>';return}
    const max=Math.max(1,...rows.map(row=>Number(row.value)||0));
    const target=definition.better==='higher'?Math.max(...rows.map(row=>Number(row.value))):Math.min(...rows.map(row=>Number(row.value)));
    host.innerHTML=`<div class="metric-chart-head"><div><strong>${esc(definition.label)}</strong><span>${definition.better==='higher'?'Higher is better':'Lower is better'}</span></div><small>Same workload · exact backend results</small></div><div class="metric-bar-chart" role="img" aria-label="${esc(definition.label)} comparison">${rows.map((row,index)=>{
      const value=Number(row.value); const width=Math.max(value===0?1.5:5,(value/max)*100); const best=value===target;
      return `<button type="button" class="metric-bar-row ${best?'best':''}" data-algorithm="${esc(row.algorithm)}" title="${esc(row.algorithm)}: ${fmt(value,definition.digits)} ${esc(definition.unit)}"><span class="metric-bar-label"><b>${esc(row.algorithm)}</b>${best?'<em>best</em>':''}</span><span class="metric-bar-track"><i style="width:${width}%;--bar-color:${colors[index%colors.length]}"></i></span><strong>${fmt(value,definition.digits)}${definition.unit==='ms'?' ms':definition.unit?` ${esc(definition.unit)}`:''}</strong></button>`;
    }).join('')}</div>`;
    host.querySelectorAll('.metric-bar-row').forEach(button=>button.addEventListener('click',()=>{selectAlgorithm(button.dataset.algorithm);route('simulation')}));
  }

  function bindChartPoints(host,labeler,onClick) {
    const tooltip=host.querySelector('.chart-tooltip');
    host.querySelectorAll('.chart-point').forEach((node)=>{
      node.addEventListener('mouseenter',()=>{if(!tooltip)return;tooltip.textContent=labeler(node);tooltip.style.left=`${node.getAttribute('cx')/9}%`;tooltip.style.top=`${node.getAttribute('cy')/2.9}%`;tooltip.classList.add('show')});
      node.addEventListener('mouseleave',()=>tooltip&&tooltip.classList.remove('show'));
      if(onClick)node.addEventListener('click',()=>onClick(node));
    });
  }

  function renderOverviewSide() {
    const result=hnwf();
    if(!result){document.getElementById('balance-card').innerHTML='<h3>HNWF supervisor is off</h3><p>Enable “Compare with HNWF Fairness Supervisor” in Simulation to inspect risk and interventions.</p>';document.getElementById('event-stream').innerHTML='<div class="chart-empty">No supervisor events in this run.</div>';return}
    const violations=metric(result,'guard_bound_violations')||0; const guards=metric(result,'guard_activations')||0;
    const policy=result.configuration?.policy||supervisedName(activeAlgorithm);
    document.getElementById('balance-card').innerHTML=`<h3>${esc(policy)} supervisor</h3><p>ML risk can adjust the base proposal; the hard guard remains the final safety rule.</p><div class="badge-row"><span class="mini-badge">● ${fmt(metric(result,'fairness_overrides'),0)} overrides</span><span class="mini-badge danger">● ${fmt(guards,0)} hard guards</span></div><p>Decision order</p><div class="decision-order">guard → starvation risk → unfairness risk → base</div><span class="audit-note">Every proposal and final choice is recorded.</span>`;
    const events=(result.fairness_trace||[]).filter(item=>item.overridden).slice(0,3).map(item=>({trigger_time:item.time,pid:item.selected_pid,label:String(item.reason||'override').replaceAll('_',' ').toLowerCase()}));
    const fallbacks=[{trigger_time:42,pid:'P3',label:'starvation risk'},{trigger_time:53,pid:'P4',label:'hard guard'},{trigger_time:57,pid:'P6',label:'unfairness risk'}];
    document.getElementById('event-stream').innerHTML=(events.length?events:fallbacks).map(item=>`<div class="event-row"><i class="event-dot"></i><time>${fmt(item.trigger_time,0)} ms</time><strong>${esc(item.pid)} · ${esc(item.label)}</strong></div>`).join('');
  }

  function algorithmBehavior(name) {
    const base=baseName(name); const supervised=isSupervised(name); const quantum=Number(document.getElementById('control-quantum')?.value||2);
    const rules={
      FCFS:'Oldest ready process runs first.',
      SJF:'Shortest ready burst runs first.',
      SRTF:'Least remaining CPU time runs; a shorter arrival may preempt.',
      RR:`Each process gets ${quantum} ms, then requeues if unfinished.`,
      Priority:'Lowest priority number runs first.'
    };
    return {
      title:supervised?`${base} + HNWF`:`${base} scheduler`,
      kind:supervised?'BASE DECISION + FAIRNESS CHECK':'BASE SCHEDULING RULE',
      text:supervised?`${rules[base]||'The base policy proposes a process.'} HNWF checks fairness before dispatch.`:(rules[base]||'The selected base policy chooses the next process.')
    };
  }

  function renderSimulation() {
    const result=activeResult(); if(!result)return; const processes=result.processes||[]; document.getElementById('control-processes').textContent=processes.length;
    const hnwfResult=hnwf(); if(hnwfResult)document.getElementById('control-gmax').value=hnwfResult.configuration.gmax||32;
    const available=Object.keys(response.results||{}); const focus=document.getElementById('control-focus-algorithm');
    focus.innerHTML=available.map(name=>`<option value="${esc(name)}" ${name===activeAlgorithm?'selected':''}>${esc(name)}</option>`).join('');
    document.getElementById('theater-policy').textContent=activeAlgorithm; document.getElementById('timeline-policy').textContent=activeAlgorithm;
    const behavior=algorithmBehavior(activeAlgorithm);
    document.getElementById('os-scheduler-name').textContent=behavior.title;
    document.getElementById('os-policy-rule').textContent=behavior.text;
    const kind=document.getElementById('os-algorithm-kind'); if(kind)kind.textContent=behavior.kind;
    const explanation=document.getElementById('os-algorithm-explanation'); if(explanation)explanation.textContent=behavior.text;
    const slices=window.FairnessData.timeline(result); const total=Math.max(1,...slices.map(slice=>slice.end));
    document.getElementById('execution-timeline').innerHTML=`<div class="timeline-track">${slices.map((slice,index)=>{const share=(slice.duration/total)*100;const showLabel=share>=3||slice.duration>=4;return `<button class="timeline-slice ${slice.protected?'guard':''}" data-pid="${esc(slice.pid)}" data-start="${slice.start}" data-end="${slice.end}" data-reason="${esc(slice.reason)}" style="width:${share}%;--slice-color:${colors[index%colors.length]}"><span>${showLabel?esc(slice.pid):''}</span><title>${esc(slice.pid)} · ${slice.start}–${slice.end} ms · ${esc(slice.reason)}</title></button>`}).join('')}<i class="timeline-playhead" id="timeline-playhead"></i></div>`;
    document.getElementById('timeline-end').textContent=`${fmt(total,0)} ms`;
    document.getElementById('playback-range').max=String(total);
    document.querySelectorAll('.timeline-slice').forEach(node=>node.addEventListener('click',()=>{stopPlayback();playbackTime=Number(node.dataset.start)||0;selectedPid=node.dataset.pid;updatePlaybackUi()}));
    playbackTime=Math.min(playbackTime,total);
    updatePlaybackUi();
  }

  function stopPlayback() {
    if(playbackTimer)window.cancelAnimationFrame(playbackTimer);
    playbackTimer=null; playbackRunning=false;
    const toggle=document.getElementById('playback-toggle'); if(toggle)toggle.textContent='▶ Play';
  }

  function updatePlaybackUi() {
    const result=activeResult(); if(!result)return;
    const slices=window.FairnessData.timeline(result); const total=Math.max(1,...slices.map(slice=>slice.end));
    playbackTime=Math.max(0,Math.min(total,playbackTime));
    const current=slices.find(slice=>playbackTime>=slice.start&&playbackTime<slice.end)||(playbackTime>=total?slices[slices.length-1]:null);
    const range=document.getElementById('playback-range'); if(range)range.value=String(playbackTime);
    const clock=document.getElementById('live-clock'); if(clock)clock.textContent=`● ${fmt(playbackTime,0)} / ${fmt(total,0)} ms`;
    const playhead=document.getElementById('timeline-playhead'); if(playhead)playhead.style.left=`${(playbackTime/total)*100}%`;
    document.querySelectorAll('.timeline-slice').forEach(node=>{const start=Number(node.dataset.start),end=Number(node.dataset.end);node.classList.toggle('elapsed',end<=playbackTime);node.classList.toggle('running',playbackTime>=start&&playbackTime<end)});
    const decision=current&&isSupervised(activeAlgorithm)?(result.fairness_trace||[]).find(item=>Number(item.decision_id)===Number(current.decisionId)):null;
    const currentProcess=current?(result.processes||[]).find(process=>process.pid===current.pid):null;
    const packet=document.getElementById('os-process-packet'); const core=document.getElementById('hardware-core');
    const progress=current?Math.max(0,Math.min(1,(playbackTime-current.start)/Math.max(.001,current.duration))):0;
    const angle=-Math.PI+(progress*Math.PI*2); const orbitX=50+Math.cos(angle)*27; const orbitY=50+Math.sin(angle)*27;
    const phase=progress<.25?'ready':progress<.5?'scheduler':progress<.75?'running':'return';
    const completes=Boolean(current&&currentProcess&&Number(current.end)>=Number(currentProcess.completion));
    if(packet){packet.classList.toggle('moving',Boolean(current));packet.style.left=`${orbitX}%`;packet.style.top=`${orbitY}%`;packet.style.opacity=current?'1':'0';packet.style.setProperty('--process-color',colors[Math.max(0,(result.processes||[]).findIndex(process=>process.pid===current?.pid))%colors.length]);packet.dataset.phase=phase;packet.setAttribute('aria-label',current?`${current.pid}, ${phase}`:'CPU idle')}
    document.querySelectorAll('[data-cycle-phase]').forEach(node=>node.classList.toggle('active',Boolean(current)&&node.dataset.cyclePhase===phase));
    const readyCount=(result.processes||[]).filter(process=>Number(process.arrival)<=playbackTime&&Number(process.completion)>playbackTime&&process.pid!==current?.pid).length;
    document.getElementById('cycle-ready-count').textContent=`${readyCount} waiting`;
    document.getElementById('cycle-return-title').textContent=completes?'Complete':'Requeue';
    document.getElementById('cycle-return-detail').textContent=completes?'Burst finished':'More work remains';
    core?.classList.toggle('executing',Boolean(current)&&phase==='running');
    document.getElementById('core-process').textContent=current?.pid||'IDLE';
    document.getElementById('core-progress').textContent=current?`${fmt(Math.max(0,playbackTime-current.start),1)} / ${fmt(current.duration,0)} ms`:'0 ms';
    document.getElementById('os-base-choice').textContent=decision?`Proposal · ${decision.base_proposed_pid}`:current?`Proposal · ${current.pid}`:'Proposal —';
    document.getElementById('os-final-choice').textContent=current?`Dispatch · ${current.pid}`:'Decision —';
    document.getElementById('os-supervisor-state').textContent=decision?(decision.overridden?'HNWF · REDIRECTED':'HNWF · ACCEPTED'):'BASE POLICY';
    document.getElementById('os-supervisor-state').classList.toggle('override',Boolean(decision?.overridden));
    const decisionText=decision
      ? decision.overridden
        ? `${decision.base_algorithm||baseName(activeAlgorithm)} proposed ${decision.base_proposed_pid}; HNWF selected ${decision.selected_pid} (${String(decision.reason||'fairness override').replaceAll('_',' ').toLowerCase()}).`
        : `${decision.base_algorithm||baseName(activeAlgorithm)} proposed ${decision.base_proposed_pid}; HNWF accepted the proposal.`
      : current?String(current.reason||'base policy decision').replaceAll('_',' ').toLowerCase():'';
    const timelineExplanation=document.getElementById('timeline-explanation');
    if(timelineExplanation)timelineExplanation.innerHTML=current?`<span>${fmt(current.start,0)}–${fmt(current.end,0)} ms</span><strong>${esc(current.pid)} receives ${fmt(current.duration,0)} ms of CPU service</strong><p>${esc(decisionText)} Click another block to inspect a different dispatch.</p>`:`<span>${fmt(playbackTime,0)} ms</span><strong>CPU idle</strong><p>No process is executing at this moment.</p>`;
    if(playbackTime>=total&&playbackRunning){stopPlayback();document.getElementById('playback-toggle').textContent='↺ Replay'}
  }

  function togglePlayback() {
    const slices=window.FairnessData.timeline(activeResult()); const total=Math.max(1,...slices.map(slice=>slice.end));
    if(playbackRunning){stopPlayback();return}
    if(playbackTime>=total)playbackTime=0;
    playbackRunning=true; playbackLastFrame=window.performance.now(); document.getElementById('playback-toggle').textContent='Ⅱ Pause';
    const animate=(now)=>{if(!playbackRunning)return;const elapsed=Math.min(100,Math.max(0,now-playbackLastFrame));playbackLastFrame=now;playbackTime+=(elapsed/1000)*playbackUnitsPerSecond*playbackSpeed;updatePlaybackUi();if(playbackRunning)playbackTimer=window.requestAnimationFrame(animate)};
    playbackTimer=window.requestAnimationFrame(animate);
  }

  function selectAlgorithm(name) {
    if(!response.results[name])return; stopPlayback(); playbackTime=0; activeAlgorithm=name; fairnessBase=baseName(name); const inspected=isSupervised(name)?response.results[name]:response.results[supervisedName(name)]||response.results[name]; const processes=inspected.processes||[]; selectedPid=processes[0]?.pid||selectedPid; renderAll();
  }

  function renderDebtChart() {
    const host=document.getElementById('debt-chart');
    const series=window.FairnessData.fairnessSeries(hnwf()).slice(0,3).map((item)=>{
      if(item.points.length<=28)return item;
      const stride=(item.points.length-1)/27;
      return {...item,points:Array.from({length:28},(_,index)=>item.points[Math.round(index*stride)])};
    });
    const width=760,height=290;
    const all=series.flatMap(item=>item.points.map(point=>point.debt)); const min=Math.min(-1,...all),max=Math.max(1,...all),range=max-min||1;
    const toPoints=(points)=>points.map((point,index)=>({x:36+index*((width-72)/Math.max(1,points.length-1)),y:height-35-((point.debt-min)/range)*(height-70),value:point.debt,time:point.time}));
    host.innerHTML=`<svg viewBox="0 0 ${width} ${height}">${[50,105,160,215].map(y=>`<line class="grid-line" x1="36" y1="${y}" x2="724" y2="${y}"/>`).join('')}${series.map((item,index)=>{const pts=toPoints(item.points);return `<path class="chart-line" data-pid="${esc(item.pid)}" stroke="${colors[index]}" d="${pathD(pts)}"/>${pts.map(p=>`<circle class="chart-point" data-pid="${esc(item.pid)}" data-value="${p.value}" cx="${p.x}" cy="${p.y}" r="5" fill="${colors[index]}"><title>${esc(item.pid)} debt ${fmt(p.value,2)} ms</title></circle>`).join('')}`}).join('')}</svg><div class="chart-tooltip"></div>`;
    bindChartPoints(host,node=>`${node.dataset.pid} · debt ${fmt(node.dataset.value,2)} ms`,node=>selectPid(node.dataset.pid));
    host.querySelectorAll('.chart-line').forEach(line=>line.addEventListener('click',()=>selectPid(line.dataset.pid)));
  }

  function renderHeatmap() {
    const series=window.FairnessData.fairnessSeries(hnwf()).slice(0,6); let html='<span></span>'+[1,2,3,4,5,6].map(i=>`<span class="heat-label">T${i}</span>`).join('');
    series.forEach(item=>{html+=`<button class="heat-label" data-pid="${esc(item.pid)}">${esc(item.pid)}</button>`; const points=item.points.slice(-6); for(let i=0;i<6;i++){const gap=points[i]?.serviceGap||0;const level=gap>=32?5:gap>=24?4:gap>=16?3:gap>=8?2:1;html+=`<button class="heat-cell l${level}" data-pid="${esc(item.pid)}" title="${esc(item.pid)} · ${gap} ms"></button>`}}); document.getElementById('gap-heatmap').innerHTML=html;
    document.querySelectorAll('#gap-heatmap [data-pid]').forEach(node=>node.addEventListener('click',()=>selectPid(node.dataset.pid)));
  }

  function renderServiceBars() {
    const processes=(hnwf().processes||[]).slice(0,6); const max=Math.max(1,...processes.flatMap(process=>[process.actual_service,process.ideal_service]));
    document.getElementById('service-bars').innerHTML=processes.map((process,index)=>`<button class="bar-pair" data-pid="${esc(process.pid)}" title="${esc(process.pid)} actual ${fmt(process.actual_service)} / ideal ${fmt(process.ideal_service)}"><i style="height:${Math.max(8,process.ideal_service/max*90)}%"></i><i class="actual" style="height:${Math.max(8,process.actual_service/max*90)}%;background:${colors[index%colors.length]}"></i><span>${esc(process.pid)}</span></button>`).join('');
    document.querySelectorAll('.bar-pair').forEach(node=>node.addEventListener('click',()=>selectPid(node.dataset.pid)));
  }

  function renderPinned() {
    const process=selectedProcess(); if(!process)return;
    document.getElementById('pinned-card').innerHTML=`<h3>Pinned process · ${esc(process.pid)}</h3><p>Selection persists across all charts.</p><dl><div><dt>Weight</dt><dd>${fmt(process.weight,0)}</dd></div><div><dt>Debt</dt><dd>${fmt(process.final_fairness_debt,2)} ms</dd></div><div><dt>Gap</dt><dd>${fmt(process.max_service_gap)} ms</dd></div><div><dt>Action</dt><dd>${process.guard_activations?'HARD GUARD':'FAIR SHARE'}</dd></div></dl>`;
  }

  function comparisonPairs() {
    if(!response||!response.results)return [];
    return baseAlgorithms.map(base=>({base,baseline:response.results[base],supervised:response.results[`${base}+HNWF`]})).filter(pair=>pair.baseline&&pair.supervised);
  }

  function signed(value,digits=1,unit='') {
    const number=Number(value); if(!Number.isFinite(number))return '—';
    return `${number>0?'+':''}${fmt(number,digits)}${unit}`;
  }

  function renderPairedColumns(hostId,pairs,metricName,{maximum=null,digits=1,unit='' }={}) {
    const host=document.getElementById(hostId); if(!host)return;
    if(!pairs.length){host.innerHTML='<div class="chart-empty">Run base algorithms with the HNWF comparison enabled.</div>';return}
    const values=pairs.flatMap(pair=>[metric(pair.baseline,metricName),metric(pair.supervised,metricName)]).map(Number).filter(Number.isFinite);
    const max=maximum||Math.max(1,...values);
    host.innerHTML=`<span class="chart-scale-note">0 → ${fmt(max,digits)}${esc(unit)}</span><div class="column-plot">${pairs.map(pair=>{
      const baseValue=Number(metric(pair.baseline,metricName))||0; const supervisedValue=Number(metric(pair.supervised,metricName))||0;
      const baseHeight=Math.max(baseValue===0?1.5:4,(baseValue/max)*100); const supervisedHeight=Math.max(supervisedValue===0?1.5:4,(supervisedValue/max)*100);
      return `<button type="button" class="column-group ${pair.base===fairnessBase?'selected':''}" data-fairness-base="${esc(pair.base)}" aria-label="${esc(pair.base)}: base ${fmt(baseValue,digits)}${esc(unit)}, with HNWF ${fmt(supervisedValue,digits)}${esc(unit)}" title="${esc(pair.base)} · Base ${fmt(baseValue,digits)}${esc(unit)} · +HNWF ${fmt(supervisedValue,digits)}${esc(unit)}"><span class="column-bars"><i class="data-column base" style="height:${baseHeight}%"><b class="column-value">${fmt(baseValue,digits)}</b></i><i class="data-column supervised" style="height:${supervisedHeight}%"><b class="column-value">${fmt(supervisedValue,digits)}</b></i></span><b class="column-label">${esc(pair.base)}</b></button>`;
    }).join('')}</div>`;
  }

  function renderMlColumns(pairs) {
    const host=document.getElementById('ml-intervention-chart'); if(!host)return;
    if(!pairs.length){host.innerHTML='<div class="chart-empty">ML decisions are available when HNWF comparison is enabled.</div>';return}
    const rows=pairs.map(pair=>({base:pair.base,starvation:Number(metric(pair.supervised,'ml_starvation_interventions'))||0,unfairness:Number(metric(pair.supervised,'ml_unfairness_interventions'))||0,guards:Number(metric(pair.supervised,'guard_activations'))||0}));
    const max=Math.max(1,...rows.flatMap(row=>[row.starvation,row.unfairness,row.guards]));
    host.innerHTML=`<div class="ml-legend"><span><i style="background:#ffc856"></i>Starvation risk</span><span><i style="background:#ff5ea8"></i>Unfairness risk</span><span><i style="background:#48f5ba"></i>Hard guard</span></div><span class="chart-scale-note">0 → ${fmt(max,0)} decisions</span><div class="column-plot">${rows.map(row=>`<button type="button" class="column-group ${row.base===fairnessBase?'selected':''}" data-fairness-base="${esc(row.base)}" aria-label="${esc(row.base)} HNWF: ${row.starvation} starvation-risk interventions, ${row.unfairness} unfairness-risk interventions, ${row.guards} hard guards" title="${esc(row.base)}+HNWF · starvation risk ${row.starvation} · unfairness risk ${row.unfairness} · hard guards ${row.guards}"><span class="column-bars"><i class="data-column ml-starvation" style="height:${Math.max(row.starvation===0?1.5:4,row.starvation/max*100)}%"><b class="column-value">${row.starvation}</b></i><i class="data-column ml-unfairness" style="height:${Math.max(row.unfairness===0?1.5:4,row.unfairness/max*100)}%"><b class="column-value">${row.unfairness}</b></i><i class="data-column guard" style="height:${Math.max(row.guards===0?1.5:4,row.guards/max*100)}%"><b class="column-value">${row.guards}</b></i></span><b class="column-label">${esc(row.base)}</b></button>`).join('')}</div>`;
  }

  function focusFairnessPair(base) {
    fairnessBase=base;
    if(response?.results?.[`${base}+HNWF`])activeAlgorithm=`${base}+HNWF`;
    renderFairness();
  }

  function renderFairness() {
    const pairs=comparisonPairs();
    const selector=document.getElementById('fairness-pair-select');
    if(!pairs.length){selector.innerHTML='<option>HNWF comparison unavailable</option>';document.getElementById('fairness-kpis').innerHTML=metricCard('Comparison unavailable','Supervisor off','enable HNWF in Simulation','violet');renderPairedColumns('fairness-comparison-chart',[],'legacy_jains_waiting_index');renderPairedColumns('starvation-comparison-chart',[],'legacy_starvation_count');renderMlColumns([]);document.getElementById('fairness-pair-detail').innerHTML='<h2>No paired results</h2><p>Return to Simulation and enable “Compare with HNWF Fairness Supervisor.”</p>';return}
    if(!pairs.some(pair=>pair.base===fairnessBase))fairnessBase=pairs[0].base;
    selector.innerHTML=pairs.map(pair=>`<option value="${esc(pair.base)}" ${pair.base===fairnessBase?'selected':''}>${esc(pair.base)} vs ${esc(pair.base)}+HNWF</option>`).join('');
    selector.onchange=()=>focusFairnessPair(selector.value);
    const pair=pairs.find(item=>item.base===fairnessBase)||pairs[0];
    const fairnessBefore=Number(metric(pair.baseline,'legacy_jains_waiting_index'))||0; const fairnessAfter=Number(metric(pair.supervised,'legacy_jains_waiting_index'))||0;
    const starvedBefore=Number(metric(pair.baseline,'legacy_starvation_count'))||0; const starvedAfter=Number(metric(pair.supervised,'legacy_starvation_count'))||0;
    const waitBefore=Number(metric(pair.baseline,'avg_waiting_time'))||0; const waitAfter=Number(metric(pair.supervised,'avg_waiting_time'))||0;
    const fairnessDelta=fairnessAfter-fairnessBefore; const starvedDelta=starvedAfter-starvedBefore; const waitDelta=waitAfter-waitBefore;
    const starvationInterventions=Number(metric(pair.supervised,'ml_starvation_interventions'))||0; const unfairnessInterventions=Number(metric(pair.supervised,'ml_unfairness_interventions'))||0; const guards=Number(metric(pair.supervised,'guard_activations'))||0;
    document.getElementById('fairness-kpis').innerHTML=[
      metricCard('Fairness change',signed(fairnessDelta,3),`${fmt(fairnessBefore,3)} → ${fmt(fairnessAfter,3)}`,fairnessDelta>=0?'mint':'pink'),
      metricCard('Starved change',signed(starvedDelta,0),`${fmt(starvedBefore,0)} → ${fmt(starvedAfter,0)} processes`,starvedDelta<=0?'mint':'pink'),
      metricCard('Average wait change',signed(waitDelta,1,' ms'),`${fmt(waitBefore)} → ${fmt(waitAfter)} ms`,waitDelta<=0?'mint':'amber'),
      metricCard('ML interventions',fmt(starvationInterventions+unfairnessInterventions,0),`${starvationInterventions} starvation · ${unfairnessInterventions} unfairness`,'violet'),
      metricCard('Hard guards',fmt(guards,0),`${fmt(metric(pair.supervised,'guard_bound_violations'),0)} bound violations`,guards?'amber':'mint')
    ].join('');
    renderPairedColumns('fairness-comparison-chart',pairs,'legacy_jains_waiting_index',{maximum:1,digits:3});
    renderPairedColumns('starvation-comparison-chart',pairs,'legacy_starvation_count',{digits:0,unit:' processes'});
    renderMlColumns(pairs);
    const fairnessClass=fairnessDelta>=0?'good':'bad'; const starvationClass=starvedDelta<=0?'good':'bad';
    document.getElementById('fairness-pair-detail').innerHTML=`<h2>${esc(pair.base)} vs ${esc(pair.base)}+HNWF</h2><p>Exact result for the selected algorithm pair on the current workload and seed.</p><div class="pair-result-list"><div class="pair-result ${fairnessClass}"><span>Jain fairness</span><strong>${fmt(fairnessBefore,3)} → ${fmt(fairnessAfter,3)} (${signed(fairnessDelta,3)})</strong></div><div class="pair-result ${starvationClass}"><span>Starved processes</span><strong>${fmt(starvedBefore,0)} → ${fmt(starvedAfter,0)} (${signed(starvedDelta,0)})</strong></div><div class="pair-result ${waitDelta<=0?'good':'bad'}"><span>Average waiting time</span><strong>${fmt(waitBefore)} → ${fmt(waitAfter)} ms (${signed(waitDelta,1,' ms')})</strong></div><div class="pair-result"><span>Supervisor actions</span><strong>${starvationInterventions+unfairnessInterventions} ML · ${guards} guards · ${fmt(metric(pair.supervised,'fairness_overrides'),0)} overrides</strong></div></div><small class="pair-detail-note">ML intervention values count scheduling decisions triggered by each risk model; they are not probability scores or unique-process counts. Starvation uses the same threshold for both members of the pair.</small>`;
    document.querySelectorAll('[data-fairness-base]').forEach(node=>node.addEventListener('click',()=>focusFairnessPair(node.dataset.fairnessBase)));
  }

  function selectProcessAlgorithm(name) {
    if(!isSupervised(name)||!response?.results?.[name])return;
    activeAlgorithm=name; fairnessBase=baseName(name);
    const processes=response.results[name].processes||[];
    if(!processes.some(process=>process.pid===selectedPid))selectedPid=processes[0]?.pid||selectedPid;
    renderAll(); route('process');
  }

  function renderProcess() {
    const result=hnwf();
    const algorithmSelect=document.getElementById('process-algorithm-select');
    const supervisedPolicies=baseAlgorithms.map(name=>`${name}+HNWF`).filter(name=>response?.results?.[name]);
    if(!result){document.getElementById('process-policy-name').textContent='Supervisor disabled';algorithmSelect.innerHTML='<option>No supervised algorithm available</option>';document.getElementById('process-select').innerHTML='<option>No supervised process trace</option>';document.getElementById('process-position').textContent='';document.getElementById('state-orbit').innerHTML='<div class="chart-empty">Enable the HNWF supervisor in Simulation.</div>';document.getElementById('state-metrics').innerHTML='';document.getElementById('formula-steps').innerHTML='';document.getElementById('why-card').innerHTML='<h3>No fairness story</h3><p>This run contains base schedulers only.</p>';return}
    const processes=[...(result.processes||[])].sort((a,b)=>(Number(String(a.pid).replace(/\D/g,''))||0)-(Number(String(b.pid).replace(/\D/g,''))||0)); const process=selectedProcess(); if(!process)return;
    const policy=result.configuration?.policy||supervisedName(activeAlgorithm); const base=result.configuration?.base_algorithm||baseName(policy);
    document.getElementById('process-policy-name').textContent=policy;
    algorithmSelect.innerHTML=supervisedPolicies.map(name=>`<option value="${esc(name)}" ${name===policy?'selected':''}>${esc(name)}</option>`).join('');
    algorithmSelect.onchange=()=>selectProcessAlgorithm(algorithmSelect.value);
    const processIndex=Math.max(0,processes.findIndex(item=>item.pid===process.pid));
    const processSelect=document.getElementById('process-select');
    processSelect.innerHTML=processes.map(item=>`<option value="${esc(item.pid)}" ${item.pid===process.pid?'selected':''}>${esc(item.pid)} — arrival ${fmt(item.arrival,0)} ms · burst ${fmt(item.burst,0)} ms</option>`).join('');
    processSelect.onchange=()=>selectPid(processSelect.value,false);
    document.getElementById('process-position').textContent=`Process ${processIndex+1} of ${processes.length}`;
    const previous=document.getElementById('process-prev'); const next=document.getElementById('process-next');
    previous.disabled=processIndex===0; next.disabled=processIndex===processes.length-1;
    previous.onclick=()=>processIndex>0&&selectPid(processes[processIndex-1].pid,false);
    next.onclick=()=>processIndex<processes.length-1&&selectPid(processes[processIndex+1].pid,false);
    document.getElementById('state-title').textContent=`${process.pid} journey in state space`;
    const candidateRows=(result.fairness_trace||[]).flatMap(decision=>(decision.candidates||[]).filter(candidate=>candidate.pid===process.pid).map(candidate=>({...candidate,time:decision.time})));
    const maxStarvation=Math.max(0,...candidateRows.map(candidate=>Number(candidate.starvation_probability)||0));
    const maxUnfairness=Math.max(0,...candidateRows.map(candidate=>Number(candidate.unfairness_probability)||0));
    const interventions=(result.fairness_trace||[]).filter(decision=>decision.selected_pid===process.pid&&decision.overridden).length;
    const baseProposals=(result.fairness_trace||[]).filter(decision=>decision.base_proposed_pid===process.pid).length;
    const checkpoints=[
      {name:'ARRIVE',value:`${fmt(process.arrival,0)} ms`,color:'#59e8fa'},
      {name:'BASE PROPOSAL',value:`${baseProposals} time${baseProposals===1?'':'s'}`,color:'#65a3ff'},
      {name:'RISK MODEL',value:`S ${fmt(maxStarvation,2)} · U ${fmt(maxUnfairness,2)}`,color:'#a572ff'},
      {name:'FAIRNESS STATE',value:`Debt ${signed(process.final_fairness_debt,2,' ms')}`,color:'#ff5ea8'},
      {name:'SUPERVISOR',value:`${interventions} intervention${interventions===1?'':'s'}`,color:'#ffc856'},
      {name:'DISPATCH',value:`CPU ${fmt(process.actual_service,0)} ms`,color:'#48f5ba'}
    ];
    document.getElementById('state-orbit').innerHTML=`<div class="orbit-ring"></div><div class="orbit-ring inner"></div><div class="orbit-core"></div>${checkpoints.map((checkpoint,index)=>`<button class="state-node ${index===4?'active':''}" style="--node-color:${checkpoint.color}" data-state="${esc(checkpoint.name)}" data-value="${esc(checkpoint.value)}" aria-label="${esc(checkpoint.name)}: ${esc(checkpoint.value)}" title="${esc(checkpoint.name)} · ${esc(checkpoint.value)}"><span>${esc(checkpoint.name)}</span><em>${esc(checkpoint.value)}</em></button>`).join('')}`;
    document.querySelectorAll('.state-node').forEach(node=>node.addEventListener('click',()=>showToast(`${process.pid} · ${node.dataset.state}: ${node.dataset.value}`)));
    const items=[['Arrival',`${fmt(process.arrival,0)} ms`],['Response',`${fmt(process.response)} ms`],['Nice',`${process.nice>=0?'+':''}${fmt(process.nice,0)}`],['Weight',fmt(process.weight,0)],['Max starvation risk',fmt(maxStarvation,3)],['Max unfairness risk',fmt(maxUnfairness,3)],['Fairness debt',`${fmt(process.final_fairness_debt,2)} ms`],['Service gap',`${fmt(process.max_service_gap)} ms`],['Interventions',fmt(interventions,0)]];
    document.getElementById('state-metrics').innerHTML=items.map(([label,value],index)=>`<div class="state-metric"><small>${label}</small><strong style="color:${colors[index%colors.length]}">${value}</strong></div>`).join('');
    const debt=process.final_fairness_debt||0;
    const firstCpu=Number(process.arrival||0)+Number(process.response||0);
    const steps=[
      ['1','Arrival',`Arrived at ${fmt(process.arrival,0)} ms with ${fmt(process.burst,0)} ms burst and priority ${fmt(process.priority,0)}.`],
      ['2',`${base} proposal`,`${base} proposed ${process.pid} ${baseProposals} time${baseProposals===1?'':'s'}.`],
      ['3','ML risk',`Peak starvation ${fmt(maxStarvation,3)}; peak unfairness ${fmt(maxUnfairness,3)}.`],
      ['4','Fairness state',`Nice ${process.nice>=0?'+':''}${fmt(process.nice,0)}, weight ${fmt(process.weight,0)}, final debt ${signed(debt,2,' ms')}.`],
      ['5','HNWF action',`${interventions} intervention${interventions===1?'':'s'} selected ${process.pid}; ${fmt(process.guard_activations,0)} hard guard${process.guard_activations===1?'':'s'}.`],
      ['6','Completion',`First CPU at ${fmt(firstCpu,0)} ms; completed at ${fmt(process.completion,0)} ms after waiting ${fmt(process.waiting)} ms.`]
    ];
    document.getElementById('formula-steps').innerHTML=steps.map(step=>`<div class="formula-step"><span>${step[0]}</span><div><strong>${step[1]}</strong><p>${step[2]}</p></div></div>`).join('');
    const action=interventions?`HNWF selected it through ${interventions} fairness intervention${interventions===1?'':'s'}.`:`HNWF did not need to override ${base} to select it.`;
    document.getElementById('why-card').innerHTML=`<h3>${esc(process.pid)} in short</h3><p class="process-summary-lead">Under ${esc(policy)}, ${esc(process.pid)} reached starvation risk ${fmt(maxStarvation,3)} and unfairness risk ${fmt(maxUnfairness,3)}. ${action}</p><div class="pair-result-list"><div class="pair-result"><span>Base proposals</span><strong>${baseProposals}</strong></div><div class="pair-result"><span>HNWF interventions / guards</span><strong>${interventions} / ${fmt(process.guard_activations,0)}</strong></div><div class="pair-result"><span>Wait / turnaround</span><strong>${fmt(process.waiting)} / ${fmt(process.turnaround)} ms</strong></div></div>`;
  }

  function selectPid(pid,navigate=true) { selectedPid=pid; renderSimulation(); renderFairness(); renderProcess(); if(navigate)route('process'); }
  function renderAll(){renderKpis();renderOverviewChart();renderOverviewSide();renderSimulation();renderFairness();renderProcess()}

  async function loadSimulation(overrides={}) {
    const submit=document.querySelector('.run-button'); if(submit)submit.disabled=true;
    stopPlayback(); playbackTime=0;
    try {
      const selectedAlgorithms=overrides.algorithms||algorithms;
      const state=await window.SchedulerStore.run({workload:overrides.workload||'normal',seed:overrides.seed??0,algorithms:selectedAlgorithms,quantum:Number(overrides.quantum||2),hnwf:{gmax:Number(overrides.gmax||32),protected_quantum:1,boost_interval:8,max_boost:4,debt_epsilon:.25,context_switch_cost:0}});
      response=state.response; activeAlgorithm=response.results[activeAlgorithm]?activeAlgorithm:(Object.keys(response.results).find(name=>isSupervised(name))||Object.keys(response.results)[0]); const processes=(hnwf()||activeResult()).processes||[]; selectedPid=processes[2]?.pid||processes[0]?.pid; metricAlgorithms=new Set(Object.keys(response.results)); setLive(true); showToast(`Compared ${Object.keys(response.results).length} policy results on the same workload.`);
    } catch (error) {
      response=demoResponse(); selectedPid='P3'; setLive(false); showToast('Backend unavailable — showing clearly marked demo data.');
    } finally { if(submit)submit.disabled=false; renderAll(); }
  }

  function bind() {
    document.querySelectorAll('.nav-pill').forEach(button=>button.addEventListener('click',()=>route(button.dataset.view)));
    document.getElementById('metric-tabs').addEventListener('click',(event)=>{const button=event.target.closest('button[data-metric]');if(!button)return;document.querySelectorAll('#metric-tabs button').forEach(item=>item.classList.remove('active'));button.classList.add('active');selectedMetric=button.dataset.metric;renderOverviewChart()});
    document.getElementById('simulation-form').addEventListener('submit',(event)=>{event.preventDefault();const selectedBases=Array.from(document.querySelectorAll('input[name="base-algorithm"]:checked')).map(input=>input.value);if(!selectedBases.length){showToast('Select at least one base scheduler.');return}const compareFairness=document.getElementById('control-fairness').checked;const selectedAlgorithms=compareFairness?selectedBases.flatMap(name=>[name,`${name}+HNWF`]):selectedBases;loadSimulation({workload:document.getElementById('control-workload').value,seed:Number(document.getElementById('control-seed').value),quantum:Number(document.getElementById('control-quantum').value),gmax:Number(document.getElementById('control-gmax').value),algorithms:selectedAlgorithms})});
    document.getElementById('control-focus-algorithm').addEventListener('change',(event)=>selectAlgorithm(event.target.value));
    document.getElementById('playback-toggle').addEventListener('click',togglePlayback);
    document.getElementById('playback-reset').addEventListener('click',()=>{stopPlayback();playbackTime=0;updatePlaybackUi()});
    document.getElementById('playback-step').addEventListener('click',()=>{stopPlayback();playbackTime+=1;updatePlaybackUi()});
    document.getElementById('playback-speed').addEventListener('change',(event)=>{playbackSpeed=Number(event.target.value)||1});
    document.getElementById('playback-range').addEventListener('input',(event)=>{stopPlayback();playbackTime=Number(event.target.value)||0;updatePlaybackUi()});
    window.addEventListener('hashchange',()=>{const target=location.hash.slice(1);if(['overview','simulation','fairness','process'].includes(target))route(target)});
  }

  document.addEventListener('DOMContentLoaded',()=>{bind();const initial=location.hash.slice(1);route(['overview','simulation','fairness','process'].includes(initial)?initial:'overview');response=demoResponse();renderAll();loadSimulation()});
})(window, document);

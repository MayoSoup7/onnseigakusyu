const DB='eigomimi-v3',VER=1;let db;
const $=id=>document.getElementById(id);
let state={lesson:1,book:false,current:null,queue:[],idx:-1,repeat:false,gap:0,A:null,B:null,ab:false,editing:null,recording:null};
const audio=new Audio(); audio.preload='metadata';
function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
async function all(store){return req(tx(store).getAll())}
async function get(store,key){return req(tx(store).get(key))}
async function put(store,v){try{return await req(tx(store,'readwrite').put(v))}catch(e){console.error('IndexedDB保存エラー',e);throw e}}
async function del(store,key){return req(tx(store,'readwrite').delete(key))}
function uid(){return crypto.randomUUID()}
function fmt(s){if(!isFinite(s))return'0:00';s=Math.max(0,s);return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0')}
function blobUrl(blob){return URL.createObjectURL(blob)}
function openDB(){return new Promise((res,rej)=>{let r=indexedDB.open(DB,VER);r.onupgradeneeded=e=>{let d=e.target.result;for(const s of ['lessons','pages','audios','practices','recordings'])if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:'id'});};r.onsuccess=()=>{db=r.result;res()};r.onerror=()=>rej(r.error)})}
async function seed(){for(let i=1;i<=26;i++){if(!await get('lessons','L'+i))await put('lessons',{id:'L'+i,num:i,title:`Lesson ${String(i).padStart(2,'0')}`,name:''})}}
function lessonLabel(n){return`Lesson ${String(n).padStart(2,'0')}`}
async function init(){await openDB();await seed();fillLessons();await renderLesson();setup()}
function fillLessons(){ if(!$('lessonSelect').options.length){$('lessonSelect').innerHTML=Array.from({length:26},(_,i)=>`<option value="${i+1}">${lessonLabel(i+1)}</option>`).join('')} $('lessonSelect').value=state.lesson; updateLessonUI() }
function updateLessonUI(){ const label=lessonLabel(state.lesson); $('lessonTitle').innerHTML=`<div class="currentLesson"><span>現在選択中</span><strong>${label}</strong></div>`; $('addPageBtn').textContent=`＋${label}にページ画像`; $('addAudioBtn').textContent=`＋${label}に音声`; }
async function renderLesson(){
  state.book=false;
  $('bookView').hidden=true;
  $('pages').hidden=false;
  $('editToolbar').hidden=false;
  updateLessonUI();
  let pages=(await all('pages')).filter(p=>p.lesson===state.lesson).sort((a,b)=>a.order-b.order);
  // Lessonの最初のページだけを標準表示。2ページ目以降は「解説」として非表示扱い。
  if(pages.length && pages.some(p=>p.visible===undefined)){
    for(const p of pages){
      if(p.visible===undefined){p.visible=(p.order===0);await put('pages',p)}
    }
  }
  $('pages').innerHTML=pages.filter(p=>p.visible!==false).map(p=>pageHTML(p)).join('')
    || `<div class="page"><p>表示中のページがありません。</p></div>`;
  await renderHiddenPages(pages);
  await renderAudioManager();
}
function pageHTML(p){
  let url=mediaUrl(p);
  return `<article class="page" data-page="${p.id}">
    <div class="pageHead"><span class="pageNum">P.${p.pageNo||'—'}</span>
      <div><button onclick="togglePage('${p.id}')">🙈 隠す</button><button onclick="addPractice('${p.id}')">＋Practice</button></div>
    </div>
    ${url?`<img src="${url}" alt="">`:''}
    <div id="prs-${p.id}"></div>
  </article>`;
}
async function renderHiddenPages(pages){
  let hidden=pages.filter(p=>p.visible===false);
  if(!hidden.length){$('hiddenPages').innerHTML='';return}
  $('hiddenPages').innerHTML=`<section class="hiddenBox">
    <strong>🙈 非表示の解説ページ</strong>
    <div class="hiddenHint">隠したページはここからいつでも再表示できます。</div>
    ${hidden.map(p=>`<div class="hiddenRow"><span>P.${p.pageNo||'—'} ${esc(p.name||'')}</span><button onclick="togglePage('${p.id}')">👁 再表示</button></div>`).join('')}
  </section>`;
}
async function renderAudioManager(){
  let audios=(await all('audios')).filter(a=>a.lesson===state.lesson).sort((a,b)=>a.order-b.order);
  if(!audios.length){$('audioManager').innerHTML='';return}
  $('audioManager').innerHTML=`<section class="audioBox">
    <strong>🔊 このLessonの音声</strong>
    ${audios.map(a=>`<div class="audioRow"><span>${esc(a.name)}</span><button class="danger" onclick="deleteAudio('${a.id}')">🗑️ 削除</button></div>`).join('')}
  </section>`;
}
async function addPractice(pageId){let p={id:uid(),pageId,lesson:state.lesson,name:'Practice',audioId:null};await put('practices',p);await rerender();await editPractice(p.id)}
async function editPractice(id){state.editing=id;let p=await get('practices',id);$('practiceName').value=p.name;$('audioSelect').innerHTML='<option value="">音声なし</option>'+((await all('audios')).filter(a=>a.lesson===state.lesson).sort((a,b)=>a.order-b.order).map(a=>`<option value="${a.id}" ${a.id===p.audioId?'selected':''}>${esc(a.name)}</option>`).join(''));$('editDialog').showModal()}
async function savePractice(){let p=await get('practices',state.editing);p.name=$('practiceName').value||'Practice';p.audioId=$('audioSelect').value||null;await put('practices',p);await rerender()}
async function fileToStoredMedia(file){
  // iPhone Safari/IndexedDBではFileそのものよりArrayBuffer保存の方が安定するため、
  // ファイル本体をArrayBufferとして保存し、表示時にBlobへ戻す。
  return {data:await file.arrayBuffer(),type:file.type||'application/octet-stream',name:file.name||'file'};
}
function mediaBlob(item){
  if(!item)return null;
  if(item.data instanceof ArrayBuffer)return new Blob([item.data],{type:item.type||'application/octet-stream'});
  // v4以前のデータとの互換
  return item.blob || null;
}
function mediaUrl(item){
  const b=mediaBlob(item);
  return b?URL.createObjectURL(b):'';
}
async function addPages(files){
  const list=Array.from(files||[]);
  if(!list.length)return;
  let existing=(await all('pages')).filter(p=>p.lesson===state.lesson);
  let order=existing.length;
  let added=0;
  for(const f of list){
    try{
      const media=await fileToStoredMedia(f);
      await put('pages',{
        id:uid(),lesson:state.lesson,order:order++,
        pageNo:guessPageNo(f.name,order),
        visible:(existing.length===0 && added===0),
        data:media.data,type:media.type,name:media.name
      });
      added++;
    }catch(err){
      console.error(err);
    }
  }
  $('pageFiles').value='';
  await rerender();
  if(added===0) alert('画像を追加できませんでした。写真/ファイルの選択後、もう一度試してください。');
  else alert(added===list.length?`${added}枚のページ画像を追加しました。`:`${added}/${list.length}枚を追加しました。`);
}
function guessPageNo(name,n){let m=name.match(/(?:P|p|page|ページ)[ _-]?(\d+)/);return m?m[1]:n}
async function addAudios(files){
  const list=Array.from(files||[]);
  if(!list.length)return;
  let existing=(await all('audios')).filter(a=>a.lesson===state.lesson);
  let order=existing.length;
  let added=0;
  for(const f of list){
    try{
      const media=await fileToStoredMedia(f);
      await put('audios',{
        id:uid(),lesson:state.lesson,order:order++,
        name:f.name, data:media.data, type:media.type
      });
      added++;
    }catch(err){
      console.error(err);
    }
  }
  $('audioFiles').value='';
  await rerender();
  alert(added===list.length?`${added}個の音声を追加しました。`:`${added}/${list.length}個の音声を追加しました。`);
}
async function playPractice(id){let p=await get('practices',id);if(!p.audioId)return alert('このPracticeには音声が登録されていません。編集から音声を選んでください。');let a=await get('audios',p.audioId);await startAudio(a, p.name)}
async function startAudio(a,label){state.current=a;state.queue=[a];state.idx=0;audio.src=mediaUrl(a);audio.playbackRate=Number($('speed').value);audio.currentTime=0;$('now').textContent=label||a.name;state.A=null;state.B=null;state.ab=false;updateAB();await audio.play()}
function playQueueIndex(i){if(!state.queue[i])return;state.idx=i;let a=state.queue[i];audio.src=mediaUrl(a);audio.currentTime=0;audio.playbackRate=Number($('speed').value);$('now').textContent=a.name;audio.play()}
audio.ontimeupdate=()=>{$('cur').textContent=fmt(audio.currentTime);$('dur').textContent=fmt(audio.duration);$('seek').value=audio.duration?(audio.currentTime/audio.duration*1000):0;if(state.ab&&state.B!==null&&audio.currentTime>=state.B){audio.currentTime=state.A||0;audio.play()}};
audio.onended=async()=>{if(state.ab)return;if(state.repeat){audio.currentTime=state.A||0;await audio.play();return}let gap=Number($('gap').value)||0;if(gap)await new Promise(r=>setTimeout(r,gap*1000));if(state.idx+1<state.queue.length)playQueueIndex(state.idx+1)};
$('play').onclick=()=>audio.paused?audio.play():audio.pause();
audio.onplay=()=>$('play').textContent='⏸';audio.onpause=()=>$('play').textContent='▶️';
$('seek').oninput=()=>{if(audio.duration)audio.currentTime=Number($('seek').value)/1000*audio.duration};
$('restart').onclick=()=>{audio.currentTime=state.A||0;audio.play()};$('prev').onclick=()=>playQueueIndex(Math.max(0,state.idx-1));$('next').onclick=()=>playQueueIndex(Math.min(state.queue.length-1,state.idx+1));$('repeat').onclick=()=>{state.repeat=!state.repeat;$('repeat').style.background=state.repeat?'#ffd2ea':''};
$('speed').onchange=()=>audio.playbackRate=Number($('speed').value);
$('setA').onclick=()=>{state.A=audio.currentTime;updateAB()};$('setB').onclick=()=>{state.B=audio.currentTime;updateAB()};$('ab').onclick=()=>{state.ab=!state.ab;if(state.ab&&state.A===null)state.A=audio.currentTime;if(state.ab&&state.B===null)state.B=audio.duration;updateAB()};
function updateAB(){$('markA').textContent='A:'+(state.A===null?'—':fmt(state.A));$('markB').textContent='B:'+(state.B===null?'—':fmt(state.B));$('ab').textContent=state.ab?'A-B ON':'A-B OFF'}
async function recordPractice(id){state.recording=id;let p=await get('practices',id);$('recordTarget').textContent=p.name;$('recordDialog').showModal();let rs=(await all('recordings')).filter(r=>r.practiceId===id).sort((a,b)=>b.created-b.created)[0];if(rs){$('ownAudio').src=blobUrl(rs.blob);$('ownAudio').hidden=false;$('deleteRecording').hidden=false}else{$('ownAudio').hidden=true;$('deleteRecording').hidden=true}}
let rec, chunks=[];
$('recordStart').onclick=async()=>{try{let stream=await navigator.mediaDevices.getUserMedia({audio:true});rec=new MediaRecorder(stream);chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};rec.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());let blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});await put('recordings',{id:uid(),practiceId:state.recording,created:Date.now(),blob});$('ownAudio').src=blobUrl(blob);$('ownAudio').hidden=false;$('deleteRecording').hidden=false;$('recordState').textContent='保存しました';};rec.start();$('recordStart').disabled=true;$('recordStop').disabled=false;$('recordState').textContent='録音中…';let p=await get('practices',state.recording);if(p.audioId){let a=await get('audios',p.audioId);audio.src=mediaUrl(a);audio.currentTime=0;audio.play()}}catch(e){alert('マイクを許可できませんでした。iPhoneではHTTPSのページでマイクを許可してください。')}};
$('recordStop').onclick=()=>{if(rec&&rec.state!=='inactive')rec.stop();$('recordStart').disabled=false;$('recordStop').disabled=true};
$('refOnly').onclick=()=>{audio.play()};$('ownOnly').onclick=()=>{if($('ownAudio').src)$('ownAudio').play()};$('bothPlay').onclick=()=>{audio.play();$('ownAudio').play()};
$('deleteRecording').onclick=async()=>{let rs=(await all('recordings')).filter(r=>r.practiceId===state.recording);for(const r of rs)await del('recordings',r.id);$('ownAudio').hidden=true;$('deleteRecording').hidden=true};
$('closeRecord').onclick=()=>{$('recordDialog').close()};
$('addPageBtn').onclick=()=>{ if(state.book)return; $('pageFiles').value=''; $('pageFiles').click(); };$('pageFiles').onchange=e=>addPages(e.target.files);
$('addAudioBtn').onclick=()=>{ if(state.book)return; $('audioFiles').value=''; $('audioFiles').click(); };$('audioFiles').onchange=e=>addAudios(e.target.files);
$('lessonSelect').onchange=async e=>{state.lesson=Number(e.target.value)||1;updateLessonUI();await rerender()};
$('bookBtn').onclick=async()=>{
  if(state.book){
    await renderLesson();
    $('bookBtn').textContent='📖 本を読む';
    return;
  }
  state.book=true;
  $('editToolbar').hidden=true;
  $('lessonTitle').innerHTML='';
  $('addPageBtn').disabled=true;$('addAudioBtn').disabled=true;
  $('pages').hidden=true;
  $('hiddenPages').innerHTML='';
  $('audioManager').innerHTML='';
  $('bookView').hidden=false;
  $('bookView').className='bookMode';
  let pages=(await all('pages')).filter(p=>p.visible!==false).sort((a,b)=>a.lesson-b.lesson||a.order-b.order);
  let last=0;
  $('bookView').innerHTML=`<div class="bookHeader"><h2>📖 英語耳を読む</h2><button onclick="closeBook()">✏️ 編集に戻る</button></div>`+
    (pages.map(p=>{
      let h=p.lesson!==last?`<div class="lessonHeader">${lessonLabel(p.lesson)}</div>`:'';
      last=p.lesson;
      return h+pageHTML(p);
    }).join('')||'<div class="page">ページがありません。</div>');
  await loadPracticesBook();
  $('bookBtn').textContent='✏️ 編集に戻る';
};
async function closeBook(){
  state.book=false;
  $('addPageBtn').disabled=false;$('addAudioBtn').disabled=false;
  await renderLesson();
  $('bookBtn').textContent='📖 本を読む';
}
async function loadPracticesBook(){
  let prs=await all('practices');
  for(const p of prs){
    let el=document.querySelector(`#prs-${p.pageId}`);
    if(!el)continue;
    let au=p.audioId?await get('audios',p.audioId):null;
    el.innerHTML+=`<div class="practice"><div class="practiceTop"><span class="practiceName">${esc(p.name)}</span>
      <div class="practiceBtns"><button onclick="playPractice('${p.id}')">▶️</button><button onclick="recordPractice('${p.id}')">🎙️</button></div></div>
      <div class="audioChip">${au?esc(au.name):'音声未登録'}</div></div>`;
  }
}
function setup(){$('savePractice').onclick=e=>{e.preventDefault();savePractice();$('editDialog').close()}}
window.togglePage=togglePage;window.addPractice=addPractice;window.editPractice=editPractice;window.playPractice=playPractice;window.recordPractice=recordPractice;window.deleteAudio=deleteAudio;window.closeBook=closeBook;
init();
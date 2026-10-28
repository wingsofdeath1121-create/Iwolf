(() => {
  const KEY = 'iwolf-six-screen-demo';
  const roles = {
    seer: {name:'Tiên Tri', image:'Tien tri.png', text:'Mỗi đêm chọn một người để xem họ thuộc phe Dân hay phe Sói.'},
    witch: {name:'Phù Thủy', image:'phu thuy.jpg', text:'Chờ danh sách người thực sự chết để quyết định có dùng bình cứu.'},
    wolf: {name:'Ma Sói', image:'ma soi.jpg', text:'Trao đổi kín với phe Sói rồi thống nhất một mục tiêu cắn.'},
    angel: {name:'Thiên Sứ', image:'thien su.jpg', text:'Chọn một người để bảo hộ trong đêm; không tự bảo hộ.'},
    villager: {name:'Thường Dân', image:'dan thuong.jpg', text:'Không có hành động đêm; hãy xem Speaking và trao đổi với dân làng.'}
  };
  const screen = document.getElementById('screen');
  const letter = new URLSearchParams(location.search).get('player')?.toUpperCase() || 'A';
  const role = {A:'seer',B:'witch',C:'wolf',D:'angel',E:'villager',F:'villager'}[letter] || 'villager';
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  };
  function seed() {
    const letters=['A','B','C','D','E','F'], roleList=['seer','witch','wolf','angel','villager','villager'];
    const state={phase:'night',day:1,testMode:true,question:'Describe a skill you would like to learn.',messages:[],players:letters.map((id,i)=>({id,name:`Player ${id}`,role:roleList[i],alive:true,score:7,action:null}))};
    localStorage.setItem(KEY,JSON.stringify(state)); return state;
  }
  let state=read() || seed();
  function save(next) { localStorage.setItem(KEY,JSON.stringify({...next,updatedAt:Date.now()})); }
  function activeRole() { return roles[role] || roles.villager; }
  function rolePrompt(current) {
    if(current==='seer') return 'Chọn một biểu tượng người chơi để soi. Kết quả mô phỏng sẽ chỉ hiện trên màn hình Tiên Tri.';
    if(current==='wolf') return 'Chọn mục tiêu cắn và gửi tin nhắn trong kênh Sói. Kênh này chỉ hiện ở góc nhìn phe Sói.';
    if(current==='angel') return 'Chọn người để bảo hộ. Đây là lựa chọn mô phỏng, chưa chạy bộ phân xử luật thật.';
    if(current==='witch') return 'Đêm này chưa có người chết được phân xử; chờ quản trò chuyển sang phần công bố.';
    return 'Bạn không có năng lực đêm. Hãy xem câu hỏi Speaking và trò chuyện với cả làng.';
  }
  function render() {
    state=read() || seed();
    const me=state.players.find(p=>p.id===letter) || {id:letter,name:`Player ${letter}`,role,alive:true,score:7,action:null};
    const meta=activeRole(), night=state.phase==='night', bg=night?'Đêm BG.jpeg':'BG Ngày Thường.jpeg';
    const canTarget=night && ['seer','wolf','angel','hunter'].includes(role);
    const roster=state.players.map(p=>`<button class="person ${p.id===letter?'me':''} ${me.action?.target===p.id?'selected':''}" data-target="${p.id}" ${canTarget&&p.alive&&p.id!==letter?'':'disabled'} aria-pressed="${me.action?.target===p.id?'true':'false'}"><span class="portrait">${p.id===letter?'✦':p.id}</span><span>${esc(p.name)}${p.id===letter?' · BẠN':''}</span><small>${canTarget&&p.id!==letter?'CHỌN MỤC TIÊU':''}</small></button>`).join('');
    const targets=state.players.filter(p=>p.alive && p.id!==letter).map(p=>`<button class="target ${me.action?.target===p.id?'selected':''}" data-target="${p.id}">${esc(p.name)}</button>`).join('');
    const actionName=role==='seer'?'SOI NGƯỜI NÀY':role==='wolf'?'BỎ PHIẾU CẮN':role==='angel'?'BẢO HỘ NGƯỜI NÀY':'GỬI LỰA CHỌN';
    const actionPanel=night && ['seer','wolf','angel','hunter'].includes(role)?`<p class="status">Có thể chọn từ hàng người chơi phía trên hoặc các nút bên dưới.</p><div class="targets">${targets}</div><button class="btn" id="submitAction" ${me.action?.target?'':'disabled'}>${me.action?.submitted?'ĐÃ GỬI HÀNH ĐỘNG':actionName}</button>${me.action?.target?`<span class="notice">Đã chọn ${esc(state.players.find(p=>p.id===me.action.target)?.name||'')}${me.action?.submitted?' · đã gửi':''}</span>`:''}`:'';
    const conversation=(state.messages||[]).filter(m=>night?(role==='wolf'&&m.channel==='wolves'):m.channel==='village').map(m=>`<p><b>${esc(m.player)}:</b> ${esc(m.text)}</p>`).join('') || '<p>Chưa có tin nhắn trong lượt này.</p>';
    const quickReplies=['Tôi muốn cắn số 1','Đêm nay không cắn, tung hỏa mù cho bọn dân bị rối.','Sáng mai hãy treo cổ tôi làm vật thế thân.','Xin lỗi, tôi ấn nhầm. Hihi.','Đừng ngó nghiêng, lộ đó!','Chat ít thôi, lộ đó.'];
    const chatPanel=night?(role==='wolf'?`<div class="chat-log" id="wolfChat">${conversation}</div><div class="quick-replies">${quickReplies.map(text=>`<button type="button" class="quick-reply" data-quick-reply="${esc(text)}">${esc(text)}</button>`).join('')}</div><div class="chat-form"><input id="wolfMessage" maxlength="300" placeholder="Tin nhắn riêng phe Sói…"><button class="btn" id="sendWolf">GỬI</button></div>`:'<p class="night-chat-closed">Ban đêm, phe Dân không có khung chat và không thể gửi tin nhắn.</p>'):`<div class="chat-log">${conversation}</div><div class="chat-form"><input id="villageMessage" maxlength="300" placeholder="Tin nhắn cho cả làng…"><button class="btn secondary" id="sendVillage">CHAT</button></div>`;
    const players=state.players.map(p=>`<div class="player-line">${esc(p.name)}${p.id===letter?' · bạn':''}<span class="score">${p.alive?'7.0 · ✓':'đã rời ván'}</span></div>`).join('');
    const dayView=!night?`<section class="day-view"><div class="day-card"><h3>Thảo luận ban ngày</h3><p class="status">Cả làng đang trao đổi. Tin nhắn trong kênh làng được đồng bộ tới sáu tab mô phỏng.</p><label>Chọn người để bỏ phiếu<select id="voteTarget"><option value="">Chọn người chơi…</option>${state.players.filter(p=>p.alive&&p.id!==letter).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><button class="btn" id="sendVote">GỬI LÁ PHIẾU</button></div><div class="day-card"><h3>Kết quả lượt</h3><div class="player-list">${players}</div></div></section>`:'';
    screen.innerHTML=`<div class="scene" style="background-image:url('assets/${bg}')"><main class="app"><header class="top"><div class="brand">IWOLF <small>GÓC NHÌN NGƯỜI CHƠI · MÔ PHỎNG</small></div><div class="badges"><span class="badge">${esc(state.phase==='night'?'ĐÊM '+state.day:'BAN NGÀY')}</span><span class="badge">Player ${letter} · ${esc(meta.name)}</span><span class="badge">TEST · 7.0 TỰ ĐỘNG</span></div></header><p class="sim-warning">Tab riêng Player ${letter}. Các tab cùng trình duyệt chia sẻ trạng thái mô phỏng bằng localStorage; không ghi vào Supabase.</p><nav class="roster">${roster}</nav><div class="grid"><section class="panel speaking"><h2>IELTS SPEAKING · CÂU HỎI CỦA LƯỢT</h2><div class="question">${esc(state.question)}</div><div class="rule"></div><div class="pass">✓ <span>ĐẠT TỰ ĐỘNG</span> <strong>7.0</strong></div><p class="status">Test Game Function đang bật. Player ${letter} không cần nói hoặc gửi câu trả lời.</p>${chatPanel}</section><section class="panel ability"><div class="role-head"><img class="role-img" src="assets/${esc(meta.image)}" alt=""><div><div class="role-name">${esc(me.name)} · ${esc(meta.name)}</div><div class="role-desc">${esc(meta.text)}</div></div></div><div class="role-note"><b>${night?'HÀNH ĐỘNG BAN ĐÊM':'GIAI ĐOẠN BAN NGÀY'}</b><br>${esc(rolePrompt(role))}</div>${actionPanel}${role==='witch'&&night?'<p class="status">Ở bản mô phỏng này, chưa có danh sách tử vong. Nút cứu sẽ xuất hiện khi phần xử lý được bổ sung.</p>':''}<div class="host-controls"><span class="notice">ĐIỀU KHIỂN PHA MÔ PHỎNG</span><button class="btn secondary" data-phase="night">MỞ GIAO DIỆN ĐÊM</button><button class="btn secondary" data-phase="discussion">CHUYỂN SANG THẢO LUẬN</button><button class="btn secondary" data-phase="vote">MỞ BỎ PHIẾU</button><button class="btn secondary" id="resetNight">LÀM MỚI LƯỢT ĐÊM</button></div></section>${dayView}</div><div class="bottom"><section class="panel"><h3>Dân làng · ${state.players.filter(p=>p.alive).length}/6</h3><div class="player-list">${players}</div></section><section class="panel"><h3>Báo cáo Speaking chung</h3><div class="player-list">${players}</div><p class="notice">Bản mô phỏng: mọi người đạt 7.0 tự động. Điểm này không phải kết quả chấm IELTS.</p></section></div></main></div>`;
  }
  screen.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.hasAttribute('data-quick-reply')){const input=screen.querySelector('#wolfMessage');if(input){input.value=button.dataset.quickReply;input.focus()}return}
    if(button.hasAttribute('data-target')){if(button.disabled)return;const next=read()||state;const p=next.players.find(x=>x.id===letter);if(p){p.action={kind:role,target:button.dataset.target};save(next);render()}return}
    if(button.id==='submitAction'){const next=read()||state;const p=next.players.find(x=>x.id===letter);if(p?.action?.target){p.action.submitted=true;save(next);render()}return}
    if(button.id==='sendWolf'){sendMessage('wolves','wolfMessage');return}
    if(button.id==='sendVillage'){sendMessage('village','villageMessage');return}
    if(button.id==='sendVote'){const target=screen.querySelector('#voteTarget')?.value;if(!target)return;const next=read()||state;const p=next.players.find(x=>x.id===letter);if(p){p.action={kind:'vote',target};save(next);render()}return}
    if(button.hasAttribute('data-phase')){const next=read()||state;next.phase=button.dataset.phase;save(next);render();return}
    if(button.id==='resetNight'){const next=read()||state;next.phase='night';next.players.forEach(p=>p.action=null);next.messages=[];save(next);render()}
  });
  function sendMessage(channel,inputId){const input=screen.querySelector(`#${inputId}`);const text=input?.value.trim();if(!text)return;const next=read()||state;next.messages=next.messages||[];next.messages.push({player:`Player ${letter}`,channel,text,at:Date.now()});save(next);render()}
  window.addEventListener('storage',event=>{if(event.key===KEY)render()});
  render();
})();

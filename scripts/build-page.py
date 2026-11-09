# Builds public/w/index.html from the design preview file (path as argv[1]).
import sys
src=open(sys.argv[1]).read()
head='''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Studio Aa</title>
'''
body_start=src.index('<link rel="stylesheet"')
style_end=src.index('</style>')+len('</style>')
styles=src[body_start:style_end]
markup=src[style_end:src.index('<script>')]
script=src[src.index('<script>')+len('<script>'):src.rindex('</script>')]
old_state=script[script.index("  var KEY='mach5-ws-"):script.index("  /* requests and its log are always there and always first */")]
script=script.replace(old_state,"""  var SLUG=(location.pathname.split('/')[2]||'').trim();
  var API='/api/w/'+SLUG;
  var state=window.__state;
""")
script=script.replace("""  /* requests and its log are always there and always first */
  (function(){""","""  /* requests and its log are always there and always first */
  function tidy(){""")
script=script.replace("""    state.entries=state.entries.filter(function(e){ return e.text && e.text.trim(); });
  })();""","""    state.entries=state.entries.filter(function(e){ return e.text && e.text.trim(); });
  }
  tidy();""")
old_save=script[script.index("  var saved=document.getElementById('saved'), savedT;"):script.index("  function now(){")]
script=script.replace(old_save,"""  var saved=document.getElementById('saved'), savedT, saveT;
  function save(){
    clearTimeout(saveT);
    saveT=setTimeout(function(){
      fetch(API,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(state)}).then(function(r){
        if(!r.ok) throw new Error('save failed');
        saved.textContent='saved'; saved.classList.add('show'); clearTimeout(savedT); savedT=setTimeout(function(){saved.classList.remove('show')},900);
      }).catch(function(){ saved.textContent='not saved, check your connection'; saved.classList.add('show'); });
    },300);
  }
  /* pick up new texts every 20 seconds */
  function poll(){
    fetch(API,{cache:'no-store'}).then(function(r){return r.json()}).then(function(remote){
      var have={}; state.entries.forEach(function(e){ have[String(e.id)]=e; });
      var fresh=remote.entries.filter(function(e){ return String(e.id).charAt(0)==='s' && !have[String(e.id)]; });
      /* a reply you sent by text arrives as a new line on a request that is already here */
      var lines=false;
      remote.entries.forEach(function(r){ var l=have[String(r.id)]; if(!l||!r.trail) return; var seen={}; (l.trail||[]).forEach(function(x){ if(x.id) seen[x.id]=1; });
        r.trail.forEach(function(x){ if(x.id && !seen[x.id]){ (l.trail=l.trail||[]).push(x); lines=true; } }); });
      if(fresh.length||lines){ state.entries=fresh.concat(state.entries); if(current==='log' && document.getElementById('page').classList.contains('on')) renderLog(); save(); }
    }).catch(function(){});
  }
  setInterval(poll,20000);
  document.addEventListener('visibilitychange',function(){ if(!document.hidden) poll(); });

""")
script=script.replace("""  function sendReply(e,text,cb){ /* preview: no Twilio here, the live site sends it from your number */ setTimeout(function(){ cb(true); },150); }""","""  function sendReply(e,text,cb){ fetch(API+'/reply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:e.from,text:text})}).then(function(r){return r.json()}).then(function(j){ cb(!!j.ok); }).catch(function(){ cb(false); }); }""")
script=script.replace("var n=state.artist||'mach5';","var n=state.artist||SLUG.split('-')[0];")
script=script.replace("state.artist=el.textContent.trim()||state.artist||'mach5';","state.artist=el.textContent.trim()||state.artist||SLUG.split('-')[0];")
boot='''(function(){
  var SLUG=(location.pathname.split('/')[2]||'').trim();
  if(!SLUG){ document.body.innerHTML='<p style="padding:28px;font-family:Inter,sans-serif">no workspace in the link</p>'; return; }
  fetch('/api/w/'+SLUG,{cache:'no-store'}).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }).then(function(doc){
    window.__state=doc; app();
  }).catch(function(){ document.body.innerHTML='<p style="padding:28px;font-family:Inter,sans-serif">could not load this workspace</p>'; });
})();
function app(){'''
script=script.replace('(function(){',boot,1)
idx=script.rstrip().rfind('})();')
script=script[:idx]+'}\n'
out=head+styles+'\n</head>\n<body>'+markup+'<script>'+script+'</script>\n</body>\n</html>\n'
out=out.replace('<meta name="claude:viewport-fit-sides" content="cover">\n','')
open('public/w/index.html','w').write(out)
print('built',len(out))

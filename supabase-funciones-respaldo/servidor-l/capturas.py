import json, hmac, hashlib, base64, time, sys, urllib.request
from playwright.sync_api import sync_playwright
B='https://vista-pantalla.sinpe-pagos.pages.dev'
S=open('/tmp/pantalla/.sec/s').read(); V=open('/tmp/pantalla/.sec/v').read()
ADMIN='cd0a5000-ca9e-4389-a432-6908a80e57d3'
def hm(k,t): return hmac.new(k.encode(),t.encode(),hashlib.sha256).hexdigest()
def b64u(s): return base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')
exp=int(time.time()*1000)+800000
c=b64u(json.dumps({'u':ADMIN,'e':exp},separators=(',',':')))
tok=f'v1.{c}.{hm(V,"v1."+c)}'
def tel(cuerpo):
    t=json.dumps(cuerpo); r=urllib.request.Request(B+'/pantalla',data=t.encode(),headers={'Content-Type':'application/json','X-Signature':hm(S,t),'User-Agent':'Mozilla/5.0 (Linux; Android 13) sinpe-sim'})
    return json.load(urllib.request.urlopen(r))
frame=open('/tmp/pantalla/frames/f0.b64').read()
out=sys.argv[1]
with sync_playwright() as p:
    br=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    for nombre,(w,h) in {'escritorio':(1280,1000),'telefono':(390,844)}.items():
        ctx=br.new_context(viewport={'width':w,'height':h},device_scale_factor=1 if w>500 else 2)
        ctx.add_init_script(f"try{{sessionStorage.setItem('pv_t','{tok}');sessionStorage.setItem('pv_e','{exp}')}}catch(e){{}}")
        pg=ctx.new_page(); pg.goto(B+'/remoto/?empresa=pollos'); pg.wait_for_selector('#saludCuerpo .tel',timeout=20000)
        pg.screenshot(path=f'{out}/{nombre}-inicio.png',full_page=True)
        pg.click('#bAbrir'); pg.wait_for_selector('#vSesion:not(.oculto)',timeout=15000)
        e=tel({'tipo':'pantalla','fase':'escucha','ts':int(time.time()*1000),'empresa':'pollos','app':'2.12.0'})
        tel({'tipo':'pantalla','fase':'cuadro','ts':int(time.time()*1000)+1,'empresa':'pollos','sid':e['sid'],'seq':1,'w':540,'h':1170,'jpg':frame,'pantalla_encendida':True,'bloqueada':False})
        pg.wait_for_selector('#imagen:not(.oculto)',timeout=15000)
        pg.click('button[data-ajuste="instalar_apps"]'); pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{out}/{nombre}-sesion.png',full_page=True)
        pg.click('#bTerminar'); pg.wait_for_timeout(1000); ctx.close()
    br.close()
print('listo')

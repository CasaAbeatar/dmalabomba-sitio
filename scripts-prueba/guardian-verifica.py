# Verifica lo que recibio el servidor falso y la memoria de la app. Sale con codigo 1 si algo falla.
import json, os, re, sys
CAMPOS = ["app", "cargando", "ahorro_bateria", "sin_restriccion_bateria", "red_validada", "tipo_red", "ultimo_sms_ts",
          "ultimo_reenvio_ok_ts", "fallidos_pendientes", "permiso_sms", "notificaciones", "android", "marca_modelo"]
rec = [json.loads(l) for l in open("guardian-recibidos.jsonl")]
estado = open("guardian-estado.xml").read() if len(sys.argv) < 2 else open(sys.argv[1]).read()
t_muerte = float(open("guardian-t-muerte.txt").read()) if __import__("os").path.exists("guardian-t-muerte.txt") else None
res = []
def chk(nombre, cond, extra=""):
    res.append((nombre, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + nombre + (("  [" + str(extra) + "]") if extra else ""))

# Version esperada: la de app/build.gradle (antes estaba escrita a mano y quedaba vieja en cada version nueva).
_g = open("app/build.gradle").read() if os.path.exists("app/build.gradle") else ""
_mvc = re.search(r"versionCode\s*\(.*?:\s*(\d+)\)", _g) or re.search(r"versionCode\s+(\d+)", _g)
_mvn = re.search(r"versionName\s*\(.*?:\s*\"([^\"]+)\"\)", _g) or re.search(r"versionName\s+\"([^\"]+)\"", _g)
VC = _mvc.group(1) if _mvc else "?"
VN = _mvn.group(1) if _mvn else "?"
inst = open("guardian-instalacion.txt").read() if os.path.exists("guardian-instalacion.txt") else ""
chk("la 2.6.0 (versionCode 15) se instalo", "instala-2.6.0: Success" in inst and "versionCode=15" in inst)
chk(f"la {VN} (versionCode {VC}) se instalo ENCIMA de la 2.6.0 sin desinstalar", "actualiza-encima: Success" in inst and f"versionCode={VC}" in inst and f"versionName={VN}" in inst, inst.replace("\n", " | ")[-160:])
lat = [r for r in rec if r["ruta"].startswith("/latido")]
sms = [r for r in rec if r["ruta"].startswith("/sms")]
chk("llegaron latidos", len(lat) >= 2, len(lat))
chk("todas las peticiones llegaron con firma valida", all(r["firma_ok"] for r in rec), f"{sum(r['firma_ok'] for r in rec)}/{len(rec)}")
cuerpos = [json.loads(r["cuerpo"]) for r in lat if r["firma_ok"]]
chk("latido conserva tipo/ts/empresa/telefono/bateria", all(all(k in c for k in ["tipo", "ts", "empresa", "telefono", "bateria"]) and c["tipo"] == "latido" and c["empresa"] == "soda" for c in cuerpos))
chk("latido trae detalle con los 13 campos", all("detalle" in c and all(k in c["detalle"] for k in CAMPOS) for c in cuerpos))
chk(f"detalle.app es {VN}", all(c["detalle"]["app"] == VN for c in cuerpos if "detalle" in c))
NUEVOS = ["senal_nivel", "operador", "sim_estado", "modo_avion", "memoria_libre_mb", "arranque_ts", "bucket_standby", "doze", "latido_retraso_ms", "reinicios_servicio"]
chk("latido trae las 10 mediciones de la 2.8.0", all(all(k in c["detalle"] for k in NUEVOS) for c in cuerpos if "detalle" in c))
chk("las mediciones nuevas tienen valores validos", all(c["detalle"]["memoria_libre_mb"] > 0 and c["detalle"]["arranque_ts"] > 0 and c["detalle"]["sim_estado"] in ("listo", "ausente", "bloqueado", "desconocido") for c in cuerpos if "detalle" in c))
chk("detalle.permiso_sms es verdadero", any(c["detalle"]["permiso_sms"] is True for c in cuerpos))
chk("detalle.tipo_red es wifi, datos o ninguna", all(c["detalle"]["tipo_red"] in ("wifi", "datos", "ninguna") for c in cuerpos))
vivos = [c for c in cuerpos if c["detalle"].get("ultimo_sms_ts", 0) > 0]
chk("el latido informa ultimo_sms_ts despues del SMS", len(vivos) >= 1, len(vivos))

en_vivo = [r for r in sms if "historico" not in r["cuerpo"]]
chk("el SMS simulado llego a /sms con firma valida", any("TEST UNO" in r["cuerpo"] and r["firma_ok"] for r in en_vivo))
b = [json.loads(r["cuerpo"]) for r in en_vivo if "TEST UNO" in r["cuerpo"]]
chk("el SMS reenviado trae from 4066 y empresa soda", any(x.get("from") == "4066" and x.get("empresa") == "soda" for x in b))
hist = [json.loads(r["cuerpo"]) for r in sms if "historico" in r["cuerpo"]]
log = open("guardian-logcat.txt", errors="replace").read() if os.path.exists("guardian-logcat.txt") else ""
m_h = re.search(r"historial remoto: leidos=(\d+)", log)
if m_h and int(m_h.group(1)) == 0:
    print("OMITE reenviar_historial manda lote: la bandeja de SMS de este emulador esta vacia (leidos=0; el emulador no guarda SMS sin una app de mensajes predeterminada). La orden si corrio y leyo la bandeja.")
else:
    chk("reenviar_historial mando un lote historico firmado", len(hist) >= 1 and all(h.get("historico") is True for h in hist), len(hist))
chk("reenviar_historial leyo la bandeja (log historial remoto)", m_h is not None, m_h.group(0) if m_h else "")

ej = {}
for m in re.finditer(r"\n?(\d+)\|(\w+)\|(\w+)\|(\d+)", estado):
    ej.setdefault(int(m.group(1)), []).append((m.group(2), m.group(3)))
chk("orden 1 latido_ya ejecutada una vez", ej.get(1) == [("latido_ya", "ok")], ej.get(1))
chk("orden 2 reiniciar_telefono: no soportado, una vez", ej.get(2) == [("reiniciar_telefono", "comando_no_soportado")], ej.get(2))
chk("orden 3 borrar_todo (fuera de la lista) nunca ejecutada", 3 not in ej, ej.get(3))
chk("orden 4 reenviar_historial ejecutada una vez", ej.get(4) == [("reenviar_historial", "ok")], ej.get(4))
chk("orden 5 reiniciar_servicio ejecutada una vez", ej.get(5) == [("reiniciar_servicio", "ok")], ej.get(5))
conf = set()
res_ack = {}
for c in cuerpos:
    d = c["detalle"]
    for i in d.get("comandos_hechos", []):
        conf.add(i)
    res_ack.update(d.get("comandos_resultado", {}))
chk("el servidor recibio la confirmacion de 1, 2, 4 y 5 (y nunca de 3)", conf == {1, 2, 4, 5}, sorted(conf))
chk("la confirmacion de 2 dice comando_no_soportado", res_ack.get("2") == "comando_no_soportado", res_ack.get("2"))
if t_muerte:
    despues = [r for r in lat if r["t"] > t_muerte]
    chk("tras matar el proceso la app revivio sola y volvio a mandar latido", len(despues) >= 1, f"{len(despues)} latidos despues; primero a +{(despues[0]['t']-t_muerte):.0f}s" if despues else "")
m = re.search(r'name="ultimo_reenvio_ok_ts" value="(\d+)"', estado)
chk("la memoria guarda ultimo_reenvio_ok_ts", m and int(m.group(1)) > 0)
print("\nRESUMEN: %d de %d comprobaciones pasan" % (sum(1 for _, o in res if o), len(res)))
sys.exit(0 if all(o for _, o in res) else 1)

# Servidor falso de La Bomba para la prueba de la actualizacion automatica 2.12.0 (el emulador lo ve en 10.0.2.2:8099).
# - POST /latido: verifica la firma HMAC del cuerpo, lo registra en act-recibidos.jsonl y responde (firmado) segun el
#   archivo act-modo.json, que el guion cambia entre escenarios:
#     {"comandos":[{"id":1,"cmd":"abrir_adb"}],
#      "actualizacion":{"v":"2.12.1","vc":23,"archivo":"apk-23.apk","sha256":"auto"|"<hex>","firma":"ok"|"mala"|"sin","ts":"ahora"|<ms>,"eco":"ok"|<ms>}}
# - GET /instalar/<archivo>.apk: sirve el archivo de la carpeta act-apks y lo anota en act-descargas.log.
# - POST /sms y los demas: responden 200 (la app tambien reenvia SMS a la regla).
import hashlib, hmac, json, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRETO = os.environ.get("SECRETO", "claveprueba").encode()
CARPETA = os.environ.get("APKS", "act-apks")


def firma(b):
    return hmac.new(SECRETO, b, hashlib.sha256).hexdigest()


def modo():
    try:
        with open("act-modo.json") as f:
            return json.load(f)
    except Exception:
        return {}


def oferta(m, ts_latido):
    a = m.get("actualizacion")
    if not a:
        return None
    archivo = a["archivo"]
    ruta = os.path.join(CARPETA, archivo)
    sha = a.get("sha256", "auto")
    if sha == "auto":
        sha = hashlib.sha256(open(ruta, "rb").read()).hexdigest()
    url = a.get("url") or "http://10.0.2.2:8099/instalar/" + archivo
    ts = int(time.time() * 1000) if a.get("ts", "ahora") == "ahora" else int(a["ts"])
    eco = ts_latido if a.get("eco", "ok") == "ok" else int(a["eco"])
    texto = "ACT1|%s|%d|%s|%s|%d|%d" % (a["v"], a["vc"], url, sha, ts, eco)
    f = a.get("firma", "ok")
    fir = firma(texto.encode())
    if f == "mala":
        fir = ("0" if fir[0] != "0" else "1") + fir[1:]
    o = {"v": a["v"], "vc": a["vc"], "url": url, "sha256": sha, "ts": ts}
    if f != "sin":
        o["firma"] = fir
    return o, eco


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        if self.path.startswith("/instalar/"):
            nombre = os.path.basename(self.path.split("?")[0])
            ruta = os.path.join(CARPETA, nombre)
            with open("act-descargas.log", "a") as out:
                out.write("%f GET %s existe=%s\n" % (time.time(), self.path, os.path.exists(ruta)))
            if not os.path.exists(ruta):
                self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers(); return
            datos = open(ruta, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.android.package-archive")
            self.send_header("Content-Length", str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)
            return
        self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        cuerpo = self.rfile.read(n)
        ok = hmac.compare_digest(self.headers.get("X-Signature", ""), firma(cuerpo))
        with open("act-recibidos.jsonl", "a") as out:
            out.write(json.dumps({"t": time.time(), "ruta": self.path, "firma_ok": ok,
                                  "cuerpo": cuerpo.decode("utf8", "replace")}) + "\n")
        if not ok:
            self.send_response(401); self.send_header("Content-Length", "0"); self.end_headers(); return
        if self.path.startswith("/sms") and os.path.exists("act-sms-falla"):
            # el servidor «se cae»: la app recibe el SMS pero no puede reenviarlo (autochequeo sms_sin_reenviar)
            self.send_response(500); self.send_header("Content-Length", "0"); self.end_headers(); return
        if self.path.startswith("/latido"):
            m = modo()
            try:
                ts = json.loads(cuerpo)["ts"]
            except Exception:
                ts = 0
            resp = {"ok": True, "comandos": m.get("comandos", [])}
            r = oferta(m, ts)
            if r:
                resp["actualizacion"], resp["eco"] = r
            else:
                resp["eco"] = ts
            data = json.dumps(resp).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-Signature", firma(data))
        else:
            data = json.dumps({"ok": True, "nuevos": 0, "repetidos": 0, "omitidos": 0, "fallidos": 0}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("0.0.0.0", 8099), H).serve_forever()

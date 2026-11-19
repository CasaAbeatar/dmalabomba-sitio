# Servidor falso de La Bomba para la prueba del Guardian 2.7.0 (corre en el ejecutor; el emulador lo ve en 10.0.2.2:8099).
# Verifica la firma HMAC-SHA256 de lo que manda la app, lo registra en guardian-recibidos.jsonl y, a cada latido,
# responde (firmado) las mismas ordenes SIEMPRE: la app debe ejecutar cada id una sola vez.
import hashlib, hmac, json, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRETO = os.environ.get("SECRETO", "claveprueba").encode()
ORDENES = {"comandos": [
    {"id": 1, "cmd": "latido_ya"},
    {"id": 2, "cmd": "reiniciar_telefono"},
    {"id": 3, "cmd": "borrar_todo"},
    {"id": 4, "cmd": "reenviar_historial"},
    {"id": 5, "cmd": "reiniciar_servicio"},
]}

if os.environ.get("MODO") == "do":
    ORDENES = {"comandos": [{"id": 7, "cmd": "reiniciar_telefono"}]}

def firma(b):
    return hmac.new(SECRETO, b, hashlib.sha256).hexdigest()

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        cuerpo = self.rfile.read(n)
        f = self.headers.get("X-Signature", "")
        ok = hmac.compare_digest(f, firma(cuerpo))
        with open("guardian-recibidos.jsonl", "a") as out:
            out.write(json.dumps({"t": time.time(), "ruta": self.path, "firma_ok": ok,
                                  "cuerpo": cuerpo.decode("utf8", "replace")}) + "\n")
        if not ok:
            self.send_response(401); self.send_header("Content-Length", "0"); self.end_headers(); return
        if self.path.startswith("/latido"):
            resp = json.dumps(ORDENES).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("X-Signature", firma(resp))
        else:
            try:
                n_msgs = len(json.loads(cuerpo).get("mensajes", [])) if b"historico" in cuerpo else 0
            except Exception:
                n_msgs = 0
            resp = json.dumps({"ok": True, "nuevos": n_msgs, "repetidos": 0, "omitidos": 0, "fallidos": 0}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *a):
        pass

ThreadingHTTPServer(("0.0.0.0", 8099), H).serve_forever()

import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        if self.headers.get('Transfer-Encoding','').lower()=='chunked':
            cuerpo=b''
            while True:
                t=int(self.rfile.readline().strip() or b'0',16)
                if t==0: self.rfile.readline(); break
                cuerpo+=self.rfile.read(t); self.rfile.readline()
        else:
            cuerpo=self.rfile.read(n)
        with open('recibidos.jsonl','a') as f:
            f.write(json.dumps({'ruta':self.path,'cabeceras':dict(self.headers),'cuerpo':cuerpo.decode('utf8','replace')})+'\n')
        self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(b'{"ok":true}')
    def log_message(self,*a): pass
HTTPServer(('0.0.0.0',8099),H).serve_forever()

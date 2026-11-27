import http.server, socketserver, sys, time
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        p=self.path.split('?')[0]
        if p=='/ok': c,b=200,'<!doctype html><html><head><title>Facturación · La Bomba</title></head><body>app</body></html>'
        elif p=='/lander': c,b=200,'<html><head><title>dmalabomba.com is for sale</title></head></html>'
        elif p=='/503': c,b=503,'<html>cloudflare</html>'
        elif p=='/404': c,b=404,'no'
        elif p=='/redir': 
            self.send_response(302); self.send_header('Location','/ok'); self.end_headers(); return
        elif p=='/colgado': time.sleep(30); c,b=200,'x'
        else: c,b=404,'no'
        d=b.encode('utf-8'); self.send_response(c); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(d))); self.end_headers(); self.wfile.write(d)
class S(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads=True
S(('127.0.0.1',int(sys.argv[1])),H).serve_forever()

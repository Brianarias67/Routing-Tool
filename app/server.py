import json
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from .sample import scenario
from .planner import plan, validate

ROOT = Path(__file__).resolve().parent.parent/'web'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    def send_json(self,value,status=200):
        body=json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/api/sample': return self.send_json(scenario())
        if path=='/api/health': return self.send_json(dict(ok=True,valhalla_configured=bool(os.getenv('VALHALLA_URL'))))
        super().do_GET()
    def do_POST(self):
        if self.path not in ['/api/plan','/api/optimize','/api/validate']:
            return self.send_json({'error':'Not found'},404)
        try:
            # Same-origin local demo. Do not expose this server as a production service.
            origin=self.headers.get('Origin')
            if origin and urlparse(origin).netloc != self.headers.get('Host'): return self.send_json({'error':'Cross-origin write denied'},403)
            length=int(self.headers.get('Content-Length',0))
            if not 0<length<=500000: raise ValueError('Request must be between 1 byte and 500 KB.')
            data=json.loads(self.rfile.read(length))
            result=validate(data) if self.path=='/api/validate' else plan(data,self.path=='/api/optimize')
            self.send_json(result)
        except (ValueError,KeyError,TypeError,OverflowError) as error:
            self.send_json({'error':str(error)},400)
        except Exception:
            import traceback
            traceback.print_exc()
            self.send_json({'error':'Planning failed. See the server log for details.'},500)

if __name__=='__main__':
    host=os.getenv('HOST','127.0.0.1'); port=int(os.getenv('PORT','8080'))
    print(f'Karaka Routing Demo: http://{host}:{port}',flush=True)
    ThreadingHTTPServer((host,port),Handler).serve_forever()

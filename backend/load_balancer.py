import itertools
import subprocess
import sys
import time
from fastapi import FastAPI, Request, Response
import requests
import uvicorn

WORKER_PORTS = [8001, 8002]
WORKER_URLS = [f"http://127.0.0.1:{p}" for p in WORKER_PORTS]
_rr_cycle = itertools.cycle(WORKER_URLS)

lb_app = FastAPI(title="AgroPulse Round-Robin Load Balancer")


@lb_app.middleware("http")
async def cache_request_body(request: Request, call_next):
  request.scope["_body"] = await request.body()
  return await call_next(request)


@lb_app.api_route(
    "/{full_path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
)
def reverse_proxy(full_path: str, request: Request):
  """Distributes incoming requests across workers using Round-Robin with failover."""
  body = request.scope.get("_body", b"")
  query = f"?{request.url.query}" if request.url.query else ""
  headers = {
      k: v
      for k, v in request.headers.items()
      if k.lower() not in ("host", "content-length")
  }

  for _ in range(len(WORKER_URLS)):
    target_base = next(_rr_cycle)
    target_url = f"{target_base}/{full_path}{query}"
    try:
      resp = requests.request(
          method=request.method,
          url=target_url,
          headers=headers,
          data=body,
          timeout=30,
      )
      resp_headers = {
          k: v
          for k, v in resp.headers.items()
          if k.lower()
          not in ("content-encoding", "transfer-encoding", "content-length")
      }
      resp_headers["X-Load-Balancer"] = "AgroPulse-RoundRobin"
      return Response(
          content=resp.content,
          status_code=resp.status_code,
          headers=resp_headers,
      )
    except requests.RequestException:
      continue

  return Response(
      content='{"detail":"All backend workers unavailable"}',
      status_code=503,
      media_type="application/json",
  )


def wait_for_workers(timeout_sec: int = 15):
  """Waits until workers 8001 and 8002 finish loading ML models before opening port 8000."""
  deadline = time.time() + timeout_sec
  ready = set()
  while time.time() < deadline and len(ready) < len(WORKER_URLS):
    for url in WORKER_URLS:
      if url in ready:
        continue
      try:
        r = requests.get(f"{url}/health", timeout=1)
        if r.status_code == 200:
          ready.add(url)
      except requests.RequestException:
        pass
    time.sleep(0.3)


if __name__ == "__main__":
  workers = []
  try:
    for port in WORKER_PORTS:
      proc = subprocess.Popen([
          sys.executable,
          "-m",
          "uvicorn",
          "backend.api:app",
          "--host",
          "127.0.0.1",
          "--port",
          str(port),
      ])
      workers.append(proc)

    wait_for_workers()
    print(
        f"[Load Balancer] Active on http://127.0.0.1:8000 -> Balancing across"
        f" ports {WORKER_PORTS}"
    )
    uvicorn.run(lb_app, host="127.0.0.1", port=8000, log_level="warning")
  finally:
    for proc in workers:
      proc.terminate()
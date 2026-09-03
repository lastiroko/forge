import json
import time
import uuid
from typing import Dict

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

app = FastAPI()

items: Dict[str, dict] = {
    "seed-1": {"id": "seed-1", "title": "Sample item", "done": False},
    "seed-2": {"id": "seed-2", "title": "Second sample item", "done": False},
}


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = round((time.monotonic() - start) * 1000, 2)
    print(json.dumps({
        "method": request.method,
        "path": request.url.path,
        "status": response.status_code,
        "duration_ms": duration_ms,
    }))
    return response


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/items")
def list_items():
    return list(items.values())


@app.post("/items")
async def create_item(request: Request):
    payload = await request.json()
    title = payload.get("title") if isinstance(payload, dict) else None
    if not isinstance(title, str) or not title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    item_id = uuid.uuid4().hex
    item = {"id": item_id, "title": title, "done": False}
    items[item_id] = item
    return JSONResponse(status_code=201, content=item)


@app.get("/items/{item_id}")
def get_item(item_id: str):
    item = items.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="not found")
    return item


@app.patch("/items/{item_id}")
async def update_item(item_id: str, request: Request):
    item = items.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="not found")
    payload = await request.json()
    if isinstance(payload, dict) and "done" in payload:
        item["done"] = bool(payload["done"])
    return item


@app.delete("/items/{item_id}")
def delete_item(item_id: str):
    if item_id not in items:
        raise HTTPException(status_code=404, detail="not found")
    del items[item_id]
    return Response(status_code=204)

## Python (FastAPI)

This starter uses [FastAPI](https://fastapi.tiangolo.com/) served by Uvicorn.

- Install dependencies: `pip install -r requirements.txt`
- Run locally: `uvicorn app.main:app --reload --port 8000`
- Run the tests: `pip install -r requirements-dev.txt && pytest`
- The app must answer `GET /health` with a 200 response once it is ready to accept traffic.

"""SkyRescue web server: both portals, the shared state API and the ML service on one origin."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import api_ahp, api_ml, api_reports, api_state, auth, config, db, ml_jobs, ml_service

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app):
    db.connect()
    if config.ML_PRELOAD:
        await run_in_threadpool(ml_service.load_models)
    worker = ml_jobs.start()
    yield
    worker.cancel()


app = FastAPI(title="SkyRescue", docs_url=None, redoc_url=None, lifespan=lifespan)
app.include_router(auth.router)
app.include_router(api_state.router)
app.include_router(api_ml.router)
app.include_router(api_ahp.router)
app.include_router(api_reports.router)

WEB = config.WEB_DIR
# Seed data keeps evidence images as page-relative "assets/..." paths,
# so each portal also gives the shared assets folder under its own prefix.
for portal in auth.PORTALS:
    app.mount(f"/{portal}/assets", StaticFiles(directory=WEB / "common" / "assets"), name=f"{portal}-assets")
if config.SAMPLES_DIR.is_dir():
    app.mount("/samples", StaticFiles(directory=config.SAMPLES_DIR), name="samples")
app.mount("/common", StaticFiles(directory=WEB / "common"), name="common")
app.mount("/", StaticFiles(directory=WEB, html=True), name="web")

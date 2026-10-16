"""AEROLYTICS backend. Serves the website and the real Stage 6 prediction bundle.

The prediction logic lives in bundle/predict.py (unchanged). This file only exposes it over HTTP
and serves the real FD001 data and the saved experiment tables to the pages.
"""
import io, json, math, sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE = Path(__file__).resolve().parent
DATA, STATIC, BUNDLE = BASE / "data", BASE / "static", BASE / "bundle"
sys.path.insert(0, str(BUNDLE))
import predict as pr  # the Stage 6 bundle, loaded exactly as shipped

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_UPLOAD_ROWS = 20000
CONST_COLS = ["setting_3", "sensor_1", "sensor_5", "sensor_6", "sensor_10", "sensor_16", "sensor_18", "sensor_19"]
CFG = pr.CFG
META = json.loads((DATA / "sensor_meta.json").read_text())
MODEL_NAMES = list(pr.MODELS)

app = FastAPI(title="AEROLYTICS", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")


# ---------------------------------------------------------------- data (loaded once)
TRAIN = pd.read_csv(DATA / "train_FD001.csv")
TEST = pd.read_csv(DATA / "test_FD001.csv")
TRUE_RUL = pd.read_csv(DATA / "RUL_FD001.csv").set_index("unit")["true_RUL"]
PREDS = pd.read_csv(DATA / "test_predictions.csv").set_index("unit")
RAW_COLS = [c for c in TEST.columns]  # unit, cycle, setting_1..3, sensor_1..21
USEFUL = [c for c in TRAIN.columns if c.startswith("sensor") and c not in CONST_COLS]
SETTINGS = ["setting_1", "setting_2", "setting_3"]


def clean(o):
    """JSON-safe conversion (NaN/inf -> None, numpy -> python)."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if not math.isfinite(float(o)) else float(o)
    return o


def j(o):
    return JSONResponse(clean(o))


def records(df, nd=4):
    return json.loads(df.round(nd).to_json(orient="records"))


# ---------------------------------------------------------------- real-engine examples
def _build_examples():
    """Three presets taken from real TEST engines' last recorded cycle (true RUL known, never trained on).
    In each health band we pick the engine whose average model error is closest to that band's median,
    so the example shows typical accuracy rather than a best case."""
    err = (PREDS[MODEL_NAMES].sub(PREDS["true_RUL"], axis=0)).abs().mean(axis=1)
    bands = [
        ("healthy", "Healthy engine", PREDS.true_RUL >= 100),
        ("warning", "Mid-life engine", (PREDS.true_RUL >= 30) & (PREDS.true_RUL < 60)),
        ("critical", "Near-failure engine", PREDS.true_RUL < 30),
    ]
    out = []
    for key, label, mask in bands:
        sub = err[mask]
        unit = int((sub - sub.median()).abs().idxmin())
        last = TEST[TEST.unit == unit].sort_values("cycle").iloc[-1]
        out.append({
            "id": key, "label": label, "unit": unit,
            "description": f"Test engine {unit}, last recorded cycle ({int(last.cycle)}). Real sensor readings; true RUL {int(TRUE_RUL[unit])} cycles.",
            "true_rul": int(TRUE_RUL[unit]),
            "inputs": {c: float(last[c]) for c in pr.SPEC},
        })
    return out


EXAMPLES = _build_examples()
SAMPLE_UNIT = next(e["unit"] for e in EXAMPLES if e["id"] == "critical")


def _sample_csv_bytes():
    g = TEST[TEST.unit == SAMPLE_UNIT].sort_values("cycle")
    cols = ["unit"] + CFG["csv_required_columns"]
    return g[cols].to_csv(index=False).encode()


SAMPLE_CSV = _sample_csv_bytes()


# ---------------------------------------------------------------- prediction API
class PredictIn(BaseModel):
    inputs: dict[str, float]


@app.post("/api/predict")
def api_predict(body: PredictIn):
    bad = [k for k, v in body.inputs.items() if not math.isfinite(v)]
    if bad:
        raise HTTPException(422, "Values must be finite numbers: " + ", ".join(bad))
    return j(pr.predict_single(body.inputs))


@app.post("/api/predict-csv")
async def api_predict_csv(file: UploadFile = File(...)):
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File is larger than 5 MB. Upload one engine at a time or trim the rows.")
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception:
        raise HTTPException(400, "Could not read this file as CSV. Check that it is comma-separated with a header row.")
    if len(df) > MAX_UPLOAD_ROWS:
        raise HTTPException(413, f"File has {len(df):,} rows. The limit is {MAX_UPLOAD_ROWS:,}.")
    try:
        rows, summary = pr.predict_history(df)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(400, "The file has values the models cannot read. Check for blank or non-numeric cells.")
    if not np.isfinite(rows[[c for c in rows.columns if c.startswith("pred_")]].to_numpy()).all():
        raise HTTPException(400, "Some rows contain blank or invalid values. Fill or remove them and upload again.")
    return j({"rows": records(rows, 1), "summary": summary, "models": MODEL_NAMES})


@app.get("/api/sample-csv")
def api_sample_csv():
    return Response(SAMPLE_CSV, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="aerolytics_sample_engine_{SAMPLE_UNIT}.csv"'})


@app.get("/api/examples")
def api_examples():
    return j(EXAMPLES)


@app.get("/api/config")
def api_config():
    return j({**CFG, "models": MODEL_NAMES, "sensor_meta": META, "sample_unit": SAMPLE_UNIT})


@app.get("/api/health")
def api_health():
    return {"status": "ok", "models": MODEL_NAMES}


# ---------------------------------------------------------------- dataset API
@lru_cache(maxsize=1)
def _summary():
    life = TRAIN.groupby("unit").cycle.max()
    tlen = TEST.groupby("unit").cycle.max()
    return {
        "train_engines": int(TRAIN.unit.nunique()), "test_engines": int(TEST.unit.nunique()),
        "train_rows": int(len(TRAIN)), "test_rows": int(len(TEST)),
        "raw_columns": len(RAW_COLS), "useful_sensors": len(USEFUL), "constant_columns": CONST_COLS,
        "train_life": {"min": int(life.min()), "max": int(life.max()), "mean": float(life.mean()), "median": float(life.median())},
        "test_length": {"min": int(tlen.min()), "max": int(tlen.max()), "mean": float(tlen.mean())},
        "test_true_rul": {"min": int(TRUE_RUL.min()), "max": int(TRUE_RUL.max()), "mean": float(TRUE_RUL.mean())},
        "life_histogram": _hist(life.values, 12),
        "missing_values": int(TRAIN.isna().sum().sum() + TEST.isna().sum().sum()),
        "duplicate_rows": int(TRAIN.duplicated().sum()),
    }


def _hist(values, bins):
    counts, edges = np.histogram(values, bins=bins)
    return {"edges": edges.tolist(), "counts": counts.tolist()}


@app.get("/api/dataset/summary")
def api_dataset_summary():
    return j(_summary())


@app.get("/api/dataset/engines")
def api_dataset_engines(split: str = Query("train", pattern="^(train|test)$")):
    if split == "train":
        g = TRAIN.groupby("unit").cycle.max()
        return j([{"unit": int(u), "cycles": int(n), "label": f"Engine {u} ({n} cycles to failure)"} for u, n in g.items()])
    g = TEST.groupby("unit").cycle.max()
    return j([{"unit": int(u), "cycles": int(n), "true_rul": int(TRUE_RUL[u]),
               "label": f"Engine {u} ({n} cycles recorded, {int(TRUE_RUL[u])} left)"} for u, n in g.items()])


@app.get("/api/dataset/engine/{split}/{unit}")
def api_dataset_engine(split: str, unit: int):
    if split not in ("train", "test"):
        raise HTTPException(404, "Unknown split")
    df = (TRAIN if split == "train" else TEST)
    g = df[df.unit == unit].sort_values("cycle")
    if g.empty:
        raise HTTPException(404, f"Engine {unit} not found in the {split} set")
    cols = ["cycle", "setting_1", "setting_2"] + USEFUL
    out = {c: g[c].round(4).tolist() for c in cols}
    if split == "train":
        out["rul"] = g["RUL"].tolist()
        out["rul_kind"] = "actual"
    else:  # test engines stop early; RUL counts down by one per cycle after the last row
        last = int(g.cycle.max())
        out["rul"] = [int(TRUE_RUL[unit] + last - c) for c in g.cycle]
        out["rul_kind"] = "implied"
    out["unit"], out["split"] = unit, split
    return j(out)


@lru_cache(maxsize=1)
def _corr():
    cols = USEFUL + ["RUL"]
    m = TRAIN[cols].corr().round(3)
    return {"labels": cols, "matrix": m.values.tolist()}


@app.get("/api/dataset/correlation")
def api_dataset_correlation():
    return j(_corr())


@lru_cache(maxsize=1)
def _settings():
    out = {}
    for s in ["setting_1", "setting_2"]:
        v = TRAIN[s]
        out[s] = {"hist": _hist(v.values, 20), "mean": float(v.mean()), "std": float(v.std()), "min": float(v.min()),
                  "max": float(v.max()), "corr_with_rul": float(v.corr(TRAIN.RUL))}
    samp = TRAIN.sample(1500, random_state=7)  # fixed seed: same points every load
    out["scatter"] = {"x": samp.setting_1.round(4).tolist(), "y": samp.setting_2.round(4).tolist()}
    out["setting_3_unique"] = TRAIN.setting_3.unique().tolist()
    return out


@app.get("/api/dataset/settings")
def api_dataset_settings():
    return j(_settings())


@app.get("/api/dataset/table")
def api_dataset_table(split: str = Query("train", pattern="^(train|test)$"), q: str = "", page: int = Query(1, ge=1),
                      page_size: int = Query(25, ge=5, le=100)):
    df = TRAIN if split == "train" else TEST
    q = q.strip()
    if q:
        if not q.isdigit():
            raise HTTPException(400, "Search by engine number, for example 17.")
        df = df[df.unit == int(q)]
    total = len(df)
    pages = max(1, math.ceil(total / page_size))
    page = min(page, pages)
    part = df.iloc[(page - 1) * page_size: page * page_size]
    return j({"columns": list(part.columns), "rows": part.values.tolist(), "total": total, "page": page, "pages": pages})


# ---------------------------------------------------------------- results API (saved experiment tables)
@app.get("/api/results")
def api_results():
    rd = lambda f: pd.read_csv(DATA / f)
    abl, tune, final = rd("ablation_cv_rmse.csv"), rd("stage3_tuning.csv"), rd("final_test_results.csv")
    abl = abl.rename(columns={abl.columns[0]: "setup"})
    # Validation (cross-validated) score of the FINAL setup: LR from the ablation row, tuned RF/XGB from the tuning table
    fin = abl.iloc[0]
    validation = {
        "Linear Regression": float(fin["Linear Regression"]),
        "Random Forest": float(tune[tune.model == "Random Forest"].cv_RMSE.min()),
        "XGBoost": float(tune[tune.model == "XGBoost"].cv_RMSE.min()),
    }
    exp = rd("stage3_experiments.csv")
    exp = exp.rename(columns={exp.columns[0]: "experiment"})
    P = rd("test_predictions.csv")
    return j({
        "models": MODEL_NAMES,
        "test": records(final, 3),
        "validation_rmse": validation,
        "baseline_cv": records(rd("baseline_cv_results.csv"), 3),
        "experiments": records(exp, 3),
        "tuning": records(tune, 3),
        "ablation": records(abl, 2),
        "importance": records(rd("feature_importance.csv").rename(columns={"base": "feature"}), 4),
        "error_bands": records(rd("error_by_rul_band.csv").rename(columns={"band": "band"}), 2),
        "worst": records(rd("worst_engines.csv"), 1),
        "predictions": records(P, 1),
        "cap": CFG["cap"],
        "config": json.loads((BUNDLE / "best_config.json").read_text()),
        "best_model": final.sort_values("test_RMSE").iloc[0]["model"],
    })


# ---------------------------------------------------------------- pages and static files
app.mount("/static", StaticFiles(directory=STATIC), name="static")


PAGES = {"": "index.html", "dataset": "dataset.html", "predict": "predict.html", "models": "models.html",
         "results": "results.html", "about": "about.html"}


@app.get("/{page:path}", include_in_schema=False)
def page(page: str):
    name = PAGES.get(page.strip("/"))
    if name is None or not (STATIC / name).exists():
        if page.startswith("api/"):
            raise HTTPException(404, "Unknown API route")
        return FileResponse(STATIC / "404.html", status_code=404) if (STATIC / "404.html").exists() else Response("Not found", 404)
    return FileResponse(STATIC / name)


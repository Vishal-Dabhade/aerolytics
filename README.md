
   ---
   title: AEROLYTICS
   emoji: ✈️
   colorFrom: gray
   colorTo: green
   sdk: docker
   app_port: 7860
   pinned: false
   ---



# AEROLYTICS

Remaining useful life (RUL) prediction for turbofan engines, built on NASA C-MAPSS FD001.
A FastAPI backend serves the real trained models; the website is plain HTML, CSS and JavaScript.

## Run it

```bash
pip install -r requirements.txt
./run.sh            # or: python3 -m uvicorn main:app --port 8000
```

Open http://localhost:8000. Interactive API docs are at `/api/docs`.

## Pages

| Page | What it does |
|---|---|
| `/` Home | Overview, live demo prediction, method summary |
| `/dataset` | Real FD001 data: engine explorer, operating conditions, correlation heatmap, searchable raw table |
| `/predict` | Prediction lab: sliders plus number boxes (8 main, 9 advanced), real-engine examples, CSV upload |
| `/models` | Workflow, validation vs test, experiments, tuning, feature importance |
| `/results` | Official test scores, predicted vs actual, error analysis, ablation |
| `/about` | Problem, dataset, method, limitations |

## What is real

* `bundle/` is the Stage 6 prediction bundle, unchanged: `predict.py`, the three model files, the fitted scaler
  and `ui_config.json`. Every prediction on the site comes from `POST /api/predict` or `POST /api/predict-csv`,
  which call it. Feature order and preprocessing are never re-implemented in the web layer.
* `data/` holds the original FD001 CSVs and the saved experiment tables from Stages 2 to 5.
  Charts read these files through the API. Nothing is generated at random.
* Checked: running all 100 test engines through `/api/predict-csv` reproduces the Stage 4 test predictions exactly.

## API

| Route | Purpose |
|---|---|
| `POST /api/predict` | `{"inputs": {"sensor_4": 1408.0, ...}}`. Missing inputs use training medians. |
| `POST /api/predict-csv` | Multipart file upload, up to 5 MB and 20,000 rows. |
| `GET /api/sample-csv` | Sample engine history in the expected format. |
| `GET /api/examples` | Three real test-engine presets with their true RUL. |
| `GET /api/config` | Slider ranges, defaults, status thresholds, test metrics. |
| `GET /api/results` | Saved experiment and test tables. |
| `GET /api/dataset/*` | Summary, engines, engine series, correlation, settings, paged table. |

CSV columns required: `cycle`, `setting_1`, `setting_2`, `sensor_2`, `sensor_3`, `sensor_4`, `sensor_7`, `sensor_8`,
`sensor_9`, `sensor_11`, `sensor_12`, `sensor_13`, `sensor_14`, `sensor_15`, `sensor_17`, `sensor_20`, `sensor_21`.
An optional `unit` column allows several engines in one file.

## Deploy

The app needs a Python host (it is not a static site).

* **Render**: New Web Service from the repository. Build command `pip install -r requirements.txt`,
  start command `python -m uvicorn main:app --host 0.0.0.0 --port $PORT`.
* **Hugging Face Spaces**: create a Docker Space and push this folder. The included `Dockerfile` uses port 7860.
* Keep the pinned versions in `requirements.txt`. The model files were saved with them, and a different
  scikit-learn or XGBoost version can fail to load them.

The model and data files total about 12 MB, which fits free tiers. Free instances sleep when idle, so the first
request after a pause can take a few seconds while the models load.

## Notes

* The hero is an original SVG illustration of a fan face, not a photograph. To use a photo, add an image to
  `static/img/` and place it behind `.hero-engine` in `static/index.html`.
* Fonts (Archivo, IBM Plex Sans and Mono) and Chart.js are bundled under `static/`, so the site makes no
  third-party requests.
* The data is simulated. Estimates are not guarantees and this is not a certified maintenance tool.

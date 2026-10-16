"""RUL prediction for C-MAPSS FD001. Self-contained: needs only the files in this folder.
  predict_single({...})  -> one set of readings (missing inputs filled with training medians)
  predict_history(df)    -> engine history (CSV rows); exact rolling mean; per-cycle predictions
"""
import json, os, joblib, numpy as np, pandas as pd
HERE=os.path.dirname(os.path.abspath(__file__))
_P=joblib.load(os.path.join(HERE,'final_prep.joblib')); SC,FEATS=_P['scaler'],_P['features']
CFG=json.load(open(os.path.join(HERE,'ui_config.json'))); CAP=CFG['cap']; W=CFG['rolling_window']
MODELS={'Linear Regression':'model_linear_regression','Random Forest':'model_random_forest','XGBoost':'model_xgboost'}
_M={n:joblib.load(os.path.join(HERE,f+'.joblib')) for n,f in MODELS.items()}
SPEC={d['name']:d for d in CFG['inputs']}; BASE=[n for n in SPEC if n!='cycle']

def status(rul):
    t=CFG['status_thresholds']; return 'critical' if rul<t['critical_below'] else 'warning' if rul<t['warning_below'] else 'healthy'
def _predict_rows(df):
    X=SC.transform(df[FEATS]); out={}
    for n,m in _M.items(): out[n]=np.clip(m.predict(X),0,CAP)
    return out
def _features(df):                      # df has cycle + BASE columns, one engine, sorted by cycle
    df=df.copy()
    for c in BASE:
        if c.startswith('sensor'): df[c+'_rm']=df[c].rolling(W,min_periods=1).mean()
    return df
def _warnings(row):
    w=[]
    for c,s in SPEC.items():
        v=row[c]
        if not np.isfinite(v): w.append(f'{c}: invalid value')
        elif v<s['min'] or v>s['max']: w.append(f"{c}={v:g} is outside the training range [{s['min']:g}, {s['max']:g}]; prediction may be unreliable")
    return w
def _pack(preds,i,hist_rows,warns):
    r={n:{'rul':round(float(p[i]),1),'status':status(p[i]),'at_cap':bool(p[i]>=CAP-0.5)} for n,p in preds.items()}
    return {'predictions':r,'rows_used':hist_rows,'warnings':warns,
            'exact_rolling_mean':hist_rows>=W,'cap':CAP}

def predict_single(inputs):
    unknown=[k for k in inputs if k not in SPEC]
    row={c:float(inputs.get(c,SPEC[c]['default'])) for c in SPEC}
    df=pd.DataFrame([row]); df=_features(df)           # rolling mean of a single reading = the reading
    res=_pack(_predict_rows(df),0,1,_warnings(row))
    res['filled_with_defaults']=[c for c in SPEC if c not in inputs]; res['ignored_inputs']=unknown
    return res

def validate_csv(df):
    miss=[c for c in CFG['csv_required_columns'] if c not in df.columns]
    if miss: raise ValueError('CSV is missing columns: '+', '.join(miss))
    if df.empty: raise ValueError('CSV has no rows')
    bad=[c for c in CFG['csv_required_columns'] if not pd.api.types.is_numeric_dtype(df[c])]
    if bad: raise ValueError('Non-numeric values in: '+', '.join(bad))
def predict_history(df):
    """df: rows of ONE engine or several (column 'unit' optional). Returns (per_row DataFrame, summary list per engine)."""
    validate_csv(df); df=df.copy()
    if 'unit' not in df.columns: df['unit']=1
    frames=[]
    for u,g in df.sort_values(['unit','cycle']).groupby('unit'):
        g=_features(g[['unit','cycle']+BASE]); p=_predict_rows(g)
        for n in p: g['pred_'+n]=np.round(p[n],1)
        frames.append(g)
    rows=pd.concat(frames); summ=[]
    for u,g in rows.groupby('unit'):
        last=g.iloc[-1]; p={n:np.array([last['pred_'+n]]) for n in MODELS}
        summ.append({'unit':int(u),**_pack(p,0,len(g),_warnings(last))})
    return rows[['unit','cycle']+['pred_'+n for n in MODELS]].reset_index(drop=True),summ

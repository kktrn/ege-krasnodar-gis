import os
import io
import json
import zipfile
import tempfile
from typing import Optional
import pandas as pd
import fiona
from shapely.geometry import shape, mapping
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://neondb_owner:npg_L8UcxjbDSPi4@ep-late-fog-banhh327-pooler.c-8.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require")

app = FastAPI(title="Веб-ГИС ЕГЭ по географии Краснодарского края")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_FOLDER = os.path.join(BASE_DIR, "database")
FRONTEND_FOLDER = os.path.join(BASE_DIR, "frontend")


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def clean_num(val, is_int=False):
    if pd.isna(val):
        return None
    s = str(val).replace(",", ".").replace("..", ".").strip()
    if s == "" or s.lower() == "nan":
        return None
    return int(float(s)) if is_int else round(float(s), 1)


def update_results_from_df(cur, df):
    years = sorted([int(c.split("_")[1]) for c in df.columns if str(c).startswith("Avg_")])
    cur.execute("DELETE FROM exam_results;")
    cur.execute("DELETE FROM regional_benchmarks;")

    for _, row in df.iterrows():
        fid = int(row["fid"])
        for y in years:
            kol = clean_num(row.get(f"kol_{y}"), is_int=True)
            avg = clean_num(row.get(f"Avg_{y}"), is_int=False)
            cur.execute(
                """INSERT INTO exam_results (municipality_id, year, participants_count, avg_score)
                   VALUES (%s, %s, %s, %s)""",
                (fid, y, kol, avg)
            )

    for y in years:
        cur.execute(
            "SELECT SUM(participants_count) AS tot, ROUND(AVG(avg_score), 1) AS avg_s FROM exam_results WHERE year = %s",
            (y,)
        )
        res = cur.fetchone()
        cur.execute(
            "INSERT INTO regional_benchmarks (year, total_participants, krai_avg_score) VALUES (%s, %s, %s)",
            (y, res["tot"], res["avg_s"])
        )


def seed_database_if_empty():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS cnt FROM municipalities;")
    if cur.fetchone()["cnt"] > 0:
        cur.close()
        conn.close()
        return

    shp_zip = os.path.join(DB_FOLDER, "ShapeFiles.zip")
    xlsx_path = os.path.join(DB_FOLDER, "атрубутивка.xlsx")
    if not os.path.exists(shp_zip) or not os.path.exists(xlsx_path):
        cur.close()
        conn.close()
        return

    xls = pd.ExcelFile(xlsx_path)
    df = pd.read_excel(xlsx_path, sheet_name=xls.sheet_names[0])

    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(shp_zip, "r") as z:
            z.extractall(tmpdir)
        shp_file = None
        for root, _, files in os.walk(tmpdir):
            for f in files:
                if f.endswith(".shp"):
                    shp_file = os.path.join(root, f)

        with fiona.open(shp_file) as src:
            for i, feat in enumerate(src):
                geom = shape(feat["geometry"])
                centroid = geom.representative_point()
                geom_json = json.dumps(mapping(geom), separators=(",", ":"))
                full_name = str(feat["properties"]["NAME"]).strip()
                osm_id = feat["properties"].get("OSM_ID")
                row = df.loc[df["fid"] == i].iloc[0]
                short_name = str(row["Район"]).strip()

                cur.execute(
                    """INSERT INTO municipalities (id, name, short_name, osm_id, center_lat, center_lon, geometry_geojson)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (i, full_name, short_name, osm_id, round(centroid.y, 5), round(centroid.x, 5), geom_json)
                )

    update_results_from_df(cur, df)
    conn.commit()
    cur.close()
    conn.close()


@app.on_event("startup")
def on_startup():
    if "ВСТАВЬ_СЮДА" not in DATABASE_URL:
        seed_database_if_empty()


@app.get("/api/data")
def get_all_data():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM municipalities ORDER BY id;")
    munis = cur.fetchall()
    cur.execute("SELECT * FROM exam_results ORDER BY municipality_id, year;")
    results = cur.fetchall()
    cur.execute("SELECT * FROM regional_benchmarks ORDER BY year;")
    benchmarks = cur.fetchall()
    cur.close()
    conn.close()

    res_map = {}
    years_set = set()
    for r in results:
        mid = r["municipality_id"]
        y = r["year"]
        years_set.add(y)
        res_map.setdefault(mid, {"kol": {}, "avg": {}})
        res_map[mid]["kol"][y] = r["participants_count"]
        res_map[mid]["avg"][y] = float(r["avg_score"]) if r["avg_score"] is not None else None

    # Вычисление пространственного соседства полигонов через Shapely
    shapes_map = {m["id"]: shape(json.loads(m["geometry_geojson"])) for m in munis}
    neighbors_map = {m["id"]: [] for m in munis}
    ids = list(shapes_map.keys())
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            id1, id2 = ids[i], ids[j]
            if shapes_map[id1].touches(shapes_map[id2]) or shapes_map[id1].intersects(shapes_map[id2]):
                neighbors_map[id1].append(id2)
                neighbors_map[id2].append(id1)

    features = []
    for m in munis:
        mid = m["id"]
        features.append({
            "type": "Feature",
            "properties": {
                "fid": mid,
                "name": m["name"],
                "short_name": m["short_name"],
                "center": [m["center_lat"], m["center_lon"]],
                "neighbors": neighbors_map.get(mid, []),
                "kol": res_map.get(mid, {}).get("kol", {}),
                "avg": res_map.get(mid, {}).get("avg", {})
            },
            "geometry": json.loads(m["geometry_geojson"])
        })

    return {
        "years": sorted(list(years_set)),
        "geojson": {"type": "FeatureCollection", "features": features},
        "benchmarks": [
            {
                "year": b["year"],
                "total_participants": b["total_participants"],
                "krai_avg_score": float(b["krai_avg_score"]) if b["krai_avg_score"] else None
            }
            for b in benchmarks
        ]
    }


@app.post("/api/upload-excel")
async def upload_excel_to_db(file: UploadFile = File(...)):
    try:
        content = await file.read()
        xls = pd.ExcelFile(io.BytesIO(content))
        df = pd.read_excel(io.BytesIO(content), sheet_name=xls.sheet_names[0])
        conn = get_conn()
        cur = conn.cursor()
        update_results_from_df(cur, df)
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "ok", "message": "База данных PostgreSQL успешно обновлена!"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


if os.path.exists(FRONTEND_FOLDER):
    app.mount("/", StaticFiles(directory=FRONTEND_FOLDER, html=True), name="frontend")

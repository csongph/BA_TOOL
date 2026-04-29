import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import List

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from backend.repository.mapping_repo import MappingRepository
from backend.core.converter import DataTypeConverter
from backend.parser.sql_parser import parse_sql, validate_fk
from backend.config.logger import logger
from backend.config.db import init_db_pool, close_db_pool
from backend.core.cache_store import result_cache
from backend.exporter.excel_exporter import export_confluent_xlsx, export_table_xlsx, export_all_csv, export_table_csv

# ── Constants ────────────────────────────────────────────
MAX_FILE_SIZE_MB = 10
MAX_FILE_SIZE    = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_FILES        = 20
SESSION_TTL      = timedelta(hours=1)

mapping_data: dict = {}
converter: DataTypeConverter | None = None

limiter = Limiter(key_func=get_remote_address)


# ── Lifecycle ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting up...")
    global mapping_data, converter

    try:
        init_db_pool()
        repo = MappingRepository()
        mapping_data = repo.get_all()
        logger.info(f"✅ Mapping loaded ({len(mapping_data)} types): {list(mapping_data.keys())}")
        converter = DataTypeConverter(mapping_data)
    except Exception as e:
        logger.error(f"❌ Startup failed: {e}", exc_info=True)
        raise

    yield

    logger.info("🛑 Shutdown")
    close_db_pool()


app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS: lock down in production ────────────────────────
import os
_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5500,http://127.0.0.1:5500"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


# ── Models ────────────────────────────────────────────────
class OverrideRequest(BaseModel):
    table: str
    column: str
    new_type: str

    # [FIX-Security] ป้องกัน injection ผ่าน override payload
    @field_validator("table", "column", "new_type")
    @classmethod
    def no_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Field must not be empty")
        if len(v) > 256:
            raise ValueError("Field too long")
        return v


# ── Helpers ───────────────────────────────────────────────
def cleanup_expired_sessions() -> None:
    now = datetime.now()
    expired = [sid for sid, s in result_cache.items()
               if now - s["created_at"] > SESSION_TTL]
    for sid in expired:
        del result_cache[sid]
    if expired:
        logger.info(f"🧹 Cleaned {len(expired)} expired session(s)")


def get_cached_data(session_id: str) -> dict:
    # [FIX-Security] validate UUID format ก่อน lookup
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(400, "Invalid session ID format")

    session = result_cache.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found or expired")

    # [FIX-Security] ตรวจ TTL ตอน access ด้วย ไม่ใช่แค่ตอน cleanup
    if datetime.now() - session["created_at"] > SESSION_TTL:
        del result_cache[session_id]
        raise HTTPException(404, "Session expired")

    return session["data"]


# ── API ───────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "sessions": len(result_cache)}


@app.post("/convert")
@limiter.limit("30/minute")
async def convert(request: Request, files: List[UploadFile] = File(...)):
    if converter is None:
        raise HTTPException(500, "Converter not initialized")

    # [FIX-Security] จำกัดจำนวนไฟล์
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"Too many files (max {MAX_FILES})")

    logger.info(f"📥 Convert {len(files)} file(s)")

    tables: dict        = {}
    unknown: dict       = {}
    byte_anomalies: dict = {}   # { table: [{ column, file, source_type, raw_type, detail }] }
    table_source: dict  = {}    # table → filename ที่ define ครั้งแรก
    duplicate_tables: dict = {} # table → { first_file, duplicate_files: [...] }

    for file in files:
        # [FIX-Security] ตรวจ extension จาก filename จริง (ไม่เชื่อ content-type)
        filename = (file.filename or "").strip()
        if not filename.lower().endswith(".sql"):
            raise HTTPException(400, f"Only .sql files accepted, got: {filename!r}")

        logger.info(f"  → Processing: {filename}")

        try:
            await file.seek(0)
            raw = await file.read()

            # [FIX-Security] จำกัดขนาดไฟล์
            if len(raw) > MAX_FILE_SIZE:
                raise HTTPException(400, f"{filename}: exceeds {MAX_FILE_SIZE_MB} MB limit")

            sql_text = raw.decode("utf-8-sig")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Error reading {filename}: {e}")
            raise HTTPException(400, f"Cannot read file: {filename}")

        parsed = parse_sql(sql_text)
        if not parsed:
            logger.warning(f"  ⚠️ No table found in: {filename}")
            continue

        # ── group parsed rows by table ──────────────────────────
        parsed_by_table: dict = {}
        for row in parsed:
            parsed_by_table.setdefault(row["table"], []).append(row)

        for table, table_rows in parsed_by_table.items():
            # ── duplicate table detection (per-table, not per-column) ──
            if table in table_source:
                dup = duplicate_tables.setdefault(table, {
                    "first_file":      table_source[table],
                    "duplicate_files": [],
                })
                if filename not in dup["duplicate_files"]:
                    dup["duplicate_files"].append(filename)
                    logger.warning(
                        f"⚠️  Duplicate table '{table}' in '{filename}' "
                        f"(first defined in '{table_source[table]}') — skipped"
                    )
                continue  # ข้ามทั้งตาราง
            else:
                table_source[table] = filename

            for row in table_rows:
                res = converter.convert(row["type"])

                tables.setdefault(table, []).append({
                    "column_name":     row["column"],
                    "file":            filename,
                    "raw_type":        res.get("raw"),
                    "logical_type":    res.get("logical"),
                    "final_type":      res.get("final") if res.get("status") == "ok" else row["type"],
                    "source_sql_type": row["type"],
                    "nullable":        "NOT NULL" if row.get("nullable") == "NOT NULL" else "NULL",
                    "is_pk":           row.get("is_pk", False),
                    "fk":              row.get("fk"),
                })

                if res.get("status") != "ok":
                    unknown.setdefault(table, []).append({
                        "column_name": row["column"],
                        "file":        filename,
                        "reason":      res.get("reason"),
                    })

                # ── byte anomaly warning ────────────────────────────
                if res.get("byte_anomaly"):
                    byte_anomalies.setdefault(table, []).append({
                        "column_name": row["column"],
                        "file":        filename,
                        "source_type": row["type"],
                        "raw_type":    res.get("raw"),
                        "detail":      res.get("byte_anomaly_detail"),
                    })

    if not tables:
        raise HTTPException(400, "No table found in any uploaded file")

    # ── FK validation ──────────────────────────────────────
    all_parsed = [
        {"table": t, "column": c["column_name"],
         "is_pk": c.get("is_pk", False), "fk": c.get("fk")}
        for t, cols in tables.items()
        for c in cols
    ]
    fk_errors = validate_fk(all_parsed)

    cleanup_expired_sessions()

    session_id = str(uuid.uuid4())
    result_cache[session_id] = {
        "data":       {"tables": tables, "unknown": unknown, "fk_errors": fk_errors,
                       "byte_anomalies": byte_anomalies, "duplicate_tables": duplicate_tables},
        "created_at": datetime.now(),
    }

    logger.info(f"✅ Session {session_id} created — {len(tables)} table(s)")

    anomaly_count = sum(len(v) for v in byte_anomalies.values())
    if anomaly_count:
        logger.warning(f"⚠️  Byte anomalies detected: {anomaly_count} column(s)")

    dup_count = len(duplicate_tables)
    if dup_count:
        logger.warning(f"🚫 Duplicate tables skipped: {dup_count} table(s) — {list(duplicate_tables.keys())}")

    return {
        "session_id":       session_id,
        "file_count":       len(files),
        "tables":           tables,
        "unknown":          unknown,
        "fk_errors":        fk_errors,
        "byte_anomalies":   byte_anomalies,
        "duplicate_tables": duplicate_tables,
    }


@app.get("/result/{session_id}")
def get_result(session_id: str):
    return get_cached_data(session_id)


@app.post("/override/{session_id}")
def override(session_id: str, body: OverrideRequest):
    data = get_cached_data(session_id)

    table_cols = data["tables"].get(body.table)
    if table_cols is None:
        raise HTTPException(404, f"Table '{body.table}' not found")

    for col in table_cols:
        if col["column_name"] == body.column:
            col["final_type"] = body.new_type
            logger.info(f"✏️  Override {body.table}.{body.column} → {body.new_type}")
            return {"updated_column": col}

    raise HTTPException(404, f"Column '{body.column}' not found in table '{body.table}'")


@app.delete("/session/{session_id}")
def delete_session(session_id: str):
    # [FIX-Security] validate UUID ก่อนลบ
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(400, "Invalid session ID format")

    if session_id in result_cache:
        del result_cache[session_id]
        logger.info(f"🗑  Session {session_id} deleted")
        return {"status": "deleted"}
    raise HTTPException(404, "Session not found")


# ── Export endpoints ──────────────────────────────────────

@app.get("/export/{session_id}/xlsx")
def export_all(session_id: str):
    data           = get_cached_data(session_id)
    byte_anomalies = data.get("byte_anomalies", {})
    buf  = export_confluent_xlsx(data["tables"], byte_anomalies=byte_anomalies)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=confluent_mapping.xlsx"},
    )


@app.get("/export/{session_id}/xlsx/{table_name}")
def export_one(session_id: str, table_name: str):
    data           = get_cached_data(session_id)
    columns        = data["tables"].get(table_name)
    if columns is None:
        raise HTTPException(404, f"Table '{table_name}' not found")
    anomalies = data.get("byte_anomalies", {}).get(table_name)
    buf = export_table_xlsx(columns, table_name, anomalies=anomalies)
    filename = f"{table_name}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/export/{session_id}/csv")
def export_all_csv_endpoint(session_id: str):
    data           = get_cached_data(session_id)
    byte_anomalies = data.get("byte_anomalies", {})
    buf  = export_all_csv(data["tables"], byte_anomalies=byte_anomalies)
    return StreamingResponse(
        buf,
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": "attachment; filename=confluent_mapping.csv"},
    )


@app.get("/export/{session_id}/csv/{table_name}")
def export_one_csv(session_id: str, table_name: str):
    data      = get_cached_data(session_id)
    columns   = data["tables"].get(table_name)
    if columns is None:
        raise HTTPException(404, f"Table '{table_name}' not found")
    anomalies = data.get("byte_anomalies", {}).get(table_name)
    buf       = export_table_csv(columns, table_name, anomalies=anomalies)
    filename  = f"{table_name}.csv"
    return StreamingResponse(
        buf,
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
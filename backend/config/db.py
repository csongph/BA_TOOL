import os
import threading
from pathlib import Path
from psycopg2 import pool, OperationalError
from dotenv import load_dotenv
import logging

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

_POOL_MIN = int(os.getenv("DB_POOL_MIN", "2"))
_POOL_MAX = int(os.getenv("DB_POOL_MAX", "10"))

# Registry: db_name → pool
_pools: dict[str, pool.ThreadedConnectionPool] = {}
_pools_lock = threading.Lock()


def _get_db_configs() -> dict[str, str]:
    
    configs: dict[str, str] = {}

    default_url = os.getenv("DB_URL")
    if default_url:
        configs["default"] = default_url

    for key, val in os.environ.items():
        if key.startswith("DB_URL_") and val:
            db_name = key[len("DB_URL_"):].lower()  
            configs[db_name] = val

    return configs


def init_db_pool(db_name: str | None = None, db_url: str | None = None) -> None:
    """
    เรียก 2 แบบ:
      1. init_db_pool()                          → init ทุก DB จาก env อัตโนมัติ
      2. init_db_pool("mydb", "postgres://...")  → เพิ่ม DB ใหม่แบบ dynamic
    """
    with _pools_lock:
        if db_name and db_url:
            _init_single(db_name, db_url)
        else:
            configs = _get_db_configs()
            if not configs:
                raise RuntimeError("No DB_URL or DB_URL_<NAME> found in environment")
            for name, url in configs.items():
                _init_single(name, url)


def _init_single(db_name: str, db_url: str) -> None:
    """สร้าง pool สำหรับ db_name (ต้องถือ lock ก่อนเรียก)"""
    if db_name in _pools:
        logger.info(f"ℹ️  Pool '{db_name}' already initialized — skipping")
        return
    try:
        _pools[db_name] = pool.ThreadedConnectionPool(_POOL_MIN, _POOL_MAX, db_url)
        logger.info(f"✅ DB pool '{db_name}' initialized (min={_POOL_MIN}, max={_POOL_MAX})")
    except OperationalError as e:
        logger.error(f"❌ Failed to create pool '{db_name}': {e}")
        raise


def close_db_pool(db_name: str | None = None) -> None:
    """
    db_name=None → ปิดทุก pool
    db_name="x"  → ปิดเฉพาะ pool นั้น
    """
    with _pools_lock:
        targets = [db_name] if db_name else list(_pools.keys())
        for name in targets:
            p = _pools.pop(name, None)
            if p:
                p.closeall()
                logger.info(f"🛑 DB pool '{name}' closed")


def get_db_names() -> list[str]:
    """คืนรายชื่อ DB ที่ init แล้วทั้งหมด"""
    return list(_pools.keys())


def get_connection(db_name: str = "default"):
    """ดึง connection จาก pool ของ db_name"""
    p = _pools.get(db_name)
    if p is None:
        raise RuntimeError(
            f"Pool '{db_name}' not initialized. "
            f"Available: {list(_pools.keys())}"
        )
    try:
        conn = p.getconn()
        if conn is None:
            raise RuntimeError(f"No available connections in pool '{db_name}'")
        return conn
    except pool.PoolError as e:
        logger.error(f"❌ Pool '{db_name}' exhausted: {e}")
        raise RuntimeError(f"Connection pool '{db_name}' exhausted: {e}") from e


def release_connection(conn, db_name: str = "default") -> None:
    """คืน connection กลับ pool ของ db_name"""
    p = _pools.get(db_name)
    if p:
        try:
            p.putconn(conn)
        except Exception as e:
            logger.warning(f"⚠️ Could not return connection to pool '{db_name}': {e}")
            try:
                conn.close()
            except Exception:
                pass
    else:
        try:
            conn.close()
        except Exception:
            pass
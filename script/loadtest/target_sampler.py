#!/usr/bin/env python3
"""Finite, read-only QA host/resource sampler for Django's loaded management shell."""

import json
import os
import time
from typing import Any, Dict, Mapping, Optional, Tuple

SAMPLE_PERIOD_SECONDS = 5.0
MAX_RUNTIME_SECONDS = 540.0
START_MARKER = "TARGET_SAMPLER_START"


def normalized_cpu_percent(previous: Mapping[str, int], current: Mapping[str, int]) -> Tuple[float, float]:
    """Return whole-host busy% and iowait% from two /proc/stat cpu snapshots."""
    prev_total = sum(int(previous.get(k, 0)) for k in ("user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"))
    curr_total = sum(int(current.get(k, 0)) for k in ("user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal"))
    total_delta = curr_total - prev_total
    if total_delta <= 0:
        return 0.0, 0.0
    idle_delta = int(current.get("idle", 0)) - int(previous.get("idle", 0))
    iowait_delta = int(current.get("iowait", 0)) - int(previous.get("iowait", 0))
    busy = max(0.0, min(100.0, 100.0 * (total_delta - idle_delta) / total_delta))
    iowait = max(0.0, min(100.0, 100.0 * iowait_delta / total_delta))
    return round(busy, 2), round(iowait, 2)


def memory_metrics(meminfo: Mapping[str, int]) -> Dict[str, Any]:
    """Calculate MemAvailable/MemTotal and the available-memory ratio from KiB values."""
    total = max(0, int(meminfo.get("MemTotal", 0)))
    available = max(0, int(meminfo.get("MemAvailable", 0)))
    ratio = (available / total) if total else 0.0
    return {"mem_total_kib": total, "mem_available_kib": available, "mem_available_ratio": round(ratio, 4)}


def pressure_predicates(cpu_percent: float, mem_available_ratio: float, db_connections: int, max_connections: int) -> Dict[str, bool]:
    """Return non-stateful pressure flags; sustained CPU is tracked by the supervisor."""
    ceiling = max(0, int(max_connections))
    return {
        "cpu_over_85": float(cpu_percent) > 85.0,
        "mem_available_under_10pct": float(mem_available_ratio) < 0.10,
        "db_connections_over_80pct": ceiling > 0 and int(db_connections) > (0.80 * ceiling),
    }


def _proc_cpu() -> Dict[str, int]:
    with open("/proc/stat", "r", encoding="ascii") as handle:
        fields = handle.readline().split()
    if not fields or fields[0] != "cpu":
        raise OSError("missing cpu line")
    names = ("user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal")
    return {name: int(value) for name, value in zip(names, fields[1:])}


def _proc_mem() -> Dict[str, int]:
    result: Dict[str, int] = {}
    with open("/proc/meminfo", "r", encoding="ascii") as handle:
        for line in handle:
            key, _, value = line.partition(":")
            if key in ("MemTotal", "MemAvailable"):
                result[key] = int(value.strip().split()[0])
    if "MemTotal" not in result or "MemAvailable" not in result:
        raise OSError("missing memory fields")
    return result


def _db_snapshot(connection: Any, max_connections: Optional[int]) -> Dict[str, Any]:
    """Use only aggregate PostgreSQL views; no SQL text, users, or application rows."""
    with connection.cursor() as cursor:
        if max_connections is None:
            cursor.execute("SHOW max_connections")
            max_connections = int(cursor.fetchone()[0])
        cursor.execute("SELECT state, count(*) FROM pg_stat_activity GROUP BY state")
        grouped = {str(state or "unknown"): int(count) for state, count in cursor.fetchall()}
        cursor.execute("SELECT count(*) FROM pg_stat_activity")
        global_count = int(cursor.fetchone()[0])
        current_db = getattr(connection, "settings_dict", {}).get("NAME")
        stats: Dict[str, Any] = {}
        if current_db:
            cursor.execute(
                "SELECT xact_commit, xact_rollback, blks_read, blks_hit "
                "FROM pg_stat_database WHERE datname = %s",
                [current_db],
            )
            row = cursor.fetchone()
            if row:
                stats = {"xact_commit": int(row[0]), "xact_rollback": int(row[1]), "blks_read": int(row[2]), "blks_hit": int(row[3])}
    return {
        "connections_by_state": grouped,
        "global_connection_count": global_count,
        "max_connections": int(max_connections),
        "monitor_db_connection_included": True,
        "current_db_stats": stats,
    }


def _emit(payload: Mapping[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")), flush=True)


def _sample(connection: Any, previous_cpu: Mapping[str, int], max_connections: Optional[int]) -> Tuple[Dict[str, Any], Dict[str, int], Optional[int]]:
    cpu = _proc_cpu()
    memory = memory_metrics(_proc_mem())
    busy, iowait = normalized_cpu_percent(previous_cpu, cpu)
    database = _db_snapshot(connection, max_connections)
    max_connections = database["max_connections"]
    pressure = pressure_predicates(busy, memory["mem_available_ratio"], database["global_connection_count"], max_connections)
    payload: Dict[str, Any] = {"ts": time.time(), "cpu_percent": busy, "iowait_percent": iowait, **memory, **database, "pressure": pressure}
    return payload, cpu, max_connections


def main() -> None:
    """Run at most 540 seconds; intended invocation is manage.py shell --command exec(...)."""
    if os.environ.get("HEALTHPAY_DEPLOYMENT_ENV") != "qa":
        _emit({"event": "ERROR", "code": "ENV_NOT_QA"})
        return
    _emit({"event": START_MARKER, "max_runtime_seconds": int(MAX_RUNTIME_SECONDS), "sample_period_seconds": int(SAMPLE_PERIOD_SECONDS)})
    try:
        # Django is intentionally imported only here; manage.py shell has already initialized it.
        from django.db import connection

        connection.ensure_connection()
        previous_cpu = _proc_cpu()
        max_connections: Optional[int] = None
        started = time.monotonic()
        next_sample = started
        while True:
            now = time.monotonic()
            if now - started > MAX_RUNTIME_SECONDS:
                break
            payload, previous_cpu, max_connections = _sample(connection, previous_cpu, max_connections)
            _emit(payload)
            next_sample += SAMPLE_PERIOD_SECONDS
            remaining = min(next_sample - time.monotonic(), started + MAX_RUNTIME_SECONDS - time.monotonic())
            if remaining > 0:
                time.sleep(remaining)
            if time.monotonic() >= started + MAX_RUNTIME_SECONDS:
                break
    except Exception as exc:
        # Deliberately do not print exception text, SQL, settings, or credentials.
        code = "DB_UNAVAILABLE" if exc.__class__.__name__ in {"OperationalError", "InterfaceError"} else "SAMPLER_FAILURE"
        _emit({"event": "ERROR", "code": code})


if __name__ == "__main__":
    main()

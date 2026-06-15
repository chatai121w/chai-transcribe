"""
GPU and system memory utilities.
Provides VRAM/RAM queries, GPU cleanup, and device detection.
"""

import time
import logging
import subprocess
from pathlib import Path

_log = logging.getLogger("whisper-server")

# Optional torch import
try:
    import torch
    _has_torch = True
except ImportError:
    torch = None  # type: ignore
    _has_torch = False

# ═══════════════════════════════════════════════════════════════════
#  Device / GPU Name Detection (cached)
# ═══════════════════════════════════════════════════════════════════

_cached_device: str | None = None
_cached_gpu_name: str | None = None


def get_device() -> str:
    """Detect best available device using CTranslate2 (cached)."""
    global _cached_device
    if _cached_device is not None:
        return _cached_device
    try:
        import ctranslate2
        cuda_types = ctranslate2.get_supported_compute_types("cuda")
        if cuda_types and len(cuda_types) > 0:
            _cached_device = "cuda"
            gpu_name = get_gpu_name() or "GPU (CUDA)"
            print(f"  GPU: {gpu_name} (CUDA via CTranslate2)")
            return "cuda"
    except Exception as e:
        print(f"  CUDA detection failed: {e}")
    print("  GPU: Not available, using CPU")
    _cached_device = "cpu"
    return "cpu"


def get_gpu_name() -> str | None:
    """Get GPU name for display (cached)."""
    global _cached_gpu_name
    if _cached_gpu_name is not None:
        return _cached_gpu_name
    if _has_torch:
        try:
            if torch.cuda.is_available():
                _cached_gpu_name = torch.cuda.get_device_name(0)
                return _cached_gpu_name
        except Exception:
            pass
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            _cached_gpu_name = result.stdout.strip()
            return _cached_gpu_name
    except Exception:
        pass
    return None


# ═══════════════════════════════════════════════════════════════════
#  GPU / System Memory Queries
# ═══════════════════════════════════════════════════════════════════

_gpu_mem_cache: dict | None = None
_gpu_mem_cache_time: float = 0.0


def get_gpu_mem() -> dict | None:
    """Get GPU memory usage in MB. Cached for 2s to keep /health fast."""
    global _gpu_mem_cache, _gpu_mem_cache_time
    now = time.time()
    if _gpu_mem_cache is not None and (now - _gpu_mem_cache_time) < 2.0:
        return _gpu_mem_cache
    result = None
    try:
        if _has_torch and torch.cuda.is_available():
            allocated = torch.cuda.memory_allocated(0) / 1024 / 1024
            reserved = torch.cuda.memory_reserved(0) / 1024 / 1024
            total = torch.cuda.get_device_properties(0).total_mem / 1024 / 1024
            result = {
                "allocated_mb": round(allocated, 1),
                "reserved_mb": round(reserved, 1),
                "total_mb": round(total, 1),
                "free_mb": round(total - reserved, 1),
                "utilization_pct": round(reserved / total * 100, 1) if total > 0 else 0,
            }
    except Exception:
        pass
    if result is None:
        try:
            r = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5
            )
            if r.returncode == 0:
                parts = r.stdout.strip().split(",")
                total, used, free = float(parts[0]), float(parts[1]), float(parts[2])
                result = {
                    "allocated_mb": round(used, 1),
                    "reserved_mb": round(used, 1),
                    "total_mb": round(total, 1),
                    "free_mb": round(free, 1),
                    "utilization_pct": round(used / total * 100, 1) if total > 0 else 0,
                }
        except Exception:
            pass
    _gpu_mem_cache = result
    _gpu_mem_cache_time = now
    return result


def get_system_mem() -> dict:
    """Get system RAM usage."""
    try:
        import psutil
        vm = psutil.virtual_memory()
        return {
            "total_gb": round(vm.total / 1024**3, 1),
            "used_gb": round(vm.used / 1024**3, 1),
            "free_gb": round(vm.available / 1024**3, 1),
            "percent": vm.percent,
        }
    except ImportError:
        pass
    # Fallback for Windows
    try:
        import ctypes
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(stat)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        return {
            "total_gb": round(stat.ullTotalPhys / 1024**3, 1),
            "used_gb": round((stat.ullTotalPhys - stat.ullAvailPhys) / 1024**3, 1),
            "free_gb": round(stat.ullAvailPhys / 1024**3, 1),
            "percent": stat.dwMemoryLoad,
        }
    except Exception:
        return {"error": "unavailable"}


def cleanup_gpu_memory():
    """Force garbage collection and clear CUDA cache to free VRAM."""
    import gc
    gc.collect()
    if _has_torch and torch.cuda.is_available():
        torch.cuda.empty_cache()
        _log.debug("GPU memory cleaned up (gc + empty_cache)")


def log_memory_state(label: str):
    """Log current GPU + system memory state."""
    gpu = get_gpu_mem()
    sys_mem = get_system_mem()
    gpu_str = f"GPU: {gpu['allocated_mb']:.0f}/{gpu['total_mb']:.0f} MB ({gpu['utilization_pct']:.0f}%)" if gpu else "GPU: N/A"
    ram_str = f"RAM: {sys_mem.get('used_gb', '?')}/{sys_mem.get('total_gb', '?')} GB ({sys_mem.get('percent', '?')}%)"
    _log.info(f"[MEM {label}] {gpu_str} | {ram_str}")


def auto_batch_size() -> int:
    """Auto-detect optimal batch size based on GPU VRAM.
    Rule: min(24, max(4, free_vram_mb // 512))
    Falls back to 8 if VRAM cannot be determined.
    """
    gpu = get_gpu_mem()
    if gpu and gpu.get("free_mb"):
        return min(24, max(4, int(gpu["free_mb"] // 512)))
    return 8

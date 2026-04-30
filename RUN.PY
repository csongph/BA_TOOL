"""
run.py - Full-stack project orchestrator
backend/api/main.py (FastAPI) + frontend/ (static HTML)
"""

import http
import subprocess, sys, time, webbrowser, os, threading, itertools, re, shutil

# ══════════════════════════════════════════════════════════════════════════════
# ANSI
# ══════════════════════════════════════════════════════════════════════════════
class C:
    RESET = "\033[0m";   BOLD  = "\033[1m";   DIM   = "\033[2m"
    WHITE = "\033[97m";  GRAY  = "\033[90m";  RED   = "\033[91m"
    GREEN = "\033[92m";  YELLOW= "\033[93m";  CYAN  = "\033[96m"
    MAGENTA="\033[95m";  BLUE  = "\033[94m"
    BG_DARK="\033[48;2;13;17;23m"

def s(text, *codes): return "".join(codes) + text + C.RESET
def vis(t): return re.sub(r"\033\[[0-9;]*m","",t)

def _enable_ansi():
    if sys.platform == "win32":
        import ctypes
        k = ctypes.windll.kernel32
        k.SetConsoleMode(k.GetStdHandle(-11), 7)

# ══════════════════════════════════════════════════════════════════════════════
# Config
# ══════════════════════════════════════════════════════════════════════════════
BACKEND_MODULE = "backend.api.main:app"
BACKEND_HOST   = "127.0.0.1"
BACKEND_PORT   = 8000
FRONTEND_DIR   = "./frontend/"
FRONTEND_PORT  = 5500
FRONTEND_URL   = f"http://127.0.0.1:{FRONTEND_PORT}/frontend/index.html"
BACKEND_URL    = f"http://{BACKEND_HOST}:{BACKEND_PORT}"
STARTUP_WAIT   = 3.0

# ══════════════════════════════════════════════════════════════════════════════
# Layout
# ══════════════════════════════════════════════════════════════════════════════
W = 62  # box inner width

def term_width():
    return shutil.get_terminal_size((80, 24)).columns

def blank(n=1): print("\n" * (n-1))

def box_line(l, r, mid, color=C.CYAN):
    print(s(l + mid * W + r, color))

def box_row(text="", color=C.CYAN, align="left"):
    v = vis(text)
    pad = W - len(v)
    if align == "center":
        lp, rp = pad//2, pad - pad//2
        inner = " "*lp + text + " "*rp
    else:
        inner = text + " "*max(pad,0)
    print(s("│", color) + inner + s("│", color))

def divider(color=C.CYAN): box_line("├","┤","─", color)

def center_text(text, color=C.CYAN):
    box_row(text, color, align="center")

def status_row(label, url, lc, uc, bc):
    dot  = s("  ●  ", C.DIM, C.CYAN)
    lbl  = s(f"{label:<10}", lc, C.DIM)
    arr  = s(" → ", C.GRAY)
    val  = s(url, uc, C.BOLD)
    box_row(dot + lbl + arr + val, bc)

# ══════════════════════════════════════════════════════════════════════════════
# Sections
# ══════════════════════════════════════════════════════════════════════════════
def print_banner():
    blank()
    box_line("╭","╮","─", C.CYAN)
    center_text(s(" ⚡  FULLSTACK DEV SERVER  ⚡ ", C.CYAN, C.BOLD))
    center_text(s("FastAPI  ·  uvicorn  ·  http.server", C.GRAY, C.DIM))
    box_line("╰","╯","─", C.CYAN)
    blank()

def step_line(icon, label, detail="", ic=C.CYAN, done=False):
    ico  = s(icon, ic, C.BOLD)
    lbl  = s(label, C.WHITE, C.BOLD)
    det  = s("  " + detail, C.GRAY, C.DIM) if detail else ""
    tag  = s("  done", C.GREEN, C.DIM) if done else ""
    print(f"  {ico}  {lbl}{det}{tag}")

def print_log_header():
    """เส้นคั่นก่อน uvicorn log จะไหลออกมา"""
    blank()
    tw = min(term_width(), 78)
    bar = s("─" * tw, C.GRAY, C.DIM)
    label = s("  uvicorn log  ", C.GRAY, C.DIM)
    half = (tw - len(vis(label))) // 2
    print(s("─"*half, C.GRAY, C.DIM) + label + s("─"*half, C.GRAY, C.DIM))

def print_log_footer():
    tw = min(term_width(), 78)
    print(s("─" * tw, C.GRAY, C.DIM))
    blank()

def info_box():
    box_line("╭","╮","─", C.GREEN)
    center_text(s("  SERVICES RUNNING  ", C.GREEN, C.BOLD), C.GREEN)
    divider(C.GREEN)
    box_row(color=C.GREEN)
    status_row("Backend",  BACKEND_URL,  C.CYAN,    C.GREEN, C.GREEN)
    status_row("Frontend", FRONTEND_URL, C.MAGENTA, C.GREEN, C.GREEN)
    box_row(color=C.GREEN)
    divider(C.GREEN)
    hint = s("Ctrl+C", C.YELLOW, C.BOLD) + s("  to stop all services", C.GRAY, C.DIM)
    center_text("  Press  " + hint + "  ", C.GREEN)
    box_row(color=C.GREEN)
    box_line("╰","╯","─", C.GREEN)
    blank()

def shutdown_box():
    blank()
    box_line("╭","╮","─", C.YELLOW)
    center_text(s("  SHUTTING DOWN  ", C.YELLOW, C.BOLD), C.YELLOW)
    box_line("╰","╯","─", C.YELLOW)
    blank()

def goodbye_box():
    box_line("╭","╮","─", C.GRAY)
    center_text(s("All services stopped.  Goodbye! 👋", C.WHITE), C.GRAY)
    box_line("╰","╯","─", C.GRAY)
    blank()

def err(msg):
    blank()
    box_line("╭","╮","─", C.RED)
    center_text(s(f"  ✘  {msg}  ", C.RED, C.BOLD), C.RED)
    box_line("╰","╯","─", C.RED)
    blank()

# ══════════════════════════════════════════════════════════════════════════════
# Spinner
# ══════════════════════════════════════════════════════════════════════════════
class Spinner:
    F = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]
    def __init__(self, msg, color=C.CYAN):
        self.msg=msg; self.color=color
        self._stop=threading.Event()
        self._t=threading.Thread(target=self._run, daemon=True)
    def _run(self):
        for f in itertools.cycle(self.F):
            if self._stop.is_set(): break
            sys.stdout.write(f"\r  {s(f,self.color,C.BOLD)}  {s(self.msg,C.WHITE)}   ")
            sys.stdout.flush(); time.sleep(0.08)
    def start(self): self._t.start(); return self
    def stop(self, ok=True):
        self._stop.set(); self._t.join()
        icon = s("✔",C.GREEN,C.BOLD) if ok else s("✘",C.RED,C.BOLD)
        sys.stdout.write(f"\r  {icon}  {s(self.msg,C.WHITE)}   \n")
        sys.stdout.flush()

# ══════════════════════════════════════════════════════════════════════════════
# Log streamer — อ่าน uvicorn stderr แล้วพิมพ์ในกล่อง dim สวยงาม
# ══════════════════════════════════════════════════════════════════════════════
class LogStreamer:
    """อ่าน stdout+stderr ของ process แล้วพิมพ์แบบ dim ออกมา"""
    def __init__(self, proc, prefix="BE", color=C.GRAY):
        self.proc=proc; self.prefix=prefix; self.color=color
        self._t=threading.Thread(target=self._stream, daemon=True)
    def _stream(self):
        for raw in self.proc.stdout:
            line = raw.decode("utf-8","replace").rstrip()
            if not line: continue
            # colorize INFO / WARNING / ERROR
            if "ERROR" in line or "error" in line:
                tag = s("ERR", C.RED, C.BOLD)
            elif "WARNING" in line or "warn" in line.lower():
                tag = s("WRN", C.YELLOW, C.BOLD)
            elif "Application startup complete" in line:
                tag = s(" ✔ ", C.GREEN, C.BOLD)
            elif "Started server process" in line or "Uvicorn running" in line:
                tag = s("RUN", C.CYAN, C.BOLD)
            else:
                tag = s("   ", C.GRAY, C.DIM)
            prefix = s(f"[{self.prefix}]", self.color, C.DIM)
            print(f"  {prefix} {tag}  {s(line, C.GRAY, C.DIM)}")
            sys.stdout.flush()
    def start(self): self._t.start(); return self

# ══════════════════════════════════════════════════════════════════════════════
# Process helpers
# ══════════════════════════════════════════════════════════════════════════════
def build_backend_cmd():
    return [sys.executable,"-m","uvicorn",
            BACKEND_MODULE,
            "--host", BACKEND_HOST,
            "--port", str(BACKEND_PORT),
            "--reload"]

def build_frontend_cmd():
    return [sys.executable,"-m","http.server",
            str(FRONTEND_PORT),
            "--directory", FRONTEND_DIR]

def terminate(proc, name):
    if proc.poll() is not None: return
    proc.terminate()
    try: proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        step_line("⚠", f"{name} force kill", ic=C.YELLOW)
        proc.kill(); proc.wait()

# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════
def main():
    _enable_ansi()
    print_banner()

    # แสดง config สั้นๆ
    step_line("ℹ", "module  ", BACKEND_MODULE, C.GRAY)
    step_line("ℹ", "frontend", FRONTEND_DIR,   C.GRAY)
    blank()

    if sys.platform == "win32":
        extra = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    else:
        extra = {"start_new_session": True}

    backend_proc = frontend_proc = None

    try:
        # ── 1. Backend ────────────────────────────────────────────────────────
        step_line("◈", "Starting backend...", f"uvicorn {BACKEND_MODULE}", C.CYAN)
        print_log_header()

        backend_proc = subprocess.Popen(
            build_backend_cmd(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,   # รวม stderr → stdout pipe เดียว
            **extra,
        )

        # stream log แบบ dim ใน thread แยก
        streamer = LogStreamer(backend_proc, prefix="BE", color=C.CYAN).start()

        # spinner รอ startup
        sp = Spinner(f"Waiting for backend on :{BACKEND_PORT}", C.CYAN).start()
        time.sleep(STARTUP_WAIT)
        sp.stop(ok=True)

        print_log_footer()

        if backend_proc.poll() is not None:
            err(f"Backend crash! (module: {BACKEND_MODULE})")
            sys.exit(1)

        # ── 2. Frontend ───────────────────────────────────────────────────────
        step_line("◈", "Starting frontend...", f"http.server :{FRONTEND_PORT}", C.MAGENTA)
        frontend_proc = subprocess.Popen(
            build_frontend_cmd(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **extra,
        )

        # ── 3. Browser ────────────────────────────────────────────────────────
        step_line("◈", "Opening browser...", FRONTEND_URL, C.YELLOW)
        webbrowser.open(FRONTEND_URL)

        # ── 4. Info panel + live API log ──────────────────────────────────────
        info_box()

        # หลังจากนี้ uvicorn log (GET /health ฯลฯ) จะยังไหลออกมาผ่าน streamer
        # แสดง header เพื่อให้รู้ว่านี่คือ live log
        tw = min(term_width(), 78)
        print(s("─"*((tw-14)//2), C.GRAY, C.DIM) +
              s("  live log  ", C.GRAY, C.DIM) +
              s("─"*((tw-14)//2), C.GRAY, C.DIM))
        blank()

        # ── 5. Watch loop ─────────────────────────────────────────────────────
        while True:
            if backend_proc.poll() is not None:
                err("Backend หยุดทำงานกะทันหัน!"); break
            if frontend_proc.poll() is not None:
                err("Frontend หยุดทำงานกะทันหัน!"); break
            time.sleep(1)

    except KeyboardInterrupt:
        pass

    finally:
        shutdown_box()
        if backend_proc:
            terminate(backend_proc, "Backend")
            step_line("✔", "Backend stopped.", ic=C.GREEN)
        if frontend_proc:
            terminate(frontend_proc, "Frontend")
            step_line("✔", "Frontend stopped.", ic=C.GREEN)
        goodbye_box()

if __name__ == "__main__":
    main()

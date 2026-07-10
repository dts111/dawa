"""
Claude DS — Local App Launcher
Tkinter GUI to start/stop all projects with one click.
"""
import tkinter as tk
from tkinter import font as tkfont
import subprocess
import os
import sys
import webbrowser
import threading

BASE = os.path.dirname(os.path.abspath(__file__))

# ── App definitions ────────────────────────────────────────────────────────────
APPS = [
    {
        "name": "Volume_Calculator",
        "desc": "LandXML surface volume · PDF & Excel reports",
        "accent": "#3b82f6",
        "bg": "#eff6ff",
        "backend_dir": os.path.join(BASE, "Volume_Calculator", "Volume_Calculator", "backend"),
        "backend_cmd": "uvicorn main:app --reload --port 8000",
        "frontend_dir": os.path.join(BASE, "Volume_Calculator", "Volume_Calculator", "frontend"),
        "frontend_cmd": "npm run dev",
        "url": "http://localhost:5173",
        "port_note": "Backend :8000  Frontend :5173",
    },
    {
        "name": "GIS Map",
        "desc": "Interactive mapping · Shapefile export",
        "accent": "#22c55e",
        "bg": "#f0fdf4",
        "backend_dir": os.path.join(BASE, "test", "backend"),
        "backend_cmd": "uvicorn main:app --reload --port 8000",
        "frontend_dir": os.path.join(BASE, "test", "frontend"),
        "frontend_cmd": "npm run dev",
        "url": "http://localhost:5173",
        "port_note": "Backend :8000  Frontend :5173",
    },
    {
        "name": "Diversion Planner",
        "desc": "M25 diversion routes · Draw closure · Consultation",
        "accent": "#f59e0b",
        "bg": "#fffbeb",
        "docker_dir": os.path.join(BASE, "Diversion_Planner"),
        "docker_services": "db backend",
        "frontend_dir": os.path.join(BASE, "Diversion_Planner", "frontend"),
        "frontend_cmd": "npm run dev",
        "url": "http://localhost:5173",
        "port_note": "Docker: db :5432  Backend :8001  |  Frontend :5173 (local)",
    },
    {
        "name": "Civil3D Tool",
        "desc": "AutoCAD / Civil3D desktop automation",
        "accent": "#8b5cf6",
        "bg": "#f5f3ff",
        "script_dir": os.path.join(BASE, "civil3App"),
        "script_cmd": [sys.executable, "app.py"],
        "url": None,
        "port_note": "Desktop GUI — no browser needed",
    },
    {
        "name": "dafegen.com",
        "desc": "Bespoke energy software · Nepal & emerging markets",
        "accent": "#7c3aed",
        "bg": "#f5f3ff",
        "static_file": os.path.join(BASE, "dafegen.com", "index.html"),
        "url": os.path.join(BASE, "dafegen.com", "index.html"),
        "port_note": "Static site — opens directly in browser",
    },
]

# ── Process registry ───────────────────────────────────────────────────────────
# Each entry: {"backend": Popen | None, "frontend": Popen | None}
procs = [{} for _ in APPS]


def _open_console(cwd: str, cmd: str) -> subprocess.Popen:
    """Launch cmd in a new visible CMD window; returns the Popen handle."""
    return subprocess.Popen(
        ["cmd", "/k", cmd],
        cwd=cwd,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )


def _launch_script(cwd: str, cmd: list) -> subprocess.Popen:
    """Launch a Python script in a new console window."""
    return subprocess.Popen(
        cmd,
        cwd=cwd,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )


def _is_alive(proc) -> bool:
    return proc is not None and proc.poll() is None


def launch(idx: int, cards: list):
    app = APPS[idx]
    p = procs[idx]

    if "static_file" in app:
        # Static site — just open in browser, no process to track
        webbrowser.open("file:///" + app["static_file"].replace("\\", "/"))
        return
    elif "script_cmd" in app:
        # Desktop app — single process
        if not _is_alive(p.get("script")):
            p["script"] = _launch_script(app["script_dir"], app["script_cmd"])
    elif "docker_dir" in app:
        # Docker Compose app (db + backend) + local frontend
        services = app.get("docker_services", "")
        if not _is_alive(p.get("docker")):
            p["docker"] = _open_console(app["docker_dir"], f"docker compose up {services}".strip())
        if app.get("frontend_dir") and not _is_alive(p.get("frontend")):
            def _start_fe():
                import time; time.sleep(3)
                p["frontend"] = _open_console(app["frontend_dir"], app["frontend_cmd"])
            threading.Thread(target=_start_fe, daemon=True).start()
    else:
        # Web app — backend + frontend
        if not _is_alive(p.get("backend")):
            p["backend"] = _open_console(app["backend_dir"], app["backend_cmd"])
        if not _is_alive(p.get("frontend")):
            # Small delay so backend starts first
            def _start_fe():
                import time; time.sleep(1.5)
                p["frontend"] = _open_console(app["frontend_dir"], app["frontend_cmd"])
            threading.Thread(target=_start_fe, daemon=True).start()

    # Refresh UI after a moment
    cards[idx]["root"].after(2000, lambda: refresh(idx, cards))


def stop(idx: int, cards: list):
    app = APPS[idx]
    p = procs[idx]
    if "docker_dir" in app:
        services = app.get("docker_services", "")
        subprocess.Popen(
            ["docker", "compose", "stop"] + (services.split() if services else []),
            cwd=app["docker_dir"],
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        for key in ("docker", "frontend"):
            proc = p.get(key)
            if _is_alive(proc):
                proc.terminate()
                p[key] = None
    else:
        for key in ("backend", "frontend", "script"):
            proc = p.get(key)
            if _is_alive(proc):
                proc.terminate()
                p[key] = None
    refresh(idx, cards)


def open_browser(url: str):
    webbrowser.open(url)


def refresh(idx: int, cards: list):
    app = APPS[idx]
    p = procs[idx]
    card = cards[idx]

    # Static sites have no process — dot stays neutral, buttons always enabled
    if "static_file" in app:
        card["dot"].config(bg="#7c3aed")
        card["status_lbl"].config(text="Static", fg="#5b21b6")
        return

    running = any(_is_alive(p.get(k)) for k in ("backend", "frontend", "script", "docker"))
    if running:
        card["dot"].config(bg="#22c55e")
        card["status_lbl"].config(text="Running", fg="#166534")
        if card.get("launch_btn"):
            card["launch_btn"].config(state="disabled")
        if card.get("stop_btn"):
            card["stop_btn"].config(state="normal")
        if card.get("open_btn"):
            card["open_btn"].config(state="normal")
    else:
        card["dot"].config(bg="#9ca3af")
        card["status_lbl"].config(text="Stopped", fg="#6b7280")
        if card.get("launch_btn"):
            card["launch_btn"].config(state="normal")
        if card.get("stop_btn"):
            card["stop_btn"].config(state="disabled")
        if card.get("open_btn"):
            card["open_btn"].config(state="disabled")


def stop_all(cards: list):
    for i in range(len(APPS)):
        stop(i, cards)


# ── UI ─────────────────────────────────────────────────────────────────────────
def build_ui():
    root = tk.Tk()
    root.title("Claude DS — App Launcher")
    root.resizable(False, False)
    root.configure(bg="#0f172a")

    # Fonts
    title_font   = tkfont.Font(family="Segoe UI", size=13, weight="bold")
    app_font     = tkfont.Font(family="Segoe UI", size=11, weight="bold")
    desc_font    = tkfont.Font(family="Segoe UI", size=9)
    port_font    = tkfont.Font(family="Consolas",  size=8)
    btn_font     = tkfont.Font(family="Segoe UI", size=9, weight="bold")
    status_font  = tkfont.Font(family="Segoe UI", size=9, weight="bold")

    # ── Header ──────────────────────────────────────────────────────
    hdr = tk.Frame(root, bg="#0f172a", pady=14, padx=20)
    hdr.pack(fill="x")
    tk.Label(hdr, text="Claude DS", font=title_font, bg="#0f172a", fg="#f8fafc").pack(side="left")
    tk.Label(hdr, text="  App Launcher", font=tkfont.Font(family="Segoe UI", size=13),
             bg="#0f172a", fg="#64748b").pack(side="left")

    # ── Divider ─────────────────────────────────────────────────────
    tk.Frame(root, bg="#1e293b", height=1).pack(fill="x")

    cards_container = tk.Frame(root, bg="#0f172a", padx=12, pady=12)
    cards_container.pack(fill="both")

    cards = []

    for idx, app in enumerate(APPS):
        # Card frame
        card_frame = tk.Frame(
            cards_container, bg=app["bg"],
            bd=0, relief="flat",
            padx=16, pady=12,
        )
        card_frame.pack(fill="x", pady=5)

        # Accent bar (left edge)
        accent = tk.Frame(card_frame, bg=app["accent"], width=4)
        accent.pack(side="left", fill="y", padx=(0, 12))

        # Content
        content = tk.Frame(card_frame, bg=app["bg"])
        content.pack(side="left", fill="both", expand=True)

        # Row 1: name + status
        row1 = tk.Frame(content, bg=app["bg"])
        row1.pack(fill="x")

        tk.Label(row1, text=app["name"], font=app_font,
                 bg=app["bg"], fg="#0f172a").pack(side="left")

        status_frame = tk.Frame(row1, bg=app["bg"])
        status_frame.pack(side="right")

        dot = tk.Label(status_frame, bg="#9ca3af", width=2, height=1, relief="flat")
        dot.pack(side="left", padx=(0, 4))

        status_lbl = tk.Label(status_frame, text="Stopped", font=status_font,
                               bg=app["bg"], fg="#6b7280", width=7, anchor="w")
        status_lbl.pack(side="left")

        # Row 2: description
        tk.Label(content, text=app["desc"], font=desc_font,
                 bg=app["bg"], fg="#475569", anchor="w").pack(fill="x", pady=(2, 0))

        # Row 3: port note
        tk.Label(content, text=app["port_note"], font=port_font,
                 bg=app["bg"], fg="#94a3b8", anchor="w").pack(fill="x")

        # Row 4: buttons
        btn_row = tk.Frame(content, bg=app["bg"])
        btn_row.pack(fill="x", pady=(8, 0))

        def make_launch(i):
            return lambda: launch(i, cards)

        def make_stop(i):
            return lambda: stop(i, cards)

        launch_btn = None
        stop_btn = None
        open_btn = None

        if "static_file" in app:
            # Static site — single Open button, no launch/stop needed
            def make_open_static(i):
                return lambda: launch(i, cards)

            open_btn = tk.Button(
                btn_row, text="⬡  Open in Browser", font=btn_font,
                bg=app["accent"], fg="white", relief="flat",
                padx=12, pady=4, cursor="hand2",
                activebackground=app["accent"], activeforeground="white",
                command=make_open_static(idx),
            )
            open_btn.pack(side="left")
        else:
            launch_btn = tk.Button(
                btn_row, text="▶  Launch", font=btn_font,
                bg=app["accent"], fg="white", relief="flat",
                padx=12, pady=4, cursor="hand2",
                activebackground=app["accent"], activeforeground="white",
                command=make_launch(idx),
            )
            launch_btn.pack(side="left", padx=(0, 6))

            stop_btn = tk.Button(
                btn_row, text="■  Stop", font=btn_font,
                bg="#e2e8f0", fg="#475569", relief="flat",
                padx=12, pady=4, cursor="hand2",
                activebackground="#cbd5e1", activeforeground="#1e293b",
                state="disabled",
                command=make_stop(idx),
            )
            stop_btn.pack(side="left", padx=(0, 6))

            if app.get("url"):
                def make_open(u):
                    return lambda: open_browser(u)

                open_btn = tk.Button(
                    btn_row, text="⬡  Open in Browser", font=btn_font,
                    bg="white", fg="#3b82f6", relief="flat",
                    padx=12, pady=4, cursor="hand2",
                    activebackground="#eff6ff", activeforeground="#1d4ed8",
                    state="disabled",
                    command=make_open(app["url"]),
                )
                open_btn.pack(side="left")

        card_data = {
            "root": root,
            "dot": dot,
            "status_lbl": status_lbl,
            "launch_btn": launch_btn,
            "stop_btn": stop_btn,
            "open_btn": open_btn,
        }
        cards.append(card_data)

    # ── Footer ───────────────────────────────────────────────────────
    tk.Frame(root, bg="#1e293b", height=1).pack(fill="x")

    footer = tk.Frame(root, bg="#0f172a", pady=10, padx=20)
    footer.pack(fill="x")

    tk.Label(
        footer,
        text="Volume_Calculator and GIS Map share port 8000 — run only one at a time.",
        font=tkfont.Font(family="Segoe UI", size=8),
        bg="#0f172a", fg="#64748b",
    ).pack(side="left")

    tk.Button(
        footer, text="Stop All", font=btn_font,
        bg="#dc2626", fg="white", relief="flat",
        padx=10, pady=4, cursor="hand2",
        activebackground="#b91c1c", activeforeground="white",
        command=lambda: stop_all(cards),
    ).pack(side="right")

    # ── Poll process states every 3 s ────────────────────────────────
    def poll():
        for i in range(len(APPS)):
            refresh(i, cards)
        root.after(3000, poll)

    root.after(3000, poll)

    # Kill all child processes on close
    def on_close():
        stop_all(cards)
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.mainloop()


if __name__ == "__main__":
    build_ui()

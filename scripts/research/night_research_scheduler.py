#!/usr/bin/env python3
"""Queue bounded continuation turns into one Codex thread for about 10 hours.

The scheduler is intentionally local and one-thread-only:
- launchd owns a 30-second local loop and an independent interval timer;
- it skips while a turn is active or any continuation is already pending;
- it queues at most one continuation per interval;
- it self-unloads and stops the keep-awake helper after the deadline.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

LABEL = "com.guoer.personal-blog.night-research"
ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = ROOT / "output" / "research-scheduler"
STATE_PATH = STATE_DIR / "state.json"
LOCK_PATH = STATE_DIR / "runner.lock"
LOG_PATH = STATE_DIR / "scheduler.log"
STOP_PATH = STATE_DIR / "STOP"
DAEMON_PID_PATH = STATE_DIR / "daemon.pid"
DAEMON_LOG_PATH = STATE_DIR / "daemon.log"
QUEUE_DB_PATH = Path.home() / ".codex" / "queue_1.sqlite"
PLIST_PATH = STATE_DIR / f"{LABEL}.plist"
PROMPT = (
    "DDW 研究续跑（第 {round} 轮）。工作目录固定为 /Volumes/2tb/mydata/code/vllm/personal-blog；"
    "所有读写都以该目录为根，先读取 docs/research/00-research-plan.md 和最新阶段记录，"
    "并运行 git status 确认现有未提交改动，不得覆盖或回退其他并行工作。"
    "只推进当前门禁允许的一个可验证子任务，单轮聚焦约 30–35 分钟。"
    "把证据、实验、复测结果和下一步假设写入 docs/research/；若上一轮结论未复测，先补复测。"
    "不要创建研究目标，不要设置 token budget；不要复制 Lusion 的素材、着色器、模型、音频或文案。"
    "本轮结束时明确写出完成项、未决项和下一轮唯一优先假设，然后停止，等待下一次调度。"
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat(timespec="seconds")


def log(message: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = iso_now()
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"{stamp} {message}\n")


def read_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        raise SystemExit("No scheduler state. Run: night_research_scheduler.py start --thread <id>")
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def write_state(state: dict[str, Any]) -> None:
    # launchd and the fallback daemon can write concurrently. A unique temp
    # file prevents one writer from replacing another writer's temp file.
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        dir=STATE_DIR, prefix=".state-", suffix=".tmp"
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(STATE_PATH)
    finally:
        with suppress(FileNotFoundError):
            temporary.unlink()


def pending_queued_items(thread_id: str) -> int | None:
    """Return pending continuation count, or None if the queue DB is unavailable."""
    if not QUEUE_DB_PATH.exists():
        return None
    try:
        with sqlite3.connect(f"file:{QUEUE_DB_PATH}?mode=ro", uri=True, timeout=2) as handle:
            row = handle.execute(
                "SELECT COUNT(*) FROM queued_items WHERE thread_id = ?", (thread_id,)
            ).fetchone()
        return int(row[0]) if row else 0
    except sqlite3.Error:
        return None


@contextmanager
def exclusive_runner_lock() -> Iterator[None]:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with LOCK_PATH.open("a+") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Another scheduler check is already running.")
        yield


def run_command(args: list[str], *, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=False)


def gui_domain() -> str:
    return f"gui/{os.getuid()}"


def launchctl(*args: str) -> subprocess.CompletedProcess[str]:
    return run_command(["launchctl", *args], timeout=30)


def find_session(thread_id: str) -> Path | None:
    sessions = Path.home() / ".codex" / "sessions"
    if not sessions.exists():
        return None
    matches = list(sessions.rglob(f"*{thread_id}*.jsonl"))
    return max(matches, key=lambda path: path.stat().st_mtime) if matches else None


def session_is_active(thread_id: str) -> bool:
    """Return whether the latest persisted lifecycle event is task_started."""
    session = find_session(thread_id)
    if session is None:
        return False
    latest_started = ""
    latest_completed = ""
    with session.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("type") != "event_msg":
                continue
            payload = entry.get("payload", {})
            kind = payload.get("type")
            stamp = str(entry.get("timestamp", ""))
            if kind == "task_started":
                latest_started = max(latest_started, stamp)
            elif kind == "task_complete":
                latest_completed = max(latest_completed, stamp)
    return bool(latest_started and latest_started > latest_completed)


def start_keep_awake(seconds: int) -> int | None:
    executable = shutil.which("caffeinate")
    if not executable:
        return None
    process = subprocess.Popen(
        [executable, "-dimsu", "-t", str(max(1, seconds))],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return process.pid


def stop_keep_awake(pid: int | None) -> None:
    if not pid:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except PermissionError:
        log(f"Could not stop caffeinate pid={pid}: permission denied")


def plist_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def write_plist(python_bin: str, interval_seconds: int) -> None:
    escaped_script = plist_escape(str(Path(__file__).resolve()))
    escaped_python = plist_escape(python_bin)
    escaped_root = plist_escape(str(ROOT))
    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{escaped_python}</string>
    <string>{escaped_script}</string>
    <string>run-daemon</string>
  </array>
  <key>WorkingDirectory</key><string>{escaped_root}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>60</integer>
</dict>
</plist>
"""
    PLIST_PATH.write_text(plist, encoding="utf-8")


def write_interval_agent(python_bin: str, interval_seconds: int) -> None:
    """Write a separate launchd timer independent of the daemon process."""
    interval_label = f"{LABEL}.tick"
    interval_path = STATE_DIR / f"{interval_label}.plist"
    escaped_script = plist_escape(str(Path(__file__).resolve()))
    escaped_python = plist_escape(python_bin)
    escaped_root = plist_escape(str(ROOT))
    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{interval_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{escaped_python}</string>
    <string>{escaped_script}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key><string>{escaped_root}</string>
  <key>StartInterval</key><integer>{interval_seconds}</integer>
  <key>RunAtLoad</key><false/>
  <key>ThrottleInterval</key><integer>60</integer>
</dict>
</plist>
"""
    interval_path.write_text(plist, encoding="utf-8")


def install_agent() -> None:
    user_agents = Path.home() / "Library" / "LaunchAgents"
    user_agents.mkdir(parents=True, exist_ok=True)
    labels = [LABEL, f"{LABEL}.tick"]
    for label in labels:
        source = STATE_DIR / f"{label}.plist"
        installed = user_agents / source.name
        shutil.copy2(source, installed)
        installed.chmod(0o644)
    # Do not set StandardOutPath/StandardErrorPath to this workspace: on this
    # machine launchd rejects that configuration with EX_CONFIG (78), while the
    # same program works without those two keys. The script logs internally.
    # Use one directory bootstrap to avoid macOS's duplicate registration
    # errors when both individual plists are loaded in the same GUI domain.
    boot = launchctl("bootstrap", gui_domain(), str(user_agents))
    if boot.returncode != 0:
        for label in labels:
            print_result = launchctl("print", f"{gui_domain()}/{label}")
            if print_result.returncode != 0:
                raise SystemExit(
                    f"launchctl bootstrap failed for {label}: "
                    f"{boot.stderr.strip() or boot.stdout.strip()}"
                )
    # RunAtLoad starts the long-lived daemon at bootstrap; kickstart only the
    # one-shot timer. Calling `kickstart -k` on the daemon blocks by design
    # until that never-ending process exits, which is not an install failure.
    kick = launchctl("kickstart", "-k", f"{gui_domain()}/{LABEL}.tick")
    if kick.returncode != 0:
        raise SystemExit(
            f"launchctl kickstart failed for {LABEL}.tick: "
            f"{kick.stderr.strip() or kick.stdout.strip()}"
        )


def process_is_alive(pid: Any) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except (ProcessLookupError, ValueError):
        return False
    except PermissionError:
        return True
    return True


def daemon_is_alive() -> bool:
    """Check the launchd-owned loop, with a PID fallback for manual runs."""
    service = launchctl("print", f"{gui_domain()}/{LABEL}")
    if service.returncode == 0:
        match = re.search(r"\n\s*state = (running|spawn scheduled)", service.stdout)
        if match:
            return True
    if not DAEMON_PID_PATH.exists():
        return False
    try:
        pid = int(DAEMON_PID_PATH.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return False
    return process_is_alive(pid)


def stop_daemon() -> None:
    # launchd owns the primary loop. stop_scheduler boots it out together
    # with the interval timer. A deadline reached inside the loop exits
    # cleanly, and KeepAlive.SuccessfulExit=false prevents a restart.
    with suppress(FileNotFoundError):
        DAEMON_PID_PATH.unlink()


def unload_agent() -> None:
    for label in (LABEL, f"{LABEL}.tick"):
        launchctl("bootout", f"{gui_domain()}/{label}")
        installed = Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"
        if installed.exists():
            installed.unlink()


def stop_scheduler(reason: str, *, unload: bool = True) -> None:
    state = read_state()
    if state.get("status") != "stopped":
        state["status"] = "stopped"
        state["stopped_at"] = iso_now()
        state["stop_reason"] = reason
        write_state(state)
    stop_keep_awake(state.get("caffeinate_pid"))
    stop_daemon()
    if unload:
        unload_agent()
    log(f"stopped: {reason}")


def queue_message(state: dict[str, Any]) -> str:
    round_number = int(state.get("rounds_queued", 0)) + 1
    message = PROMPT.format(round=round_number)
    result = run_command(
        [state["codex_bin"], "queue", "--thread", state["thread_id"], "--message", message],
        timeout=45,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"codex queue failed ({result.returncode}): {result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout.strip()


def cmd_start(args: argparse.Namespace) -> int:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if STATE_PATH.exists():
        previous = read_state()
        if previous.get("status") == "running" and int(previous.get("deadline_epoch", 0)) > int(time.time()):
            print(json.dumps(previous, ensure_ascii=False, indent=2))
            raise SystemExit("A running scheduler already exists; run stop first or inspect status.")

    if not args.thread or not args.thread.strip():
        raise SystemExit("A Codex thread id is required.")
    codex_bin = shutil.which("codex")
    if not codex_bin:
        raise SystemExit("The codex CLI is not on PATH.")

    if STOP_PATH.exists():
        STOP_PATH.unlink()
    duration = int(args.duration_hours * 3600)
    interval = int(args.interval_minutes * 60)
    if duration <= interval:
        raise SystemExit("Duration must be longer than one interval.")

    now = int(time.time())
    state: dict[str, Any] = {
        "status": "running",
        "label": LABEL,
        "thread_id": args.thread.strip(),
        "codex_bin": codex_bin,
        "started_at": iso_now(),
        "started_epoch": now,
        "deadline_epoch": now + duration,
        "deadline_at": datetime.fromtimestamp(now + duration, timezone.utc).isoformat(timespec="seconds"),
        "interval_seconds": interval,
        "rounds_queued": 0,
        "queues": [],
        "last_queue_at": None,
        "last_queue_epoch": 0,
    }
    write_plist(sys.executable, interval)
    write_interval_agent(sys.executable, interval)
    for plist in (PLIST_PATH, STATE_DIR / f"{LABEL}.tick.plist"):
        check = run_command(["plutil", "-lint", str(plist)])
        if check.returncode != 0:
            raise SystemExit(check.stderr.strip() or check.stdout.strip())

    # Publish the running state before launchd starts the RunAtLoad daemon.
    # Otherwise the daemon can observe the previous stopped state, exit 1, and
    # leave launchd in a needless restart loop during startup.
    state["caffeinate_pid"] = start_keep_awake(duration)
    write_state(state)
    unload_agent()
    install_agent()

    state["daemon_pid"] = None
    write_state(state)
    log(
        f"started thread={state['thread_id']} duration={duration}s "
        f"interval={interval}s caffeinate_pid={state.get('caffeinate_pid')}"
    )

    # Queue one immediate continuation after the current turn. The scheduled
    # first check happens only after the interval, preventing a duplicate.
    result = run_command(
        [sys.executable, str(Path(__file__).resolve()), "run", "--force", "--allow-active"],
        timeout=70,
    )
    if result.returncode != 0:
        stop_scheduler("initial queue failed")
        raise SystemExit(result.stderr.strip() or result.stdout.strip())
    print(json.dumps(read_state(), ensure_ascii=False, indent=2))
    return 0


def cmd_run_daemon(_: argparse.Namespace) -> int:
    # launchd owns this process lifecycle. It checks every 30 seconds while
    # launchd's 40-minute StartInterval is the independent fallback wake path.
    # KeepAlive only restarts this loop when it exits unexpectedly; a stopped
    # scheduler therefore exits cleanly and launchd does not restart it.
    while True:
        if not STATE_PATH.exists():
            log("daemon: no state; exiting")
            return 0
        state = read_state()
        if state.get("status") != "running":
            log("daemon: state stopped; exiting")
            # KeepAlive.SuccessfulExit=false makes launchd remove this job.
            return 1
        if STOP_PATH.exists():
            stop_scheduler("STOP marker present", unload=False)
            return 0
        if int(time.time()) >= int(state.get("deadline_epoch", 0)):
            stop_scheduler("10-hour deadline reached", unload=False)
            return 0
        try:
            cmd_run(argparse.Namespace(force=False, allow_active=False))
        except Exception as error:
            log(f"daemon check failed: {error}")
        time.sleep(30)


def cmd_run(args: argparse.Namespace) -> int:
    if not STATE_PATH.exists():
        log("no state; nothing to do")
        return 0
    # Record every launchd wake, including throttled and active-thread skips.
    # This is the liveness signal used by `diagnose`; relying only on
    # launchctl's transient process state can mislabel a healthy interval job.
    try:
        heartbeat = read_state()
        heartbeat["last_wake_at"] = iso_now()
        heartbeat["last_wake_epoch"] = int(time.time())
        write_state(heartbeat)
    except Exception as error:
        log(f"heartbeat write failed: {error}")
        return 1
    with exclusive_runner_lock():
        state = read_state()
        now = int(time.time())
        if state.get("status") != "running":
            log("runner skipped because state is not running")
            return 0
        if STOP_PATH.exists():
            stop_scheduler("STOP marker present")
            return 0
        if now >= int(state.get("deadline_epoch", 0)):
            stop_scheduler("10-hour deadline reached")
            return 0

        pending = pending_queued_items(state["thread_id"])
        if pending is not None and pending > 0:
            log(f"skip: {pending} queued turn(s) already pending")
            return 0

        active = session_is_active(state["thread_id"])
        if active and not args.allow_active:
            log("skip: target thread has an active turn")
            return 0

        if not args.force and now - int(state.get("last_queue_epoch", 0)) < int(state["interval_seconds"]):
            log("skip: interval has not elapsed")
            return 0

        try:
            queue_output = queue_message(state)
        except Exception as error:  # Keep launchd alive; report the failure in state/log.
            state["last_error"] = str(error)
            state["last_error_at"] = iso_now()
            write_state(state)
            log(f"queue failed: {error}")
            return 1

        state["rounds_queued"] = int(state.get("rounds_queued", 0)) + 1
        state["last_queue_at"] = iso_now()
        state["last_queue_epoch"] = now
        state["last_queue_output"] = queue_output
        state.pop("last_error", None)
        state.pop("last_error_at", None)
        state.setdefault("queues", []).append(
            {"round": state["rounds_queued"], "queued_at": state["last_queue_at"], "result": queue_output}
        )
        write_state(state)
        log(f"queued round={state['rounds_queued']} active={active} result={queue_output}")
    return 0


def launchd_service_status(label: str) -> dict[str, Any]:
    result = launchctl("print", f"{gui_domain()}/{label}")
    text = (result.stdout or result.stderr).strip()
    exit_match = re.search(r"last exit code = ([^\n]+)", text)
    state_match = re.search(r"\n\s*state = ([^\n]+)", text)
    return {
        "label": label,
        "loaded": result.returncode == 0,
        "state": state_match.group(1).strip() if state_match else None,
        "last_exit": exit_match.group(1).strip() if exit_match else None,
        "details": text,
    }


def cmd_diagnose(_: argparse.Namespace) -> int:
    state = read_state()
    installed = Path.home() / "Library" / "LaunchAgents" / PLIST_PATH.name
    print(json.dumps({
        "state": state,
        "installed_plist": str(installed),
        "installed_plist_exists": installed.exists(),
        "launchd_daemon": launchd_service_status(LABEL),
        "launchd_interval": launchd_service_status(f"{LABEL}.tick"),
        "stop_marker_exists": STOP_PATH.exists(),
        "caffeinate_alive": process_is_alive(state.get("caffeinate_pid")),
        "pending_queued_items": pending_queued_items(state["thread_id"]),
        "last_wake_at": state.get("last_wake_at"),
        "daemon_log": str(DAEMON_LOG_PATH),
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_status(_: argparse.Namespace) -> int:
    if not STATE_PATH.exists():
        print("scheduler not initialized")
        return 0
    state = read_state()
    session = find_session(state["thread_id"])
    payload = {
        **state,
        "session_file": str(session) if session else None,
        "thread_active": session_is_active(state["thread_id"]),
        "pending_queued_items": pending_queued_items(state["thread_id"]),
        "daemon_alive": daemon_is_alive(),
        "daemon_pid": int(DAEMON_PID_PATH.read_text(encoding="utf-8").strip())
        if DAEMON_PID_PATH.exists()
        and process_is_alive(DAEMON_PID_PATH.read_text(encoding="utf-8").strip())
        else None,
        "launchd_daemon": launchd_service_status(LABEL),
        "launchd_interval": launchd_service_status(f"{LABEL}.tick"),
        "now": iso_now(),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_stop(_: argparse.Namespace) -> int:
    if not STATE_PATH.exists():
        print("scheduler not initialized")
        return 0
    stop_scheduler("user requested stop")
    print(json.dumps(read_state(), ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    start = subparsers.add_parser("start", help="Start the 10-hour local scheduler")
    start.add_argument("--thread", required=True, help="Existing Codex thread/session UUID")
    start.add_argument("--duration-hours", type=float, default=10.0)
    start.add_argument("--interval-minutes", type=float, default=40.0)
    start.set_defaults(func=cmd_start)

    run = subparsers.add_parser("run", help="Run one scheduler check")
    run.add_argument("--force", action="store_true", help="Ignore interval throttle")
    run.add_argument("--allow-active", action="store_true", help="Queue even when a turn is active")
    run.set_defaults(func=cmd_run)

    status = subparsers.add_parser("status", help="Show scheduler state")
    status.set_defaults(func=cmd_status)

    daemon = subparsers.add_parser("run-daemon", help="Run the local fallback daemon")
    daemon.set_defaults(func=cmd_run_daemon)

    diagnose = subparsers.add_parser("diagnose", help="Show scheduler diagnostics")
    diagnose.set_defaults(func=cmd_diagnose)

    stop = subparsers.add_parser("stop", help="Stop and unload the scheduler")
    stop.set_defaults(func=cmd_stop)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

"""CLI client for LLM Chess Arena — connects to the running API server.

Usage:
    cd backend
    uv run python -m app.cli --white anthropic/claude-sonnet-4-5 --black google/gemini-2.5-flash
    uv run python -m app.cli --watch <game_id>          # Watch an existing game
    uv run python -m app.cli --server http://host:8000   # Custom server URL
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

import httpx
import websockets

from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.rule import Rule
from rich import box

console = Console()

DEFAULT_SERVER = "http://localhost:8000"

# Colors and symbols per classification
CLASS_STYLE = {
    "brilliant": ("bold bright_cyan", "!!"),
    "great": ("bold blue", "!"),
    "best": ("bold green", "★"),
    "excellent": ("green", "✓"),
    "good": ("dim green", ""),
    "inaccuracy": ("yellow", "?!"),
    "mistake": ("bold yellow", "?"),
    "blunder": ("bold red", "??"),
}


def make_eval_bar(win_prob_white: float, width: int = 20) -> Text:
    """Render a horizontal eval bar: white portion vs black portion."""
    white_blocks = round(win_prob_white * width)
    black_blocks = width - white_blocks
    bar = Text()
    bar.append("█" * white_blocks, style="white on white")
    bar.append("█" * black_blocks, style="bright_black on bright_black")
    return bar


def format_eval_text(cp: int | None, mate_in: int | None) -> Text:
    """Format evaluation as colored text."""
    if cp is None and mate_in is None:
        return Text("N/A", style="dim")
    if mate_in is not None:
        label = f"M{abs(mate_in)}"
        style = "bold bright_cyan" if mate_in > 0 else "bold red"
    else:
        label = f"{'+' if cp >= 0 else ''}{cp / 100:.2f}"
        if cp > 100:
            style = "bold white"
        elif cp > 0:
            style = "white"
        elif cp > -100:
            style = "bright_black"
        else:
            style = "bold bright_black"
    return Text(label, style=style)


def format_tokens(input_tokens: int | None, output_tokens: int | None) -> Text:
    """Format token counts."""
    t = Text()
    if input_tokens is None and output_tokens is None:
        return t
    t.append("  Tokens: ", style="dim")
    inp = input_tokens or 0
    out = output_tokens or 0
    t.append(f"{inp}", style="cyan")
    t.append(" in / ", style="dim")
    t.append(f"{out}", style="magenta")
    t.append(" out", style="dim")
    # Tokens per second (approx)
    return t


def format_cost(cost_usd: float | None) -> Text:
    """Format cost."""
    t = Text()
    if cost_usd is None:
        return t
    t.append("  Cost: ", style="dim")
    if cost_usd < 0.001:
        t.append(f"${cost_usd:.6f}", style="green")
    elif cost_usd < 0.01:
        t.append(f"${cost_usd:.4f}", style="green")
    else:
        t.append(f"${cost_usd:.4f}", style="yellow")
    return t


def render_move(data: dict) -> Panel:
    """Render a single move event as a rich Panel."""
    color = data["color"]
    is_white = color == "white"
    move_number = data["move_number"]
    san = data["san"]
    prefix = f"{move_number}." if is_white else f"{move_number}..."

    classification = data.get("classification")

    # Header: move + classification
    header = Text()
    header.append(prefix + " ", style="dim")
    header.append(san, style="bold white" if is_white else "bold bright_black")

    if classification and classification in CLASS_STYLE:
        style, symbol = CLASS_STYLE[classification]
        if symbol:
            header.append(f" {symbol}", style=style)
        header.append(f" ({classification})", style=style)

    # Eval line — handle both nested eval_after (from MoveRecord) and flat fields
    eval_after = data.get("eval_after")
    if eval_after and isinstance(eval_after, dict):
        cp = eval_after.get("centipawns")
        mate = eval_after.get("mate_in")
        wp = eval_after.get("win_probability_white")
    else:
        cp = data.get("centipawns")
        mate = data.get("mate_in")
        wp = data.get("win_probability")

    eval_line = Text()
    if cp is not None or mate is not None:
        eval_text = format_eval_text(cp, mate)
        eval_line.append("  Eval: ")
        eval_line.append_text(eval_text)
        if wp is not None:
            bar = make_eval_bar(wp)
            eval_line.append("  ")
            eval_line.append_text(bar)
            eval_line.append(f"  ({wp * 100:.1f}%)", style="dim")

    # Best move comparison
    best_line = Text()
    best_uci = data.get("best_move_uci")
    if best_uci and best_uci != data.get("uci"):
        best_line.append("  Best: ", style="dim")
        best_line.append(best_uci, style="dim italic")

    # Opening
    opening_line = Text()
    if data.get("opening_name"):
        opening_line.append("  Opening: ", style="dim")
        opening_line.append(f"{data.get('opening_eco', '')} ", style="bold cyan")
        opening_line.append(data["opening_name"], style="cyan")

    # Timing + tokens/cost
    time_line = Text()
    response_time_ms = data.get("response_time_ms", 0)
    secs = response_time_ms / 1000
    time_line.append("  Time: ", style="dim")
    time_style = "red" if secs > 30 else "yellow" if secs > 10 else "green"
    time_line.append(f"{secs:.1f}s", style=time_style)

    # Tokens per second
    output_tokens = data.get("output_tokens")
    if output_tokens and secs > 0:
        tps = output_tokens / secs
        time_line.append(f"  ({tps:.0f} tok/s)", style="dim")

    token_line = format_tokens(data.get("input_tokens"), data.get("output_tokens"))
    cost_line = format_cost(data.get("cost_usd"))

    # Narration
    narration = (data.get("narration") or "").strip()
    if len(narration) > 300:
        narration = narration[:297] + "..."

    # Compose content
    content = Text()
    if eval_line.plain:
        content.append_text(eval_line)
    if best_line.plain:
        content.append("\n")
        content.append_text(best_line)
    if opening_line.plain:
        content.append("\n")
        content.append_text(opening_line)
    content.append("\n")
    content.append_text(time_line)
    if token_line.plain:
        content.append_text(token_line)
    if cost_line.plain:
        content.append_text(cost_line)
    if narration:
        content.append("\n\n")
        content.append(narration, style="italic dim")

    border_style = "white" if is_white else "bright_black"
    return Panel(
        content,
        title=header,
        border_style=border_style,
        box=box.ROUNDED,
        padding=(0, 1),
    )


def render_game_over(data: dict, white_model: str, black_model: str) -> list[Panel]:
    """Render the game over summary."""
    outcome = data.get("outcome", "unknown")
    termination = data.get("termination", "unknown")
    total_moves = data.get("total_moves", 0)
    total_cost = data.get("total_cost_usd", 0.0)
    total_input = data.get("total_input_tokens", 0)
    total_output = data.get("total_output_tokens", 0)

    outcome_text = outcome.replace("_", " ").title()
    if "white_wins" in outcome:
        outcome_style = "bold white"
    elif "black_wins" in outcome:
        outcome_style = "bold bright_black"
    else:
        outcome_style = "bold yellow"

    result_table = Table(box=box.SIMPLE, show_header=False, padding=(0, 2))
    result_table.add_column(style="dim")
    result_table.add_column()
    result_table.add_row("Result", Text(outcome_text, style=outcome_style))
    result_table.add_row("Termination", termination.replace("_", " ").title())
    result_table.add_row("Total Moves", str(total_moves))

    if total_input or total_output:
        result_table.add_row(
            "Tokens",
            f"{total_input:,} in / {total_output:,} out / {total_input + total_output:,} total",
        )
    if total_cost:
        result_table.add_row("Total Cost", f"${total_cost:.6f}")

    pgn = data.get("pgn")

    panels = [Panel(result_table, title="[bold]Result[/]", border_style="bright_yellow", box=box.ROUNDED)]

    if pgn:
        panels.append(Panel(pgn, title="[bold]PGN[/]", border_style="dim", box=box.ROUNDED))

    return panels


async def run_game(server: str, white: str, black: str, max_moves: int) -> None:
    """Start a new game via API and stream it via WebSocket."""

    # Banner
    console.print()
    console.print(Panel(
        Text.from_markup(
            f"[bold white]♔ White:[/] {white}\n"
            f"[bold bright_black]♚ Black:[/] {black}\n"
            f"[dim]Max moves per side: {max_moves}[/]\n"
            f"[dim]Server: {server}[/]"
        ),
        title="[bold]♟ LLM Chess Arena ♟[/]",
        border_style="bright_yellow",
        box=box.DOUBLE,
    ))

    # Create game via REST API
    async with httpx.AsyncClient(base_url=server, timeout=30.0) as client:
        with console.status("[bold cyan]Creating game...", spinner="dots"):
            resp = await client.post("/api/games", json={
                "white_model": white,
                "black_model": black,
                "max_moves": max_moves,
            })
            resp.raise_for_status()
            game_data = resp.json()

    game_id = game_data["id"]
    console.print(f"  [green]✓[/] Game created: [bold]{game_id}[/]")
    console.print()
    console.print(Rule("[bold]Game Start[/]", style="bright_yellow"))
    console.print()

    await _stream_game(server, game_id, white, black)


async def watch_game(server: str, game_id: str) -> None:
    """Watch an existing game via WebSocket."""
    console.print()
    console.print(f"  [cyan]Connecting to game [bold]{game_id}[/]...[/]")
    console.print()

    await _stream_game(server, game_id, "", "")


async def _stream_game(server: str, game_id: str, white_model: str, black_model: str) -> None:
    """Connect via WebSocket and stream game events."""
    ws_url = server.replace("http://", "ws://").replace("https://", "wss://")
    ws_url = f"{ws_url}/ws/games/{game_id}"

    spinner_live: Live | None = None

    try:
        async with websockets.connect(ws_url) as ws:
            spinner_live = Live(
                Text.from_markup("  [bold cyan]⏳ Waiting for events...[/]"),
                console=console,
                refresh_per_second=8,
                transient=True,
            )
            spinner_live.start()

            async for raw_msg in ws:
                event = json.loads(raw_msg)
                event_type = event.get("type")
                data = event.get("data", {})

                if event_type == "catch_up":
                    # Late-joiner catch-up
                    white_model = data.get("white_model", white_model)
                    black_model = data.get("black_model", black_model)

                    if data.get("status") == "completed":
                        if spinner_live and spinner_live.is_started:
                            spinner_live.stop()
                        console.print("[dim]Game already completed.[/]")
                        break

                    # Replay existing moves
                    moves = data.get("moves", [])
                    if moves:
                        if spinner_live and spinner_live.is_started:
                            spinner_live.stop()
                        console.print(f"  [dim]Replaying {len(moves)} moves...[/]")
                        for m in moves:
                            console.print(render_move(m))
                        spinner_live.start()

                elif event_type == "game_started":
                    white_model = data.get("white_model", white_model)
                    black_model = data.get("black_model", black_model)

                elif event_type == "status":
                    msg = data.get("message", "")
                    if spinner_live and spinner_live.is_started:
                        spinner_live.update(
                            Text.from_markup(f"  [bold cyan]⏳ {msg}[/]")
                        )

                elif event_type == "move_played":
                    if spinner_live and spinner_live.is_started:
                        spinner_live.stop()
                    console.print(render_move(data))
                    if spinner_live:
                        spinner_live.start()

                elif event_type == "game_over":
                    if spinner_live and spinner_live.is_started:
                        spinner_live.stop()
                        spinner_live = None

                    console.print()
                    console.print(Rule("[bold]Game Over[/]", style="bright_yellow"))
                    console.print()

                    panels = render_game_over(data, white_model, black_model)
                    for p in panels:
                        console.print(p)
                    break

                elif event_type == "error":
                    if spinner_live and spinner_live.is_started:
                        spinner_live.stop()
                    console.print(f"  [red]Error: {data.get('message', 'Unknown error')}[/]")
                    break

    except websockets.exceptions.ConnectionClosed:
        console.print("  [yellow]WebSocket connection closed[/]")
    except ConnectionRefusedError:
        console.print(f"  [red]Cannot connect to server at {server}[/]")
        console.print(f"  [dim]Start the server first: uv run uvicorn app.main:app --port 8000[/]")
    except Exception as e:
        console.print(f"  [red]Connection error: {e}[/]")
    finally:
        if spinner_live and spinner_live.is_started:
            spinner_live.stop()


async def main() -> None:
    parser = argparse.ArgumentParser(description="LLM Chess Arena — CLI Client")
    parser.add_argument("--white", help="OpenRouter model ID for White")
    parser.add_argument("--black", help="OpenRouter model ID for Black")
    parser.add_argument("--max-moves", type=int, default=200, help="Max moves per side")
    parser.add_argument("--watch", metavar="GAME_ID", help="Watch an existing game by ID")
    parser.add_argument("--server", default=DEFAULT_SERVER, help=f"Server URL (default: {DEFAULT_SERVER})")
    args = parser.parse_args()

    if args.watch:
        await watch_game(args.server, args.watch)
    elif args.white and args.black:
        await run_game(args.server, args.white, args.black, args.max_moves)
    else:
        parser.error("Either --white and --black, or --watch is required")


if __name__ == "__main__":
    asyncio.run(main())

from io import StringIO

from rich.console import Console

from app.cli import render_game_over


def test_cli_accepts_partially_reported_usage():
    output = StringIO()
    console = Console(file=output, width=100)
    for panel in render_game_over({
        "total_input_tokens": 100, "total_output_tokens": None,
        "total_cost_usd": None, "known_cost_usd": 0.12,
    }, "white", "black"):
        console.print(panel)
    text = output.getvalue()
    assert "Unknown" in text
    assert "$0.120000 known" in text


def test_cli_shows_reported_zero_cost():
    output = StringIO()
    console = Console(file=output, width=100)
    for panel in render_game_over({"total_cost_usd": 0}, "white", "black"):
        console.print(panel)
    assert "$0.000000" in output.getvalue()

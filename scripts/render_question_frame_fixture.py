#!/usr/bin/env python3
"""Render a question-frame regression fixture over its cached PDF page."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

PALETTE = [
    "#e84d7a",
    "#4a8fe7",
    "#35b987",
    "#ef9f3e",
    "#8a63d2",
    "#19a7ae",
]


def font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    filename = "Arial Bold.ttf" if bold else "Arial.ttf"
    return ImageFont.truetype(
        f"/System/Library/Fonts/Supplemental/{filename}",
        size,
    )


def pdf_rect_to_pixels(
    rect: list[float],
    *,
    page_height: float,
    page_left: int,
    page_top: int,
    scale: float,
) -> tuple[int, int, int, int]:
    left, bottom, right, top = rect
    return (
        round(page_left + left * scale),
        round(page_top + (page_height - top) * scale),
        round(page_left + right * scale),
        round(page_top + (page_height - bottom) * scale),
    )


def dashed_rectangle(
    draw: ImageDraw.ImageDraw,
    rect: tuple[int, int, int, int],
    *,
    fill: str,
    width: int,
    dash: int = 18,
    gap: int = 10,
) -> None:
    left, top, right, bottom = rect
    for start in range(left, right, dash + gap):
        draw.line((start, top, min(start + dash, right), top), fill=fill, width=width)
        draw.line((start, bottom, min(start + dash, right), bottom), fill=fill, width=width)
    for start in range(top, bottom, dash + gap):
        draw.line((left, start, left, min(start + dash, bottom)), fill=fill, width=width)
        draw.line((right, start, right, min(start + dash, bottom)), fill=fill, width=width)


def render(fixture_path: Path, page_path: Path, output_path: Path) -> None:
    fixture: dict[str, Any] = json.loads(fixture_path.read_text())
    annotations: list[dict[str, Any]] = fixture["annotations"]
    page_number = fixture["pageNumber"]
    page_width = float(fixture["pageWidth"])
    page_height = float(fixture["pageHeight"])

    source = Image.open(page_path).convert("RGB")
    canvas_width, canvas_height = 2048, 1500
    page_left, page_top = 42, 112
    display_width = 1040
    scale = display_width / page_width
    display_height = round(page_height * scale)
    page = source.resize((display_width, display_height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (canvas_width, canvas_height), "#edf4f1")
    canvas.paste(page, (page_left, page_top))
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle(
        (
            page_left - 5,
            page_top - 5,
            page_left + display_width + 5,
            page_top + display_height + 5,
        ),
        radius=10,
        outline="#c8d9d1",
        width=4,
    )

    title_font = font(36, bold=True)
    subtitle_font = font(20)
    label_font = font(20, bold=True)
    body_font = font(18)
    small_font = font(15)
    draw.text(
        (42, 32),
        f"Page {page_number} fixture · saved annotation records",
        fill="#15251f",
        font=title_font,
    )
    draw.text(
        (42, 76),
        "Exact PDF-coordinate rectangles over the cached annotated page",
        fill="#62726c",
        font=subtitle_font,
    )

    question_members = [item for item in annotations if item.get("stableLabel")]
    ink_members = [item for item in question_members if item["annotationKind"] == "Ink"]
    canonical = max(
        ink_members,
        key=lambda item: (item["rect"][2] - item["rect"][0]) * (item["rect"][3] - item["rect"][1]),
    )
    frame_label = canonical["stableLabel"]
    question_member_numbers = [
        str(index)
        for index, annotation in enumerate(annotations, start=1)
        if annotation in question_members
    ]
    context_member_numbers = [
        str(index)
        for index, annotation in enumerate(annotations, start=1)
        if annotation not in question_members
    ]
    union_rect = [
        min(item["rect"][0] for item in question_members),
        min(item["rect"][1] for item in question_members),
        max(item["rect"][2] for item in question_members),
        max(item["rect"][3] for item in question_members),
    ]

    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay, "RGBA")
    for index, annotation in enumerate(annotations, start=1):
        color = PALETTE[index - 1]
        pixel_rect = pdf_rect_to_pixels(
            annotation["rect"],
            page_height=page_height,
            page_left=page_left,
            page_top=page_top,
            scale=scale,
        )
        overlay_draw.rectangle(pixel_rect, fill=f"{color}18", outline=color, width=5)
        badge_left = max(page_left + 4, pixel_rect[0] + 5)
        badge_top = max(page_top + 4, pixel_rect[1] + 5)
        overlay_draw.ellipse(
            (badge_left, badge_top, badge_left + 38, badge_top + 38),
            fill=color,
            outline="#ffffff",
            width=3,
        )
        badge_text = str(index)
        badge_box = overlay_draw.textbbox((0, 0), badge_text, font=label_font)
        overlay_draw.text(
            (
                badge_left + (38 - (badge_box[2] - badge_box[0])) / 2,
                badge_top + (38 - (badge_box[3] - badge_box[1])) / 2 - badge_box[1],
            ),
            badge_text,
            fill="#ffffff",
            font=label_font,
        )
    canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(canvas, "RGBA")
    dashed_rectangle(
        draw,
        pdf_rect_to_pixels(
            union_rect,
            page_height=page_height,
            page_left=page_left,
            page_top=page_top,
            scale=scale,
        ),
        fill="#672fb8",
        width=7,
    )

    legend_left = 1120
    draw.rounded_rectangle(
        (1096, 28, 2012, 1470),
        radius=24,
        fill="#ffffff",
        outline="#d5e1dc",
        width=3,
    )
    draw.text((legend_left, 58), "What the fixture contains", fill="#15251f", font=title_font)
    draw.text(
        (legend_left, 105),
        "Numbers match the rectangles on the page.",
        fill="#62726c",
        font=subtitle_font,
    )

    card_top = 150
    for index, annotation in enumerate(annotations, start=1):
        color = PALETTE[index - 1]
        top = card_top + (index - 1) * 142
        draw.rounded_rectangle(
            (legend_left, top, 1988, top + 124),
            radius=14,
            fill="#f8fbfa",
            outline="#dbe6e1",
            width=2,
        )
        draw.ellipse((legend_left + 16, top + 15, legend_left + 56, top + 55), fill=color)
        draw.text((legend_left + 29, top + 22), str(index), fill="#ffffff", font=label_font)
        kind = annotation["annotationKind"]
        label = annotation.get("stableLabel")
        draw.text(
            (legend_left + 72, top + 12),
            f"{kind}{f' · {label}' if label else ' · regular'}",
            fill="#15251f",
            font=label_font,
        )
        if not label:
            role = "Regular highlight — context only, not a question"
        elif annotation["id"] == canonical["id"]:
            role = f"Canonical visible capture for {frame_label}"
        elif annotation["id"] == ink_members[0]["id"]:
            role = f"Retained logical frame identity: {frame_label}"
        else:
            role = f"Question member — joined into {frame_label}"
        draw.text((legend_left + 72, top + 49), role, fill="#475a52", font=body_font)
        rect = ", ".join(f"{value:.2f}" for value in annotation["rect"])
        draw.text(
            (legend_left + 72, top + 82),
            f"rect [{rect}]",
            fill="#788780",
            font=small_font,
        )

    summary_top = 1015
    draw.rounded_rectangle(
        (legend_left, summary_top, 1988, 1438),
        radius=18,
        fill="#f2edff",
        outline="#8a63d2",
        width=4,
    )
    draw.text(
        (legend_left + 24, summary_top + 24),
        "Final QA interpretation",
        fill="#4f2a91",
        font=title_font,
    )
    draw.text(
        (legend_left + 24, summary_top + 82),
        f"ONE logical question thread: {frame_label}",
        fill="#15251f",
        font=font(25, bold=True),
    )
    draw.text(
        (legend_left + 24, summary_top + 132),
        f"Question members: {' + '.join(question_member_numbers)}",
        fill="#263b33",
        font=font(23, bold=True),
    )
    draw.text(
        (legend_left + 24, summary_top + 180),
        "Visible source: 6 · union shown as purple dashed frame",
        fill="#475a52",
        font=body_font,
    )
    draw.text(
        (legend_left + 24, summary_top + 220),
        f"Regular context only: {' + '.join(context_member_numbers)}",
        fill="#475a52",
        font=body_font,
    )
    draw.text(
        (legend_left + 24, summary_top + 285),
        "This is the behavior now covered by the regression test.",
        fill="#4f2a91",
        font=font(18, bold=True),
    )
    draw.text(
        (legend_left + 24, summary_top + 330),
        "If any numbered record should be separate, tell me its number.",
        fill="#62726c",
        font=body_font,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output_path, quality=94)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture", type=Path)
    parser.add_argument("page_image", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    render(args.fixture, args.page_image, args.output)


if __name__ == "__main__":
    main()

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
        draw.line(
            (start, bottom, min(start + dash, right), bottom), fill=fill, width=width
        )
    for start in range(top, bottom, dash + gap):
        draw.line(
            (left, start, left, min(start + dash, bottom)), fill=fill, width=width
        )
        draw.line(
            (right, start, right, min(start + dash, bottom)), fill=fill, width=width
        )


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

    expected_groups: list[dict[str, Any]] = fixture["expectedQuestionGroups"]
    annotations_by_id = {item["id"]: item for item in annotations}
    annotation_numbers = {
        item["id"]: str(index) for index, item in enumerate(annotations, start=1)
    }
    annotation_groups = {
        annotation_id: group
        for group in expected_groups
        for annotation_id in (
            group["guideAnnotationIds"] + group["contextAnnotationIds"]
        )
    }
    group_colors = ["#672fb8", "#db762f", "#087f6a"]

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
    for group_index, group in enumerate(expected_groups):
        members = [
            annotations_by_id[annotation_id]
            for annotation_id in (
                group["guideAnnotationIds"] + group["contextAnnotationIds"]
            )
        ]
        union_rect = [
            min(item["rect"][0] for item in members),
            min(item["rect"][1] for item in members),
            max(item["rect"][2] for item in members),
            max(item["rect"][3] for item in members),
        ]
        pixel_union = pdf_rect_to_pixels(
            union_rect,
            page_height=page_height,
            page_left=page_left,
            page_top=page_top,
            scale=scale,
        )
        group_color = group_colors[group_index % len(group_colors)]
        dashed_rectangle(draw, pixel_union, fill=group_color, width=7)
        tag_left = max(page_left + 8, pixel_union[0] + 8)
        tag_top = max(page_top + 8, pixel_union[1] + 8)
        draw.rounded_rectangle(
            (tag_left, tag_top, tag_left + 176, tag_top + 36),
            radius=9,
            fill=group_color,
        )
        draw.text(
            (tag_left + 12, tag_top + 7),
            group["label"],
            fill="#ffffff",
            font=small_font,
        )

    legend_left = 1120
    draw.rounded_rectangle(
        (1096, 28, 2012, 1470),
        radius=24,
        fill="#ffffff",
        outline="#d5e1dc",
        width=3,
    )
    draw.text(
        (legend_left, 58), "What the fixture contains", fill="#15251f", font=title_font
    )
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
        draw.ellipse(
            (legend_left + 16, top + 15, legend_left + 56, top + 55), fill=color
        )
        draw.text(
            (legend_left + 29, top + 22), str(index), fill="#ffffff", font=label_font
        )
        kind = annotation["annotationKind"]
        label = annotation.get("stableLabel")
        group = annotation_groups.get(annotation["id"])
        draw.text(
            (legend_left + 72, top + 12),
            f"{kind}{f' · {label}' if label else ' · regular'}",
            fill="#15251f",
            font=label_font,
        )
        if group is None:
            role = "Not assigned to a question frame"
        elif annotation["id"] in group["contextAnnotationIds"]:
            role = f"Context inside {group['label']} (not a separate question)"
        elif annotation["id"] == group["canonicalAnnotationId"]:
            role = f"Canonical frame capture for {group['label']}"
        else:
            role = f"Overlapping guide joined into {group['label']}"
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
        "TWO logical question threads",
        fill="#15251f",
        font=font(25, bold=True),
    )
    summary_y = summary_top + 132
    for group_index, group in enumerate(expected_groups):
        guide_numbers = [
            annotation_numbers[annotation_id]
            for annotation_id in group["guideAnnotationIds"]
        ]
        context_numbers = [
            annotation_numbers[annotation_id]
            for annotation_id in group["contextAnnotationIds"]
        ]
        group_color = group_colors[group_index % len(group_colors)]
        draw.ellipse(
            (legend_left + 24, summary_y + 2, legend_left + 46, summary_y + 24),
            fill=group_color,
        )
        draw.text(
            (legend_left + 58, summary_y - 3),
            f"{group['label']}: guide {' + '.join(guide_numbers)}",
            fill="#263b33",
            font=font(21, bold=True),
        )
        context = " + ".join(context_numbers) if context_numbers else "none"
        draw.text(
            (legend_left + 58, summary_y + 34),
            f"Context highlights: {context}",
            fill="#475a52",
            font=body_font,
        )
        summary_y += 90
    draw.text(
        (legend_left + 24, summary_top + 325),
        "Rule: real y-overlap joins guide frames; a gap separates them.",
        fill="#4f2a91",
        font=font(18, bold=True),
    )
    draw.text(
        (legend_left + 24, summary_top + 365),
        "Highlights inside the joined frame stay context, not new questions.",
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

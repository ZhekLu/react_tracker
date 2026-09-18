from __future__ import annotations


def annotation_color_name(rgb: list[float]) -> str:
    """Use identical hue rules for embedded PDF and Drawboard Cloud annotations."""
    if len(rgb) < 3:
        return ""
    red, green, blue = rgb[:3]
    # Dark-red (#AF0001) and brighter red/pink pens share hue dominance.
    # Absolute brightness thresholds miss the dark pen; neutral and blue inks
    # must not become questions simply because their red channel is nonzero.
    if red >= 0.45 and red - green >= 0.25 and red - blue >= 0.20:
        return "red"
    if red >= 0.85 and green >= 0.75 and blue <= 0.55:
        return "yellow"
    if red <= 0.35 and green >= 0.75 and blue >= 0.75:
        return "cyan"
    if green >= 0.55 and red <= 0.55:
        return "green"
    if blue >= 0.55 and red <= 0.55:
        return "blue"
    return "custom"

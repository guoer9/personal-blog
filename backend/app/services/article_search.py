"""Shared literal, all-token search rules for both article representations."""

import unicodedata

from sqlalchemy import case, or_


def search_tokens(keyword: str) -> list[str]:
    normalized = " ".join(unicodedata.normalize("NFKC", keyword).split())
    words = normalized.split()
    if not normalized or len(normalized) > 120 or len(words) > 8:
        return []
    return list(dict.fromkeys(words))


def literal_pattern(token: str) -> str:
    escaped = token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search_expressions(tokens, *, title, summary, content, tag_matches):
    title_matches, summary_matches, content_matches, conditions = [], [], [], []
    for token, tag_match in zip(tokens, tag_matches, strict=True):
        pattern = literal_pattern(token)
        title_match = title.ilike(pattern, escape="\\")
        summary_match = summary.ilike(pattern, escape="\\")
        content_match = content.ilike(pattern, escape="\\")
        conditions.append(or_(title_match, tag_match, summary_match, content_match))
        title_matches.append(title_match)
        summary_matches.append(summary_match)
        content_matches.append(content_match)
    relevance = case(
        (or_(*title_matches), 4),
        (or_(*tag_matches), 3),
        (or_(*summary_matches), 2),
        (or_(*content_matches), 1),
        else_=0,
    )
    return conditions, relevance

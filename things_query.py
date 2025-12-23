#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["things.py"]
# ///
"""Query Things 3 database and output JSON."""

import json
import sys
import things


def filter_todos(items):
    """Filter to only to-do items (views can return projects too)."""
    return [i for i in items if i.get("type") == "to-do"]


def resolve_areas(items):
    """Fill in area_title for items that have a project but no area_title."""
    # Only fetch projects if needed
    needs_lookup = [i for i in items if i.get("project") and not i.get("area_title")]
    if needs_lookup:
        projects = {p["uuid"]: p.get("area_title") for p in things.projects()}
        for item in needs_lookup:
            item["area_title"] = projects.get(item["project"])
    return items


def main():
    if len(sys.argv) < 2:
        print("Usage: things_query.py <command> [args]", file=sys.stderr)
        print(
            "Commands: todos, areas, projects, today, inbox, anytime, upcoming, someday, get",
            file=sys.stderr,
        )
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "todos":
        include_items = "--checklists" in sys.argv
        incomplete_only = "--incomplete" in sys.argv
        items = things.todos(status="incomplete", include_items=include_items)
        if not incomplete_only:
            items = items + things.todos(status="completed", include_items=include_items)
            items = items + things.todos(status="canceled", include_items=include_items)
        output(resolve_areas(items))

    elif cmd == "areas":
        output(things.areas())

    elif cmd == "projects":
        output(things.projects())

    elif cmd == "today":
        include_items = "--checklists" in sys.argv
        output(resolve_areas(filter_todos(things.today(include_items=include_items))))

    elif cmd == "inbox":
        include_items = "--checklists" in sys.argv
        output(resolve_areas(filter_todos(things.inbox(include_items=include_items))))

    elif cmd == "anytime":
        include_items = "--checklists" in sys.argv
        output(resolve_areas(filter_todos(things.anytime(include_items=include_items))))

    elif cmd == "upcoming":
        include_items = "--checklists" in sys.argv
        output(resolve_areas(filter_todos(things.upcoming(include_items=include_items))))

    elif cmd == "someday":
        include_items = "--checklists" in sys.argv
        output(resolve_areas(filter_todos(things.someday(include_items=include_items))))

    elif cmd == "get":
        if len(sys.argv) < 3:
            print("Usage: things_query.py get <uuid>", file=sys.stderr)
            sys.exit(1)
        item = things.get(sys.argv[2])
        output(item)

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


def output(data):
    print(json.dumps(data, default=str))


if __name__ == "__main__":
    main()

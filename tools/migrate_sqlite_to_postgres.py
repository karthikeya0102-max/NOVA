from __future__ import annotations

import argparse
import os
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


def parse_owner_id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise argparse.ArgumentTypeError("Owner ID must be the UUID of an existing Supabase Auth user.") from error


def create_backup(source_path: Path, backup_path: Path) -> None:
    source_path = source_path.resolve(strict=True)
    backup_path = backup_path.resolve()
    if source_path == backup_path:
        raise ValueError("The SQLite backup path must differ from the source database.")
    if backup_path.exists():
        raise FileExistsError(f"Refusing to overwrite the existing backup at {backup_path}.")
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True)) as source:
        with closing(sqlite3.connect(backup_path)) as backup:
            source.backup(backup)
            backup.commit()


def migrate(source_path: Path, owner_id: str, database_url: str) -> tuple[int, int]:
    with closing(sqlite3.connect(source_path.resolve().as_uri() + "?mode=ro", uri=True)) as source:
        source.row_factory = sqlite3.Row
        tables = {row["name"] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"messages", "memories"} <= tables:
            raise ValueError("The SQLite database is missing the messages or memories table.")
        messages = source.execute("SELECT * FROM messages ORDER BY id").fetchall()
        memories = source.execute("SELECT * FROM memories ORDER BY id").fetchall()
        for rows in (messages, memories):
            if rows and "user_id" in rows[0].keys():
                if any(row["user_id"] not in (None, "", "local") for row in rows):
                    raise ValueError("This migration only supports a single local SQLite owner; multi-owner data requires a per-user mapping.")

    with psycopg.connect(database_url, connect_timeout=10, sslmode="require", row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS messages("
                "id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, "
                "content TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'chat', "
                "sources TEXT NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
            cursor.execute(
                "CREATE TABLE IF NOT EXISTS memories("
                "id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, "
                "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
            cursor.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id TEXT")
            cursor.execute("ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id TEXT")
            cursor.execute("SELECT COUNT(*) AS count FROM messages")
            if cursor.fetchone()["count"]:
                raise ValueError("The PostgreSQL messages table is not empty. Refusing to merge or overwrite data.")
            cursor.execute("SELECT COUNT(*) AS count FROM memories")
            if cursor.fetchone()["count"]:
                raise ValueError("The PostgreSQL memories table is not empty. Refusing to merge or overwrite data.")

            for row in messages:
                cursor.execute(
                    "INSERT INTO messages(id,user_id,role,content,mode,sources,created_at) "
                    "VALUES(%s,%s,%s,%s,%s,%s,%s)",
                    (
                        row["id"], owner_id, row["role"], row["content"],
                        row["mode"], row["sources"], row["created_at"],
                    ),
                )
            for row in memories:
                cursor.execute(
                    "INSERT INTO memories(id,user_id,content,created_at) VALUES(%s,%s,%s,%s)",
                    (row["id"], owner_id, row["content"], row["created_at"]),
                )
            for table in ("messages", "memories"):
                cursor.execute(f"ALTER TABLE {table} ALTER COLUMN user_id SET NOT NULL")
                cursor.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
                cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_user_id_id ON {table}(user_id, id)")
                cursor.execute(
                    "SELECT setval(pg_get_serial_sequence(%s, 'id'), "
                    f"COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM {table}",
                    (table,),
                )
    return len(messages), len(memories)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Back up and copy single-user NOVA SQLite history and memories into an empty PostgreSQL database."
    )
    parser.add_argument("--sqlite", type=Path, default=Path("data/nova.db"), help="Source SQLite database.")
    parser.add_argument("--backup", required=True, type=Path, help="New backup file path; existing files are never overwritten.")
    parser.add_argument("--owner-user-id", required=True, type=parse_owner_id, help="UUID of the existing Supabase Auth user.")
    arguments = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url.startswith(("postgres://", "postgresql://")):
        parser.error("Set DATABASE_URL to the target PostgreSQL connection string before running the migration.")
    try:
        create_backup(arguments.sqlite, arguments.backup)
        messages, memories = migrate(arguments.sqlite, arguments.owner_user_id, database_url)
    except (OSError, sqlite3.Error, psycopg.Error, ValueError) as error:
        parser.exit(1, f"Migration stopped safely: {error}\n")
    print(f"Migration complete: {messages} messages and {memories} memories copied.")
    print(f"SQLite source retained; verified backup created at {arguments.backup.resolve()}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

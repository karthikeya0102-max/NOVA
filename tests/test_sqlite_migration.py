from __future__ import annotations

import argparse
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from tools.migrate_sqlite_to_postgres import create_backup, parse_owner_id


class SqliteMigrationTests(unittest.TestCase):
    def test_backup_copies_the_database_without_modifying_the_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "nova.db"
            backup = Path(directory) / "nova-backup.sqlite3"
            with closing(sqlite3.connect(source)) as connection:
                connection.execute("CREATE TABLE messages(id INTEGER PRIMARY KEY, content TEXT)")
                connection.execute("INSERT INTO messages(content) VALUES(?)", ("private test content",))
                connection.commit()
            create_backup(source, backup)

            with closing(sqlite3.connect(source)) as connection:
                source_count = connection.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
            with closing(sqlite3.connect(backup)) as connection:
                backup_count = connection.execute("SELECT COUNT(*) FROM messages").fetchone()[0]

            self.assertEqual(source_count, 1)
            self.assertEqual(backup_count, 1)
            with self.assertRaises(FileExistsError):
                create_backup(source, backup)

    def test_migration_owner_must_be_a_valid_uuid(self) -> None:
        self.assertEqual(
            parse_owner_id("9A7FCD47-358A-4BE6-B805-49E64A7628E9"),
            "9a7fcd47-358a-4be6-b805-49e64a7628e9",
        )
        with self.assertRaises(argparse.ArgumentTypeError):
            parse_owner_id("not-a-user-id")


if __name__ == "__main__":
    unittest.main()
